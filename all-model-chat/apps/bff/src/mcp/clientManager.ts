import { mcpToTool } from '@google/genai';
import type { McpAttachResult, McpRuntimeConfig, McpRuntimeMode } from './types.js';
import { attachMcpCallableToolsLegacy } from './clientManager.legacy.js';
import { getMcpConnectionPool } from './pool/connectionPool.js';

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const createNoopClose = async (): Promise<void> => {
  return;
};

const uniqueStringArray = (value: string[] | undefined): string[] => {
  if (!Array.isArray(value)) return [];

  const deduped = new Set<string>();
  for (const rawEntry of value) {
    if (typeof rawEntry !== 'string') continue;
    const normalized = rawEntry.trim();
    if (normalized.length === 0) continue;
    deduped.add(normalized);
  }

  return [...deduped];
};

const extractFunctionDeclarationNames = (tools: unknown[] | undefined): Set<string> => {
  const names = new Set<string>();
  if (!Array.isArray(tools)) return names;

  for (const tool of tools) {
    if (!isObject(tool)) continue;
    const declarations = Array.isArray(tool.functionDeclarations)
      ? (tool.functionDeclarations as unknown[])
      : [];

    for (const declaration of declarations) {
      if (!isObject(declaration)) continue;
      if (typeof declaration.name !== 'string') continue;
      const name = declaration.name.trim();
      if (name.length === 0) continue;
      names.add(name);
    }
  }

  return names;
};

const classifySkippedCode = (error: unknown): 'connect_timeout' | 'initialize_failed' | 'list_tools_failed' => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('timeout')) return 'connect_timeout';
  if (message.includes('list') && message.includes('tool')) return 'list_tools_failed';
  return 'initialize_failed';
};

const attachMcpCallableToolsSdk = async (params: {
  runtime: McpRuntimeConfig;
  requestedServerIds?: string[];
  existingTools?: unknown[];
}): Promise<McpAttachResult> => {
  const requestedServerIds = uniqueStringArray(params.requestedServerIds);
  const skipped: McpAttachResult['skipped'] = [];

  if (requestedServerIds.length === 0) {
    return {
      tools: [],
      attachedServerIds: [],
      attachMeta: [],
      skipped,
      invokedTools: [],
      close: createNoopClose,
    };
  }

  if (!params.runtime.enabled) {
    requestedServerIds.forEach((id) => {
      skipped.push({
        id,
        reason: 'MCP is disabled by BFF_MCP_ENABLED.',
        code: 'config_error',
      });
    });

    return {
      tools: [],
      attachedServerIds: [],
      attachMeta: [],
      skipped,
      invokedTools: [],
      close: createNoopClose,
    };
  }

  const serverById = new Map(params.runtime.servers.map((server) => [server.id, server]));
  const existingFunctionNames = extractFunctionDeclarationNames(params.existingTools);
  const attachedServerIds: string[] = [];
  const attachMeta: McpAttachResult['attachMeta'] = [];
  const attachedToolNames = new Set<string>();
  const pool = getMcpConnectionPool();
  const attachedClients: Array<{ serverId: string; client: any; toolNames: string[] }> = [];
  const toolToServerId = new Map<string, string>();
  const invokedTools: McpAttachResult['invokedTools'] = [];

  for (const serverId of requestedServerIds) {
    const server = serverById.get(serverId);
    if (!server) {
      skipped.push({
        id: serverId,
        reason: 'Server is not present in MCP config file.',
        code: 'config_error',
      });
      continue;
    }

    if (!server.enabled) {
      skipped.push({
        id: serverId,
        reason: 'Server is disabled in MCP config.',
        code: 'config_error',
      });
      continue;
    }

    if (server.transport === 'stdio' && !server.command) {
      skipped.push({
        id: serverId,
        reason: 'Missing stdio command.',
        code: 'config_error',
      });
      continue;
    }

    if ((server.transport === 'http' || server.transport === 'sse') && !server.url) {
      skipped.push({
        id: serverId,
        reason: `Missing ${server.transport} URL.`,
        code: 'config_error',
      });
      continue;
    }

    try {
      const connected = await pool.acquire(server);
      if (connected.toolNames.length === 0) {
        skipped.push({
          id: serverId,
          reason: 'No tools were listed by MCP server.',
          code: 'list_tools_failed',
        });
        continue;
      }

      const conflicts = connected.toolNames.filter(
        (name) => existingFunctionNames.has(name) || attachedToolNames.has(name)
      );
      if (conflicts.length > 0) {
        skipped.push({
          id: serverId,
          reason: `Tool name conflict: ${conflicts.slice(0, 5).join(', ')}.`,
          code: 'config_error',
        });
        continue;
      }

      connected.toolNames.forEach((name) => {
        attachedToolNames.add(name);
        toolToServerId.set(name, serverId);
      });
      attachedClients.push({
        serverId,
        client: connected.client,
        toolNames: connected.toolNames,
      });
      attachedServerIds.push(serverId);
      attachMeta.push({
        serverId,
        transport: connected.transport,
        protocolVersion: connected.protocolVersion,
        toolCount: connected.toolNames.length,
        latencyMs: connected.latencyMs,
      });
    } catch (error) {
      skipped.push({
        id: serverId,
        reason: error instanceof Error ? error.message : String(error),
        code: classifySkippedCode(error),
      });
    }
  }

  if (attachedClients.length === 0) {
    return {
      tools: [],
      attachedServerIds,
      attachMeta,
      skipped,
      invokedTools,
      close: createNoopClose,
    };
  }

  try {
    const callableTool = (mcpToTool as (...args: any[]) => any)(
      ...(attachedClients.map((entry) => entry.client) as any[])
    );

    const wrappedTool = {
      tool: async (): Promise<unknown> => {
        return callableTool.tool();
      },
      callTool: async (functionCalls: unknown): Promise<unknown> => {
        const callList = Array.isArray(functionCalls) ? functionCalls : [];
        for (const functionCall of callList) {
          if (!isObject(functionCall) || typeof functionCall.name !== 'string') continue;
          const toolName = functionCall.name;
          const serverId = toolToServerId.get(toolName) || 'unknown';
          invokedTools.push({
            serverId,
            toolName,
          });
        }

        return callableTool.callTool(functionCalls);
      },
    };

    return {
      tools: [wrappedTool],
      attachedServerIds,
      attachMeta,
      skipped,
      invokedTools,
      close: createNoopClose,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    attachedServerIds.forEach((serverId) => {
      skipped.push({
        id: serverId,
        reason: `Failed to convert MCP client to callable tool: ${reason}`,
        code: 'initialize_failed',
      });
    });

    return {
      tools: [],
      attachedServerIds: [],
      attachMeta: [],
      skipped,
      invokedTools,
      close: createNoopClose,
    };
  }
};

export const attachMcpCallableTools = async (params: {
  runtime: McpRuntimeConfig;
  requestedServerIds?: string[];
  existingTools?: unknown[];
  runtimeMode?: McpRuntimeMode;
}): Promise<McpAttachResult> => {
  if (params.runtimeMode === 'legacy') {
    return attachMcpCallableToolsLegacy({
      runtime: params.runtime,
      requestedServerIds: params.requestedServerIds,
      existingTools: params.existingTools,
    });
  }

  return attachMcpCallableToolsSdk({
    runtime: params.runtime,
    requestedServerIds: params.requestedServerIds,
    existingTools: params.existingTools,
  });
};
