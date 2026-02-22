import { IncomingMessage, ServerResponse } from 'node:http';
import { GoogleGenAI, Part, UsageMetadata } from '@google/genai';
import { GeminiProviderClient } from '../providers/geminiClient.js';
import type { ChatHistoryTurn, ChatStreamRequestPayload, ChatToolMode } from '@all-model-chat/shared-api';
import type { ChatRole } from '@all-model-chat/shared-types';
import { mapProviderError, sanitizeApiKey } from './routeCommon.js';
import { normalizeThinkingLevelForModel, type ThinkingLevel } from '../utils/thinking.js';
import type { BffConfig } from '../config/env.js';
import { loadMcpRuntimeConfig } from '../mcp/config.js';
import { attachMcpCallableTools } from '../mcp/clientManager.js';
import {
  buildWebGroundingDiagnostics,
  collectWebGroundingEvidence,
  resolveWebGroundingRequirement,
} from './webGrounding.js';

interface ValidationErrorShape {
  code: string;
  message: string;
  status: number;
}

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
};

class ValidationError extends Error {
  constructor(public readonly detail: ValidationErrorShape) {
    super(detail.message);
    this.name = 'ValidationError';
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const normalizeThoughtSignaturePart = (part: Part): Part => {
  const anyPart = part as any;
  const thoughtSignature =
    anyPart.thoughtSignature ||
    anyPart.thought_signature ||
    anyPart.functionCall?.thoughtSignature ||
    anyPart.functionCall?.thought_signature;

  if (!thoughtSignature) return part;

  return {
    ...part,
    thoughtSignature,
    thought_signature: thoughtSignature,
  } as any;
};

const pushUniqueCitations = (groundingMetadata: Record<string, unknown>, newCitations: unknown): void => {
  if (!Array.isArray(newCitations)) return;

  const existing = Array.isArray(groundingMetadata.citations)
    ? (groundingMetadata.citations as Array<Record<string, unknown>>)
    : [];

  for (const citation of newCitations) {
    if (!isObject(citation)) continue;

    const uri = typeof citation.uri === 'string' ? citation.uri : null;
    if (!uri) continue;

    if (!existing.some((current) => current.uri === uri)) {
      existing.push(citation);
    }
  }

  groundingMetadata.citations = existing;
};

const writeSseEvent = (response: ServerResponse, eventName: string, data: unknown): void => {
  if (response.writableEnded || response.destroyed) return;

  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
};

const readRequestBody = async (request: IncomingMessage): Promise<string> => {
  return new Promise((resolve, reject) => {
    let body = '';
    let totalBytes = 0;
    let isCompleted = false;

    request.setEncoding('utf8');

    request.on('data', (chunk: string) => {
      if (isCompleted) return;

      totalBytes += Buffer.byteLength(chunk);
      if (totalBytes > MAX_REQUEST_BYTES) {
        isCompleted = true;
        reject(
          new ValidationError({
            code: 'payload_too_large',
            message: `Request body exceeds ${MAX_REQUEST_BYTES} bytes.`,
            status: 413,
          })
        );
        request.destroy();
        return;
      }

      body += chunk;
    });

    request.on('end', () => {
      if (isCompleted) return;
      isCompleted = true;
      resolve(body);
    });

    request.on('aborted', () => {
      if (isCompleted) return;
      isCompleted = true;
      reject(
        new ValidationError({
          code: 'request_aborted',
          message: 'Request was aborted by the client.',
          status: 499,
        })
      );
    });

    request.on('error', (error) => {
      if (isCompleted) return;
      isCompleted = true;
      reject(error);
    });
  });
};

const normalizePartArray = (input: unknown, fieldPath: string, required: boolean): Part[] => {
  if (input === undefined) {
    if (required) {
      throw new ValidationError({
        code: 'invalid_request',
        message: `${fieldPath} is required.`,
        status: 400,
      });
    }
    return [];
  }

  if (!Array.isArray(input)) {
    throw new ValidationError({
      code: 'invalid_request',
      message: `${fieldPath} must be an array.`,
      status: 400,
    });
  }

  for (let index = 0; index < input.length; index += 1) {
    if (!isObject(input[index])) {
      throw new ValidationError({
        code: 'invalid_request',
        message: `${fieldPath}[${index}] must be an object.`,
        status: 400,
      });
    }
  }

  return input as Part[];
};

const normalizeHistory = (input: unknown): ChatHistoryTurn[] => {
  if (input === undefined) return [];

  if (!Array.isArray(input)) {
    throw new ValidationError({
      code: 'invalid_request',
      message: '`history` must be an array.',
      status: 400,
    });
  }

  return input.map((item, index) => {
    if (!isObject(item)) {
      throw new ValidationError({
        code: 'invalid_request',
        message: `history[${index}] must be an object.`,
        status: 400,
      });
    }

    const roleRaw = item.role;
    if (roleRaw !== 'user' && roleRaw !== 'model') {
      throw new ValidationError({
        code: 'invalid_request',
        message: `history[${index}].role must be "user" or "model".`,
        status: 400,
      });
    }

    return {
      role: roleRaw,
      parts: normalizePartArray(item.parts, `history[${index}].parts`, true),
    };
  });
};

const parseToolMode = (value: unknown): ChatToolMode | undefined => {
  if (value === undefined) return undefined;
  if (value !== 'builtin' && value !== 'custom' && value !== 'none') {
    throw new ValidationError({
      code: 'invalid_request',
      message: '`toolMode` must be one of "builtin", "custom", or "none".',
      status: 400,
    });
  }
  return value;
};

const parseEnabledServerIds = (value: unknown): string[] | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ValidationError({
      code: 'invalid_request',
      message: '`mcp.enabledServerIds` must be an array of strings.',
      status: 400,
    });
  }

