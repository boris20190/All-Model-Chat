import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mcpToTool } from '@google/genai';
import type { McpAttachResult, McpRuntimeConfig, McpServerConfig } from './types.js';

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id?: number | string;
  result?: unknown;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id?: number | string;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
}

type JsonRpcMessage = JsonRpcSuccess | JsonRpcError | Record<string, unknown>;

interface ListToolsResponse {
  tools?: Array<{ name?: string }>;
  nextCursor?: string;
  cursor?: string;
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const normalizeToolNames = (toolsResponse: unknown): string[] => {
  const response = isObject(toolsResponse) ? (toolsResponse as ListToolsResponse) : {};
  const tools = Array.isArray(response.tools) ? response.tools : [];

  return tools
    .map((tool) => (typeof tool?.name === 'string' ? tool.name.trim() : ''))
    .filter((name) => name.length > 0);
};

const getNextCursor = (toolsResponse: unknown): string | undefined => {
  if (!isObject(toolsResponse)) return undefined;

  const nextCursor =
    typeof toolsResponse.nextCursor === 'string'
      ? toolsResponse.nextCursor
      : typeof toolsResponse.cursor === 'string'
      ? toolsResponse.cursor
      : undefined;

  if (!nextCursor) return undefined;
  const normalized = nextCursor.trim();
  return normalized.length > 0 ? normalized : undefined;
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

const createRpcProtocolError = (message: string): Error => {
  const error = new Error(message);
  (error as any).code = 'mcp_protocol_error';
  return error;
};

class StdioMcpClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  private nextRequestId = 1;
  private readBuffer = Buffer.alloc(0);
  private initPromise: Promise<void> | null = null;
  private closed = false;
  private stderrTail = '';

  constructor(private readonly server: McpServerConfig) {
    if (!server.command) {
      throw new Error(`MCP server ${server.id} is missing command.`);
    }

    this.child = spawn(server.command, server.args, {
      cwd: server.cwd,
      env: {
        ...process.env,
        ...server.env,
      },
      stdio: 'pipe',
    });

    this.child.stdout.on('data', (chunk: Buffer) => {
      this.consumeStdoutChunk(chunk);
    });

    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderrTail += chunk.toString('utf8');
      if (this.stderrTail.length > 4000) {
        this.stderrTail = this.stderrTail.slice(-4000);
      }
    });

    this.child.on('error', (error) => {
      this.failPending(new Error(`MCP server process error (${server.id}): ${error.message}`));
    });

