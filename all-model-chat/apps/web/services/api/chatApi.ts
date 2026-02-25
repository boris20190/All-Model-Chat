
import { GenerateContentResponse, Part, UsageMetadata, ChatHistoryItem } from "@google/genai";
import type {
    BffErrorPayload as BffStreamErrorPayload,
    ChatStreamCompleteDiagnostics,
    ChatStreamCompleteEventPayload,
    ChatStreamMetaEventPayload,
    ChatStreamRequestPayload,
} from '@all-model-chat/shared-api';
import type { ChatRequestToolConfig } from '../../types/api';
import { ThoughtSupportingPart } from '../../types';
import { logService } from "../logService";
import { parseBffErrorResponse, resolveBffEndpoint } from './bffApi';
import { BACKEND_MANAGED_KEY_SENTINEL } from '../../utils/apiUtils';
import { consumeSseStream } from './sseStream';

interface StreamErrorDiagnostics {
    code?: string;
    status?: number;
    retryable?: boolean;
    message?: string;
    providerStatus?: string;
    providerReason?: string;
    providerMessage?: string;
}

const resolveBffStreamEndpoint = (): string => resolveBffEndpoint('/api/chat/stream');

const tryParseJsonObject = (rawText: string | undefined): Record<string, unknown> | null => {
    if (!rawText) return null;
    const text = rawText.trim();
    if (!text.startsWith('{') && !text.startsWith('[')) return null;

    try {
        const parsed = JSON.parse(text);
        return isObjectRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
};

const readProviderReasonFromDetails = (details: unknown): string | undefined => {
    if (!Array.isArray(details)) return undefined;

    for (const item of details) {
        if (!isObjectRecord(item)) continue;
        if (typeof item.reason === 'string' && item.reason.length > 0) {
            return item.reason;
        }
    }

    return undefined;
};

const truncateDiagnosticText = (value: string | undefined, maxLength = 500): string | undefined => {
    if (!value) return undefined;
    const normalized = value.trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength)}...`;
};

const normalizeBffStreamErrorPayload = (
    payload: BffStreamErrorPayload | null | undefined
): StreamErrorDiagnostics => {
    const rawMessage = typeof payload?.message === 'string' ? payload.message : undefined;
    const directProviderStatus =
        typeof payload?.providerStatus === 'string' ? payload.providerStatus : undefined;
    const directProviderReason =
        typeof payload?.providerReason === 'string' ? payload.providerReason : undefined;
    const directProviderMessage =
        typeof payload?.providerMessage === 'string' ? payload.providerMessage : undefined;

    const diagnostics: StreamErrorDiagnostics = {
        code: typeof payload?.code === 'string' ? payload.code : undefined,
        status: typeof payload?.status === 'number' ? payload.status : undefined,
        retryable: typeof payload?.retryable === 'boolean' ? payload.retryable : undefined,
        message: truncateDiagnosticText(rawMessage),
    };

    const sdkWrapper = tryParseJsonObject(rawMessage);
    const sdkWrapperError = isObjectRecord(sdkWrapper?.error) ? sdkWrapper.error : null;
    const sdkInnerRaw = typeof sdkWrapperError?.message === 'string' ? sdkWrapperError.message : undefined;
    const providerPayload = tryParseJsonObject(sdkInnerRaw);
    const providerError = isObjectRecord(providerPayload?.error) ? providerPayload.error : null;

    const providerMessage =
        directProviderMessage ||
        (typeof providerError?.message === 'string' && providerError.message) ||
        (typeof sdkWrapperError?.message === 'string' && sdkWrapperError.message) ||
        rawMessage;

    const providerStatus =
        directProviderStatus ||
        (typeof providerError?.status === 'string' && providerError.status) ||
        (typeof sdkWrapperError?.status === 'string' && sdkWrapperError.status) ||
        undefined;

    const providerReason =
        directProviderReason ||
        readProviderReasonFromDetails(providerError?.details) ||
        readProviderReasonFromDetails(sdkWrapperError?.details);

    diagnostics.providerMessage = truncateDiagnosticText(providerMessage);
    diagnostics.providerStatus = providerStatus;
    diagnostics.providerReason = providerReason;

    return diagnostics;
};

const buildStreamErrorMessage = (payload: StreamErrorDiagnostics): string => {
    const primaryMessage = payload.providerMessage || payload.message || 'BFF stream proxy returned an error.';
    const tags: string[] = [];

    if (payload.code) tags.push(`code=${payload.code}`);
    if (typeof payload.status === 'number') tags.push(`status=${payload.status}`);
    if (payload.providerStatus) tags.push(`providerStatus=${payload.providerStatus}`);
    if (payload.providerReason) tags.push(`reason=${payload.providerReason}`);

    if (tags.length === 0) return primaryMessage;
    return `${primaryMessage} (${tags.join(', ')})`;
};

const createBffStreamError = (
    payload: BffStreamErrorPayload | StreamErrorDiagnostics | null | undefined
): Error => {
    const normalizedPayload = normalizeBffStreamErrorPayload(payload as BffStreamErrorPayload | undefined);
    const message = buildStreamErrorMessage(normalizedPayload);
    const error = new Error(message);
    (error as any).code = normalizedPayload.code || 'bff_stream_error';
    (error as any).status = normalizedPayload.status;
    (error as any).retryable = normalizedPayload.retryable;
    (error as any).providerStatus = normalizedPayload.providerStatus;
    (error as any).providerReason = normalizedPayload.providerReason;
    (error as any).providerMessage = normalizedPayload.providerMessage;
    return error;
};

const normalizeUnknownStreamFailure = (error: unknown): StreamErrorDiagnostics | undefined => {
    if (error == null) return undefined;
    if (error instanceof Error && error.name === 'AbortError') return undefined;

    if (typeof error === 'object' && error !== null) {
        const raw = error as Record<string, unknown>;
        return {
            code: typeof raw.code === 'string' ? raw.code : undefined,
            status: typeof raw.status === 'number' ? raw.status : undefined,
            retryable: typeof raw.retryable === 'boolean' ? raw.retryable : undefined,
            message: error instanceof Error ? truncateDiagnosticText(error.message) : truncateDiagnosticText(String(error)),
            providerStatus: typeof raw.providerStatus === 'string' ? raw.providerStatus : undefined,
            providerReason: typeof raw.providerReason === 'string' ? raw.providerReason : undefined,
            providerMessage: typeof raw.providerMessage === 'string' ? truncateDiagnosticText(raw.providerMessage) : undefined,
        };
    }

    return {
        message: truncateDiagnosticText(String(error)),
    };
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

const normalizeCompleteDiagnostics = (payload: unknown): ChatStreamCompleteDiagnostics | undefined => {
    if (!isObjectRecord(payload)) return undefined;

    const rawDiagnosticsField = payload.diagnostics;
    const hasDiagnosticsField = isObjectRecord(rawDiagnosticsField);
    const diagnosticsSource = (hasDiagnosticsField ? rawDiagnosticsField : payload) as Record<string, unknown>;

    const promptFeedbackSource = isObjectRecord(diagnosticsSource.promptFeedback)
        ? diagnosticsSource.promptFeedback
        : undefined;
    const streamMetaSource = isObjectRecord(diagnosticsSource.streamMeta)
        ? diagnosticsSource.streamMeta
        : undefined;
    const streamErrorSource = isObjectRecord(diagnosticsSource.streamError)
        ? diagnosticsSource.streamError
        : undefined;
    const mcpSource = isObjectRecord(diagnosticsSource.mcp)
        ? diagnosticsSource.mcp
        : undefined;

    const diagnostics: ChatStreamCompleteDiagnostics = {
        finishReason: typeof diagnosticsSource.finishReason === 'string' ? diagnosticsSource.finishReason : undefined,
        finishMessage: typeof diagnosticsSource.finishMessage === 'string' ? diagnosticsSource.finishMessage : undefined,
        candidateSafetyRatings: Array.isArray(diagnosticsSource.candidateSafetyRatings)
            ? diagnosticsSource.candidateSafetyRatings
            : undefined,
        promptFeedback: promptFeedbackSource
            ? {
                blockReason: typeof promptFeedbackSource.blockReason === 'string' ? promptFeedbackSource.blockReason : undefined,
                blockReasonMessage: typeof promptFeedbackSource.blockReasonMessage === 'string'
                    ? promptFeedbackSource.blockReasonMessage
                    : undefined,
                safetyRatings: Array.isArray(promptFeedbackSource.safetyRatings)
                    ? promptFeedbackSource.safetyRatings
                    : undefined,
            }
            : undefined,
        responseId: typeof diagnosticsSource.responseId === 'string' ? diagnosticsSource.responseId : undefined,
        modelVersion: typeof diagnosticsSource.modelVersion === 'string' ? diagnosticsSource.modelVersion : undefined,
        hadCandidate: typeof diagnosticsSource.hadCandidate === 'boolean' ? diagnosticsSource.hadCandidate : undefined,
        hadCandidateParts: typeof diagnosticsSource.hadCandidateParts === 'boolean' ? diagnosticsSource.hadCandidateParts : undefined,
        hadThoughtChunk: typeof diagnosticsSource.hadThoughtChunk === 'boolean' ? diagnosticsSource.hadThoughtChunk : undefined,
        streamMeta: streamMetaSource
            ? {
                provider: typeof streamMetaSource.provider === 'string'
                    ? streamMetaSource.provider
                    : undefined,
                keyId: typeof streamMetaSource.keyId === 'string'
                    ? streamMetaSource.keyId
                    : undefined,
            }
            : undefined,
        streamError: streamErrorSource
            ? {
                code: typeof streamErrorSource.code === 'string'
                    ? streamErrorSource.code
                    : undefined,
                status: typeof streamErrorSource.status === 'number'
                    ? streamErrorSource.status
                    : undefined,
                retryable: typeof streamErrorSource.retryable === 'boolean'
                    ? streamErrorSource.retryable
                    : undefined,
                message: typeof streamErrorSource.message === 'string'
                    ? streamErrorSource.message
                    : undefined,
                providerStatus: typeof streamErrorSource.providerStatus === 'string'
                    ? streamErrorSource.providerStatus
                    : undefined,
                providerReason: typeof streamErrorSource.providerReason === 'string'
                    ? streamErrorSource.providerReason
                    : undefined,
                providerMessage: typeof streamErrorSource.providerMessage === 'string'
                    ? streamErrorSource.providerMessage
                    : undefined,
            }
            : undefined,
        mcp: mcpSource
            ? {
                requestedServerIds: Array.isArray(mcpSource.requestedServerIds)
                    ? mcpSource.requestedServerIds.filter((entry): entry is string => typeof entry === 'string')
                    : undefined,
                attachedServerIds: Array.isArray(mcpSource.attachedServerIds)
                    ? mcpSource.attachedServerIds.filter((entry): entry is string => typeof entry === 'string')
                    : undefined,
                skipped: Array.isArray(mcpSource.skipped)
                    ? mcpSource.skipped
                        .filter((entry): entry is Record<string, unknown> => isObjectRecord(entry))
                        .map((entry) => ({
                            id: typeof entry.id === 'string' ? entry.id : 'unknown',
                            reason: typeof entry.reason === 'string' ? entry.reason : 'unknown',
                            code: typeof entry.code === 'string' ? entry.code : undefined,
                        }))
                    : undefined,
                attachMeta: Array.isArray(mcpSource.attachMeta)
                    ? mcpSource.attachMeta
                        .filter((entry): entry is Record<string, unknown> => isObjectRecord(entry))
                        .map((entry) => ({
                            serverId: typeof entry.serverId === 'string' ? entry.serverId : 'unknown',
                            transport: typeof entry.transport === 'string' ? entry.transport : 'unknown',
                            protocolVersion:
                                typeof entry.protocolVersion === 'string' ? entry.protocolVersion : undefined,
                            toolCount: typeof entry.toolCount === 'number' ? entry.toolCount : undefined,
                            latencyMs: typeof entry.latencyMs === 'number' ? entry.latencyMs : undefined,
                        }))
                    : undefined,
                invokedTools: Array.isArray(mcpSource.invokedTools)
                    ? mcpSource.invokedTools
                        .filter((entry): entry is Record<string, unknown> => isObjectRecord(entry))
                        .map((entry) => ({
                            serverId: typeof entry.serverId === 'string' ? entry.serverId : 'unknown',
                            toolName: typeof entry.toolName === 'string' ? entry.toolName : 'unknown',
                        }))
                    : undefined,
                degraded: typeof mcpSource.degraded === 'boolean' ? mcpSource.degraded : undefined,
            }
            : undefined,
    };

    const hasAnyDiagnostics = Object.values(diagnostics).some((value) => value !== undefined);
    if (hasAnyDiagnostics) return diagnostics;

    if (!hasDiagnosticsField) {
        return {
            finishMessage: 'BFF complete event did not include diagnostics fields.',
        };
    }

    return undefined;
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
        // Preserve snake_case to maximize compatibility with Vertex API serialization
        thought_signature: thoughtSignature,
    } as any;
};

/**
 * Shared helper to parse GenAI responses.
 * Extracts parts, separates thoughts, and merges metadata/citations from tool calls.
 */
const processResponse = (response: GenerateContentResponse) => {
    let thoughtsText = "";
    const responseParts: Part[] = [];

    if (response.candidates && response.candidates[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
            const pAsThoughtSupporting = part as ThoughtSupportingPart;
            if (pAsThoughtSupporting.thought) {
                thoughtsText += part.text;
            } else {
                responseParts.push(part);
            }
        }
    }

    if (responseParts.length === 0 && response.text) {
        responseParts.push({ text: response.text });
    }

    const candidate = response.candidates?.[0];
    const groundingMetadata = candidate?.groundingMetadata;
    const finalMetadata: any = groundingMetadata ? { ...groundingMetadata } : {};

    // @ts-ignore - Handle potential snake_case from raw API responses
    const urlContextMetadata = candidate?.urlContextMetadata || candidate?.url_context_metadata;

    const toolCalls = candidate?.toolCalls;
    if (toolCalls) {
        for (const toolCall of toolCalls) {
            if (toolCall.functionCall?.args?.urlContextMetadata) {
                if (!finalMetadata.citations) finalMetadata.citations = [];
                const newCitations = toolCall.functionCall.args.urlContextMetadata.citations || [];
                for (const newCitation of newCitations) {
                    if (!finalMetadata.citations.some((c: any) => c.uri === newCitation.uri)) {
                        finalMetadata.citations.push(newCitation);
                    }
                }
            }
        }
    }

    const thoughtPartCount =
        response.candidates?.[0]?.content?.parts?.filter((part) => (part as ThoughtSupportingPart).thought).length || 0;
    const nonStreamDiagnostics = normalizeCompleteDiagnostics({
        finishReason: candidate?.finishReason ? String(candidate.finishReason) : undefined,
        finishMessage: candidate?.finishMessage,
        candidateSafetyRatings: candidate?.safetyRatings,
        promptFeedback: response.promptFeedback
            ? {
                blockReason: response.promptFeedback.blockReason,
                blockReasonMessage: response.promptFeedback.blockReasonMessage,
                safetyRatings: response.promptFeedback.safetyRatings,
            }
            : undefined,
        responseId: response.responseId,
        modelVersion: response.modelVersion,
        hadCandidate: !!candidate,
        hadCandidateParts: !!candidate?.content?.parts?.length,
        hadThoughtChunk: thoughtPartCount > 0,
    });

    return {
        parts: responseParts,
        thoughts: thoughtsText || undefined,
        usage: response.usageMetadata,
        grounding: Object.keys(finalMetadata).length > 0 ? finalMetadata : undefined,
        urlContext: urlContextMetadata,
        diagnostics: nonStreamDiagnostics,
    };
};

export const sendStatelessMessageStreamApi = async (
    apiKey: string,
    modelId: string,
    history: ChatHistoryItem[],
    parts: Part[],
    config: any,
    abortSignal: AbortSignal,
    onPart: (part: Part) => void,
    onThoughtChunk: (chunk: string) => void,
    onError: (error: Error) => void,
    onComplete: (
        usageMetadata?: UsageMetadata,
        groundingMetadata?: any,
        urlContextMetadata?: any,
        functionCallPart?: Part,
        diagnostics?: ChatStreamCompleteDiagnostics
    ) => void,
    role: 'user' | 'model' = 'user',
    toolConfig?: ChatRequestToolConfig
): Promise<void> => {
    logService.info(`Sending message via BFF /api/chat/stream for ${modelId} (Role: ${role})`);
    let finalUsageMetadata: UsageMetadata | undefined = undefined;
    let finalGroundingMetadata: any = null;
    let finalUrlContextMetadata: any = null;
    let detectedFunctionCallPart: Part | undefined = undefined;
    let finalDiagnostics: ChatStreamCompleteDiagnostics | undefined = undefined;
    let sawMetaEvent = false;
    let sawPartEvent = false;
    let sawThoughtEvent = false;
    let sawCompleteEvent = false;
    let sawErrorEvent = false;
    let receivedEventCount = 0;
    let streamMetaProvider: string | undefined = undefined;
    let streamMetaKeyId: string | undefined = undefined;
    let latestStreamError: StreamErrorDiagnostics | undefined = undefined;

    try {
        if (abortSignal.aborted) {
            logService.warn("Streaming aborted by signal before start.");
            return;
        }

        const endpoint = resolveBffStreamEndpoint();
        const requestPayload: ChatStreamRequestPayload = {
            model: modelId,
            history,
            parts,
            config,
            role,
            apiKeyOverride: apiKey !== BACKEND_MANAGED_KEY_SENTINEL ? apiKey : undefined,
            mcp: toolConfig?.mcpEnabledServerIds?.length
                ? { enabledServerIds: [...toolConfig.mcpEnabledServerIds] }
                : undefined,
        };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            signal: abortSignal,
            body: JSON.stringify(requestPayload),
        });
        const responseContentType = response.headers.get('content-type');

        if (!response.ok) {
            throw await parseBffErrorResponse(response);
        }

        const sseSummary = await consumeSseStream(response, abortSignal, (event) => {
            receivedEventCount += 1;
            const payload = event.payload as any;

            if (event.eventName === 'meta') {
                sawMetaEvent = true;
                const metaPayload = payload as ChatStreamMetaEventPayload | undefined;
                if (typeof metaPayload?.provider === 'string') {
                    streamMetaProvider = metaPayload.provider;
                }
                if (typeof metaPayload?.keyId === 'string') {
                    streamMetaKeyId = metaPayload.keyId;
                    logService.recordApiKeyUsage(metaPayload.keyId, { source: 'server' });
                }
                return;
            }

            if (event.eventName === 'part') {
                sawPartEvent = true;
                if (payload?.part) {
                    onPart(payload.part as Part);
                }
                return;
            }

            if (event.eventName === 'thought') {
                sawThoughtEvent = true;
                if (typeof payload?.chunk === 'string') {
                    onThoughtChunk(payload.chunk);
                }
                return;
            }

            if (event.eventName === 'complete') {
                sawCompleteEvent = true;
                const completePayload = payload as ChatStreamCompleteEventPayload | undefined;
                if (completePayload?.usageMetadata) {
                    finalUsageMetadata = completePayload.usageMetadata as UsageMetadata;
                }
                if (completePayload?.groundingMetadata) {
                    finalGroundingMetadata = completePayload.groundingMetadata;
                }
                if (completePayload?.urlContextMetadata) {
                    finalUrlContextMetadata = completePayload.urlContextMetadata;
                }
                if (completePayload?.functionCallPart) {
                    detectedFunctionCallPart = normalizeThoughtSignaturePart(completePayload.functionCallPart as Part);
                }
                finalDiagnostics = normalizeCompleteDiagnostics(completePayload);
                return;
            }

            if (event.eventName === 'error') {
                sawErrorEvent = true;
                latestStreamError = normalizeBffStreamErrorPayload(payload?.error as BffStreamErrorPayload | undefined);
                throw createBffStreamError(latestStreamError);
            }
        });

        if (sseSummary.eventCount === 0 && !latestStreamError) {
            const isEventStream =
                typeof responseContentType === 'string' &&
                responseContentType.toLowerCase().includes('text/event-stream');
            const details = isEventStream
                ? 'SSE stream ended without parsable events.'
                : `Unexpected response content-type for stream: ${responseContentType || 'unknown'}.`;

            latestStreamError = {
                code: isEventStream ? 'bff_empty_sse_stream' : 'bff_unexpected_stream_content_type',
                status: response.status,
                message: sseSummary.trailingTextSample
                    ? `${details} trailingSample=${sseSummary.trailingTextSample}`
                    : details,
            };
        }
    } catch (error) {
        const isAborted = abortSignal.aborted || (error instanceof Error && error.name === 'AbortError');
        if (isAborted) {
            logService.warn("Streaming aborted by signal.");
            return;
        }

        if (!latestStreamError) {
            latestStreamError = normalizeUnknownStreamFailure(error);
        }

        logService.error("Error sending message (stream):", error);
        onError(error instanceof Error ? error : new Error(String(error) || "Unknown error during streaming."));
    } finally {
        if (!finalDiagnostics) {
            const streamErrorSummary = latestStreamError ? buildStreamErrorMessage(latestStreamError) : undefined;
            finalDiagnostics = {
                finishMessage: sawCompleteEvent
                    ? 'Complete event was received, but no diagnostics were parsed.'
                    : streamErrorSummary
                        ? `Stream ended without complete event after upstream error: ${streamErrorSummary} (events=${String(receivedEventCount)}, meta=${String(sawMetaEvent)}, part=${String(sawPartEvent)}, thought=${String(sawThoughtEvent)}, error=${String(sawErrorEvent)}).`
                        : `Stream ended without complete event (events=${String(receivedEventCount)}, meta=${String(sawMetaEvent)}, part=${String(sawPartEvent)}, thought=${String(sawThoughtEvent)}, error=${String(sawErrorEvent)}).`,
                hadCandidate: false,
                hadCandidateParts: sawPartEvent,
                hadThoughtChunk: sawThoughtEvent,
                streamMeta: {
                    provider: streamMetaProvider,
                    keyId: streamMetaKeyId,
                },
                streamError: latestStreamError,
            };
        } else {
            if (!finalDiagnostics.streamMeta) {
                finalDiagnostics.streamMeta = {
                    provider: streamMetaProvider,
                    keyId: streamMetaKeyId,
                };
            }
            if (!finalDiagnostics.streamError && latestStreamError) {
                finalDiagnostics.streamError = latestStreamError;
            }
        }

        logService.info("Streaming complete.", {
            usage: finalUsageMetadata,
            hasGrounding: !!finalGroundingMetadata,
            hasFunctionCall: !!detectedFunctionCallPart,
            diagnostics: finalDiagnostics,
        });
        onComplete(
            finalUsageMetadata,
            finalGroundingMetadata,
            finalUrlContextMetadata,
            detectedFunctionCallPart,
            finalDiagnostics
        );
    }
};

export const sendStatelessMessageNonStreamApi = async (
    apiKey: string,
    modelId: string,
    history: ChatHistoryItem[],
    parts: Part[],
    config: any,
    abortSignal: AbortSignal,
    onError: (error: Error) => void,
    onComplete: (
        parts: Part[],
        thoughtsText?: string,
        usageMetadata?: UsageMetadata,
        groundingMetadata?: any,
        urlContextMetadata?: any,
        diagnostics?: ChatStreamCompleteDiagnostics
    ) => void,
    toolConfig?: ChatRequestToolConfig
): Promise<void> => {
    logService.info(`Sending message via buffered BFF stream (non-stream mode) for model ${modelId}`);

    const bufferedParts: Part[] = [];
    let bufferedThoughts = '';

    await sendStatelessMessageStreamApi(
        apiKey,
        modelId,
        history,
        parts,
        config,
        abortSignal,
        (part) => bufferedParts.push(part),
        (chunk) => {
            bufferedThoughts += chunk;
        },
        onError,
        (usageMetadata, groundingMetadata, urlContextMetadata, _functionCallPart, diagnostics) => {
            onComplete(
                bufferedParts,
                bufferedThoughts || undefined,
                usageMetadata,
                groundingMetadata,
                urlContextMetadata,
                diagnostics
            );
        },
        'user',
        toolConfig
    );
};