  const deduped = new Set<string>();

  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry !== 'string') {
      throw new ValidationError({
        code: 'invalid_request',
        message: `mcp.enabledServerIds[${index}] must be a string.`,
        status: 400,
      });
    }

    const normalized = entry.trim();
    if (!normalized) continue;
    deduped.add(normalized);
  }

  return [...deduped];
};

const parseWebGrounding = (value: unknown): ChatStreamRequestPayload['webGrounding'] | undefined => {
  if (value === undefined) return undefined;
  if (!isObject(value)) {
    throw new ValidationError({
      code: 'invalid_request',
      message: '`webGrounding` must be an object.',
      status: 400,
    });
  }

  const requiredRaw = value.required;
  const policyRaw = value.policy;

  if (requiredRaw !== undefined && typeof requiredRaw !== 'boolean') {
    throw new ValidationError({
      code: 'invalid_request',
      message: '`webGrounding.required` must be a boolean.',
      status: 400,
    });
  }

  if (policyRaw !== undefined && policyRaw !== 'off' && policyRaw !== 'warn') {
    throw new ValidationError({
      code: 'invalid_request',
      message: '`webGrounding.policy` must be one of "off" or "warn".',
      status: 400,
    });
  }

  const parsed: NonNullable<ChatStreamRequestPayload['webGrounding']> = {};
  if (typeof requiredRaw === 'boolean') {
    parsed.required = requiredRaw;
  }
  if (policyRaw === 'off' || policyRaw === 'warn') {
    parsed.policy = policyRaw;
  }

  if (parsed.required === undefined && parsed.policy === undefined) {
    return undefined;
  }

  return parsed;
};

const isBuiltinToolEntry = (tool: unknown): boolean => {
  if (!isObject(tool)) return false;
  return 'googleSearch' in tool || 'codeExecution' in tool || 'urlContext' in tool;
};

const isFunctionDeclarationEntry = (tool: unknown): boolean => {
  if (!isObject(tool)) return false;
  return Array.isArray(tool.functionDeclarations);
};

const inferToolModeFromConfig = (rawConfig: unknown): ChatToolMode => {
  if (!isObject(rawConfig) || !Array.isArray(rawConfig.tools)) {
    return 'none';
  }

  const tools = rawConfig.tools;
  if (tools.some((tool) => isBuiltinToolEntry(tool))) return 'builtin';
  if (tools.some((tool) => isFunctionDeclarationEntry(tool))) return 'custom';
  return 'none';
};