    this.child.on('exit', (code, signal) => {
      if (this.closed) return;
      const stderrTail = this.stderrTail.trim();
      const suffix = stderrTail.length > 0 ? ` stderr=${stderrTail}` : '';
      this.failPending(
        new Error(`MCP server process exited (${server.id}, code=${String(code)}, signal=${String(signal)}).${suffix}`)
      );
    });
  }

  private failPending(error: Error): void {
    if (this.closed) return;
    this.closed = true;

    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private consumeStdoutChunk(chunk: Buffer): void {
    if (this.closed) return;

    this.readBuffer = Buffer.concat([this.readBuffer, chunk]);

    while (true) {
      const frame = this.extractNextFrame();
      if (!frame) break;

      let message: JsonRpcMessage;
      try {
        message = JSON.parse(frame);
      } catch {
        continue;
      }

      this.handleIncomingMessage(message);
    }
  }

  private extractNextFrame(): string | null {
    const headerTerminatorCrlf = Buffer.from('\r\n\r\n');
    const headerTerminatorLf = Buffer.from('\n\n');

    let headerEndIndex = this.readBuffer.indexOf(headerTerminatorCrlf);
    let separatorLength = headerTerminatorCrlf.length;

    if (headerEndIndex < 0) {
      headerEndIndex = this.readBuffer.indexOf(headerTerminatorLf);
      separatorLength = headerTerminatorLf.length;
    }

    if (headerEndIndex < 0) return null;

    const headerText = this.readBuffer.slice(0, headerEndIndex).toString('utf8');
    const headers = headerText.split(/\r?\n/);

    let contentLength: number | null = null;
    for (const headerLine of headers) {
      const [rawKey, ...rawValueParts] = headerLine.split(':');
      if (!rawKey || rawValueParts.length === 0) continue;

      if (rawKey.trim().toLowerCase() !== 'content-length') continue;

      const rawValue = rawValueParts.join(':').trim();
      const parsed = Number.parseInt(rawValue, 10);
      if (Number.isInteger(parsed) && parsed >= 0) {
        contentLength = parsed;
      }
      break;
    }

    if (contentLength === null) {
      // Drop malformed bytes up to the separator and continue parsing.
      this.readBuffer = this.readBuffer.slice(headerEndIndex + separatorLength);
      return null;
    }

    const bodyStart = headerEndIndex + separatorLength;
    const frameEnd = bodyStart + contentLength;

    if (this.readBuffer.length < frameEnd) return null;

    const body = this.readBuffer.slice(bodyStart, frameEnd).toString('utf8');
    this.readBuffer = this.readBuffer.slice(frameEnd);
    return body;
  }

  private handleIncomingMessage(message: JsonRpcMessage): void {
    if (!isObject(message)) return;
    if (!('id' in message)) return;

    const pendingKey = String(message.id);
    const pending = this.pending.get(pendingKey);
    if (!pending) return;

    this.pending.delete(pendingKey);
    clearTimeout(pending.timeout);

    if (isObject(message.error)) {
      const rpcMessage =
        typeof message.error.message === 'string' && message.error.message.trim().length > 0
          ? message.error.message.trim()
          : 'Unknown MCP RPC error.';
      pending.reject(createRpcProtocolError(rpcMessage));
      return;
    }

    pending.resolve((message as Record<string, unknown>).result);
  }

  private writeRpcMessage(payload: Record<string, unknown>): void {
    if (this.closed || !this.child.stdin.writable) {
      throw new Error(`MCP server ${this.server.id} is not writable.`);
    }

    const body = JSON.stringify(payload);
    const message = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
    this.child.stdin.write(message, 'utf8');
  }

  private async request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.closed) {
      throw new Error(`MCP server ${this.server.id} is already closed.`);
    }

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;

    const payload = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(String(requestId));
        reject(
          new Error(
            `MCP request timeout (${this.server.id}, method=${method}, timeoutMs=${this.server.timeoutMs}).`
          )
        );
      }, this.server.timeoutMs);

      this.pending.set(String(requestId), { resolve, reject, timeout });

      try {
        this.writeRpcMessage(payload);
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(String(requestId));
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private notify(method: string, params: Record<string, unknown> = {}): void {
    const payload = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.writeRpcMessage(payload);
  }

  private async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      await this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'all-model-chat-bff',
          version: '1.8.5',
        },
      });

      this.notify('notifications/initialized', {});
    })();

    return this.initPromise;
  }

  async listTools(params?: { cursor?: string }): Promise<ListToolsResponse> {
    await this.initialize();
    const result = await this.request('tools/list', params?.cursor ? { cursor: params.cursor } : {});
    return (isObject(result) ? (result as ListToolsResponse) : {}) as ListToolsResponse;
  }

  async callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<unknown> {
    await this.initialize();
    return this.request('tools/call', {
      name: params.name,
      arguments: params.arguments || {},
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`MCP client for server ${this.server.id} is closing.`));
    }
    this.pending.clear();

    if (this.child.stdin.writable) {
      this.child.stdin.end();
    }

    if (!this.child.killed) {
      this.child.kill('SIGTERM');
    }
  }
}

const listServerToolNames = async (client: StdioMcpClient): Promise<string[]> => {
  const names = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < 20; page += 1) {
    const toolsResponse = await client.listTools(cursor ? { cursor } : undefined);
    for (const name of normalizeToolNames(toolsResponse)) {
      names.add(name);
    }

    cursor = getNextCursor(toolsResponse);
    if (!cursor) break;
  }

  return [...names];
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