const parseChatStreamPayload = (rawBody: string): ChatStreamRequestPayload => {
  if (!rawBody.trim()) {
    throw new ValidationError({
      code: 'invalid_request',
      message: 'Request body is required.',
      status: 400,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new ValidationError({
      code: 'invalid_json',
      message: 'Request body must be valid JSON.',
      status: 400,
    });
  }

  if (!isObject(parsed)) {
    throw new ValidationError({
      code: 'invalid_request',
      message: 'Request body must be a JSON object.',
      status: 400,
    });
  }

  const modelRaw = parsed.model;
  const model = typeof modelRaw === 'string' ? modelRaw.trim() : '';
  if (!model) {
    throw new ValidationError({
      code: 'invalid_request',
      message: '`model` must be a non-empty string.',
      status: 400,
    });
  }

  const roleRaw = parsed.role;
  const role: ChatRole = roleRaw === 'model' ? 'model' : 'user';
  const apiKeyOverrideRaw = parsed.apiKeyOverride;
  let apiKeyOverride: string | undefined;
  if (typeof apiKeyOverrideRaw === 'string') {
    const sanitized = sanitizeApiKey(apiKeyOverrideRaw);
    if (sanitized.length > 0) {
      apiKeyOverride = sanitized;
    }
  }
  const history = normalizeHistory(parsed.history);
  const parts = normalizePartArray(parsed.parts, '`parts`', false);
  const toolMode = parseToolMode(parsed.toolMode);
  const mcpPayload = isObject(parsed.mcp) ? parsed.mcp : undefined;
  const enabledServerIds = parseEnabledServerIds(mcpPayload?.enabledServerIds);
  const webGrounding = parseWebGrounding(parsed.webGrounding);

  if (history.length === 0 && parts.length === 0) {
    throw new ValidationError({
      code: 'invalid_request',
      message: 'Either `history` or `parts` must contain at least one item.',
      status: 400,
    });
  }

  return {
    model,
    history,
    parts,
    config: parsed.config,
    role,
    apiKeyOverride,
    toolMode,
    mcp: enabledServerIds ? { enabledServerIds } : undefined,
    webGrounding,
  };
};

const mapValidationError = (error: unknown): ValidationErrorShape => {
  if (error instanceof ValidationError) {
    return error.detail;
  }

  return {
    code: 'invalid_request',
    message: error instanceof Error ? error.message : 'Failed to parse request.',
    status: 400,
  };
};


export const handleChatStreamRoute = async (
  request: IncomingMessage,
  response: ServerResponse,
  geminiProviderClient: GeminiProviderClient,
  bffConfig: BffConfig
): Promise<void> => {
  let payload: ChatStreamRequestPayload;
  try {
    const rawBody = await readRequestBody(request);
    payload = parseChatStreamPayload(rawBody);
  } catch (error) {
    const mapped = mapValidationError(error);
    response.writeHead(mapped.status, JSON_HEADERS);
    response.end(JSON.stringify({ error: mapped }));
    return;
  }

  const contents: ChatHistoryTurn[] =
    payload.parts.length > 0
      ? [...payload.history, { role: payload.role, parts: payload.parts }]
      : payload.history;

  response.writeHead(200, SSE_HEADERS);
  if (typeof response.flushHeaders === 'function') {
    response.flushHeaders();
  }
  writeSseEvent(response, 'ready', { ok: true });

  const abortController = new AbortController();
  const onClientDisconnect = () => {
    if (!abortController.signal.aborted) {
      abortController.abort();
    }
  };

  request.on('aborted', onClientDisconnect);
  response.on('close', onClientDisconnect);

  try {
    const streamWithClient = async (client: GoogleGenAI, keyId: string): Promise<void> => {
      writeSseEvent(response, 'meta', {
        provider: 'gemini',
        keyId,
      });

      let finalUsageMetadata: UsageMetadata | undefined;
      let finalGroundingMetadata: Record<string, unknown> | undefined;
      let finalUrlContextMetadata: unknown = undefined;
      let detectedFunctionCallPart: Part | undefined = undefined;
      let latestToolCallFunction: unknown = undefined;
      let latestToolCallSignature: string | undefined = undefined;
      let latestThoughtSignatureFromParts: string | undefined = undefined;
      let finalFinishReason: string | undefined = undefined;
      let finalFinishMessage: string | undefined = undefined;
      let finalCandidateSafetyRatings: unknown[] | undefined = undefined;
      let finalPromptFeedback:
        | {
            blockReason?: string;
            blockReasonMessage?: string;
            safetyRatings?: unknown[];
          }
        | undefined = undefined;
      let finalResponseId: string | undefined = undefined;
      let finalModelVersion: string | undefined = undefined;
      let hadCandidate = false;
      let hadCandidateParts = false;
      let hadThoughtChunk = false;
      const requestedMcpServerIds = payload.mcp?.enabledServerIds
        ? [...payload.mcp.enabledServerIds]
        : [];
      const finalToolMode: ChatToolMode = payload.toolMode || inferToolModeFromConfig(payload.config);
      const mcpDiagnostics =
        requestedMcpServerIds.length > 0
          ? {
              requestedServerIds: [...requestedMcpServerIds],
              attachedServerIds: [] as string[],
              skipped: [] as Array<{ id: string; reason: string }>,
              degraded: false,
            }
          : undefined;
      let closeMcpTools = async (): Promise<void> => undefined;

      const configClone: Record<string, unknown> = isObject(payload.config)
        ? { ...(payload.config as Record<string, unknown>) }
        : {};
      const rawThinkingConfig = configClone.thinkingConfig;
      if (isObject(rawThinkingConfig)) {
        const thinkingConfigClone: Record<string, unknown> = { ...rawThinkingConfig };
        const rawThinkingLevel =
          typeof thinkingConfigClone.thinkingLevel === 'string'
            ? (thinkingConfigClone.thinkingLevel as ThinkingLevel)
            : undefined;

        const normalizedThinkingLevel = normalizeThinkingLevelForModel(payload.model, rawThinkingLevel);
        if (rawThinkingLevel && normalizedThinkingLevel && rawThinkingLevel !== normalizedThinkingLevel) {
          thinkingConfigClone.thinkingLevel = normalizedThinkingLevel;
        }

        configClone.thinkingConfig = thinkingConfigClone;
      }

      const rawTools = Array.isArray(configClone.tools) ? [...configClone.tools] : [];
      let normalizedTools = rawTools;

      if (finalToolMode === 'builtin') {
        normalizedTools = rawTools.filter((tool) => isBuiltinToolEntry(tool));
      } else if (finalToolMode === 'custom') {
        normalizedTools = rawTools.filter((tool) => isFunctionDeclarationEntry(tool));
      } else if (finalToolMode === 'none') {
        normalizedTools = [];
      }

      if (requestedMcpServerIds.length > 0 && finalToolMode !== 'custom') {
        requestedMcpServerIds.forEach((serverId) => {
          mcpDiagnostics?.skipped.push({
            id: serverId,
            reason: `Ignored because toolMode=${finalToolMode}. MCP servers attach only in custom mode.`,
          });
        });
      }

      if (finalToolMode === 'custom' && requestedMcpServerIds.length > 0) {
        if (normalizedTools.some((tool) => isFunctionDeclarationEntry(tool))) {
          mcpDiagnostics?.skipped.push({
            id: 'local-function-declarations',
            reason:
              'Basic FunctionDeclarations were removed because MCP callable tools cannot be mixed with them in automatic function-calling mode.',
          });
          normalizedTools = normalizedTools.filter((tool) => !isFunctionDeclarationEntry(tool));
        }

        try {
          const runtime = await loadMcpRuntimeConfig(bffConfig);
          if (runtime.warnings.length > 0) {
            runtime.warnings.forEach((warning, index) => {
              mcpDiagnostics?.skipped.push({
                id: `config-warning-${index + 1}`,
                reason: warning,
              });
            });
          }

          const attachment = await attachMcpCallableTools({
            runtime,
            requestedServerIds: requestedMcpServerIds,
            existingTools: normalizedTools,
          });

          normalizedTools = [...normalizedTools, ...attachment.tools];
          closeMcpTools = attachment.close;

          if (mcpDiagnostics) {
            mcpDiagnostics.attachedServerIds = [...attachment.attachedServerIds];
            mcpDiagnostics.skipped.push(...attachment.skipped);
          }
        } catch (error) {
          mcpDiagnostics?.skipped.push({
            id: 'mcp-attach',
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (normalizedTools.length > 0) {
        configClone.tools = normalizedTools;
      } else {
        delete configClone.tools;
      }

      if (mcpDiagnostics) {
        mcpDiagnostics.degraded =
          mcpDiagnostics.requestedServerIds.length > 0 &&
          mcpDiagnostics.attachedServerIds.length === 0;
      }

      const webGroundingRequirement = resolveWebGroundingRequirement({
        payload,
        finalToolMode,
        normalizedTools,
      });

      const effectiveConfig: unknown = configClone;

      try {
        const result = await client.models.generateContentStream({
          model: payload.model,
          contents,
          config: effectiveConfig as any,
        });

        for await (const chunkResponse of result) {
          if (abortController.signal.aborted) {
            break;
          }

          if (typeof chunkResponse.responseId === 'string' && chunkResponse.responseId.length > 0) {
            finalResponseId = chunkResponse.responseId;
          }

          if (typeof chunkResponse.modelVersion === 'string' && chunkResponse.modelVersion.length > 0) {
            finalModelVersion = chunkResponse.modelVersion;
          }

          if (chunkResponse.promptFeedback) {
            finalPromptFeedback = {
              blockReason: chunkResponse.promptFeedback.blockReason,
              blockReasonMessage: chunkResponse.promptFeedback.blockReasonMessage,
              safetyRatings: Array.isArray(chunkResponse.promptFeedback.safetyRatings)
                ? [...chunkResponse.promptFeedback.safetyRatings]
                : undefined,
            };
          }

          if (chunkResponse.usageMetadata) {
            finalUsageMetadata = chunkResponse.usageMetadata;
          }

          const candidate = chunkResponse.candidates?.[0];
          if (!candidate) {
            continue;
          }
          hadCandidate = true;

          if (candidate.finishReason) {
            finalFinishReason = String(candidate.finishReason);
          }

          if (typeof candidate.finishMessage === 'string' && candidate.finishMessage.length > 0) {
            finalFinishMessage = candidate.finishMessage;
          }

          if (Array.isArray(candidate.safetyRatings)) {
            finalCandidateSafetyRatings = [...candidate.safetyRatings];
          }

          if (candidate.groundingMetadata) {
            finalGroundingMetadata = { ...(candidate.groundingMetadata as Record<string, unknown>) };
          }

          const anyCandidate = candidate as any;
          const urlMetadata = anyCandidate.urlContextMetadata || anyCandidate.url_context_metadata;
          if (urlMetadata) {
            finalUrlContextMetadata = urlMetadata;
          }

          const toolCalls = anyCandidate.toolCalls as any[] | undefined;
          if (toolCalls) {
            for (const toolCall of toolCalls) {
              if (toolCall.functionCall?.args?.urlContextMetadata) {
                if (!finalGroundingMetadata) {
                  finalGroundingMetadata = {};
                }
                pushUniqueCitations(
                  finalGroundingMetadata,
                  toolCall.functionCall.args.urlContextMetadata.citations
                );
              }

              if (toolCall.functionCall) {
                latestToolCallFunction = toolCall.functionCall;
                const anyToolCall = toolCall as any;
                latestToolCallSignature =
                  anyToolCall.thoughtSignature ||
                  anyToolCall.thought_signature ||
                  anyToolCall.functionCall?.thoughtSignature ||
                  anyToolCall.functionCall?.thought_signature;
              }
            }
          }

          const candidateParts = candidate.content?.parts;
          if (!candidateParts?.length) {
            continue;
          }
          hadCandidateParts = true;

          for (const part of candidateParts) {
            const anyPart = part as any;
            const partSignature = anyPart.thoughtSignature || anyPart.thought_signature;
            if (partSignature) {
              latestThoughtSignatureFromParts = partSignature;
            }

            if (anyPart.functionCall) {
              detectedFunctionCallPart = normalizeThoughtSignaturePart(part);
              continue;
            }

            if (anyPart.thought) {
              hadThoughtChunk = true;
              writeSseEvent(response, 'thought', { chunk: part.text || '' });
              continue;
            }

            writeSseEvent(response, 'part', { part });
          }
        }
      } finally {
        await closeMcpTools().catch(() => undefined);
      }

      if (!detectedFunctionCallPart && latestToolCallFunction) {
        detectedFunctionCallPart = {
          functionCall: latestToolCallFunction as Part['functionCall'],
          ...(latestToolCallSignature || latestThoughtSignatureFromParts
            ? {
              thoughtSignature: latestToolCallSignature || latestThoughtSignatureFromParts,
              thought_signature: latestToolCallSignature || latestThoughtSignatureFromParts,
            }
            : {}),
        } as any;
      } else if (detectedFunctionCallPart && (latestToolCallSignature || latestThoughtSignatureFromParts)) {
        const anyPart = detectedFunctionCallPart as any;
        if (!anyPart.thoughtSignature && !anyPart.thought_signature) {
          detectedFunctionCallPart = {
            ...detectedFunctionCallPart,
            thoughtSignature: latestToolCallSignature || latestThoughtSignatureFromParts,
            thought_signature: latestToolCallSignature || latestThoughtSignatureFromParts,
          } as any;
        }
      }

      if (!abortController.signal.aborted) {
        const webGroundingEvidence = collectWebGroundingEvidence({
          groundingMetadata: finalGroundingMetadata,
          urlContextMetadata: finalUrlContextMetadata,
        });
        const webGroundingDiagnostics = buildWebGroundingDiagnostics({
          required: webGroundingRequirement.required,
          policy: webGroundingRequirement.policy,
          evidence: webGroundingEvidence,
        });

        writeSseEvent(response, 'complete', {
          usageMetadata: finalUsageMetadata,
          groundingMetadata: finalGroundingMetadata,
          urlContextMetadata: finalUrlContextMetadata,
          functionCallPart: detectedFunctionCallPart,
          diagnostics: {
            finishReason: finalFinishReason,
            finishMessage: finalFinishMessage,
            candidateSafetyRatings: finalCandidateSafetyRatings,
            promptFeedback: finalPromptFeedback,
            responseId: finalResponseId,
            modelVersion: finalModelVersion,
            hadCandidate,
            hadCandidateParts,
            hadThoughtChunk,
            mcp: mcpDiagnostics,
            webGrounding: webGroundingDiagnostics,
          },
        });
      }
    };

    if (payload.apiKeyOverride) {
      const providerConfig = geminiProviderClient.getProviderConfigSnapshot();
      const clientOptions: Record<string, unknown> = {
        apiKey: payload.apiKeyOverride,
        vertexai: providerConfig.useVertexAi,
      };
      if (providerConfig.apiVersion) {
        clientOptions.apiVersion = providerConfig.apiVersion;
      }
      if (providerConfig.baseUrl) {
        clientOptions.httpOptions = {
          baseUrl: providerConfig.baseUrl,
        };
      }

      const overrideClient = new GoogleGenAI(clientOptions as any);
      await streamWithClient(overrideClient, 'custom-key');
    } else {
      await geminiProviderClient.withClient(async ({ client, keyId }) => {
        await streamWithClient(client, keyId);
      });
    }
  } catch (error) {
    if (!abortController.signal.aborted) {
      writeSseEvent(response, 'error', { error: mapProviderError(error) });
    }
  } finally {
    request.off('aborted', onClientDisconnect);
    response.off('close', onClientDisconnect);
  }

  if (!response.writableEnded && !response.destroyed) {
    response.end();
  }
};