const createNoopClose = async (): Promise<void> => {
  return;
};

export const attachMcpCallableToolsLegacy = async (params: {
  runtime: McpRuntimeConfig;
  requestedServerIds?: string[];
  existingTools?: unknown[];
}): Promise<McpAttachResult> => {
  const requestedServerIds = uniqueStringArray(params.requestedServerIds);
  const skipped: McpAttachResult['skipped'] = [];
  const attachMeta: McpAttachResult['attachMeta'] = [];
  const invokedTools: McpAttachResult['invokedTools'] = [];

  if (requestedServerIds.length === 0) {
    return {
      tools: [],
      attachedServerIds: [],
      attachMeta,
      skipped,
      invokedTools,
      close: createNoopClose,
    };
  }

  if (!params.runtime.enabled) {
    requestedServerIds.forEach((id) => {
      skipped.push({
        id,
        reason: 'MCP is disabled by BFF_MCP_ENABLED.',
      });
    });

    return {
      tools: [],
      attachedServerIds: [],
      attachMeta,
      skipped,
      invokedTools,
      close: createNoopClose,
    };
  }

  const serverById = new Map(params.runtime.servers.map((server) => [server.id, server]));
  const existingFunctionNames = extractFunctionDeclarationNames(params.existingTools);
  const attachedServerIds: string[] = [];
  const attachedClients: StdioMcpClient[] = [];
  const attachedToolNames = new Set<string>();

  for (const serverId of requestedServerIds) {
    const server = serverById.get(serverId);
    if (!server) {
      skipped.push({ id: serverId, reason: 'Server is not present in MCP config file.' });
      continue;
    }

    if (!server.enabled) {
      skipped.push({ id: serverId, reason: 'Server is disabled in MCP config.' });
      continue;
    }

    if (server.transport !== 'stdio') {
      skipped.push({
        id: serverId,
        reason: `Transport ${server.transport} is not yet attachable in this runtime.`,
      });
      continue;
    }

    if (!server.command) {
      skipped.push({ id: serverId, reason: 'Missing stdio command.' });
      continue;
    }

    const client = new StdioMcpClient(server);

    try {
      const toolNames = await listServerToolNames(client);
      if (toolNames.length === 0) {
        skipped.push({ id: serverId, reason: 'No tools were listed by MCP server.' });
        await client.close();
        continue;
      }

      const conflicts = toolNames.filter(
        (name) => existingFunctionNames.has(name) || attachedToolNames.has(name)
      );

      if (conflicts.length > 0) {
        skipped.push({
          id: serverId,
          reason: `Tool name conflict: ${conflicts.slice(0, 5).join(', ')}.`,
        });
        await client.close();
        continue;
      }

      toolNames.forEach((name) => attachedToolNames.add(name));
      attachedClients.push(client);
      attachedServerIds.push(serverId);
      attachMeta.push({
        serverId,
        transport: 'stdio',
        toolCount: toolNames.length,
      });
    } catch (error) {
      skipped.push({
        id: serverId,
        reason: error instanceof Error ? error.message : String(error),
      });
      await client.close().catch(() => undefined);
    }
  }

  const closeAll = async (): Promise<void> => {
    await Promise.all(attachedClients.map((client) => client.close().catch(() => undefined)));
  };

  if (attachedClients.length === 0) {
    return {
      tools: [],
      attachedServerIds,
      attachMeta,
      skipped,
      invokedTools,
      close: closeAll,
    };
  }

  try {
    const callableTool = (mcpToTool as (...args: any[]) => unknown)(...(attachedClients as any[]));

    return {
      tools: [callableTool],
      attachedServerIds,
      attachMeta,
      skipped,
      invokedTools,
      close: closeAll,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    attachedServerIds.forEach((serverId) => {
      skipped.push({
        id: serverId,
        reason: `Failed to convert MCP client to callable tool: ${reason}`,
      });
    });

    await closeAll();

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
