import type { McpServerConfig, McpSkippedReasonCode, McpTransport } from '../types.js';
import { loadMcpSdk } from '../sdkLoader.js';

const IDLE_TTL_MS = 10 * 60 * 1000;
const STATUS_CACHE_TTL_MS = 20 * 1000;
const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30 * 1000;

interface ConnectedClient {
  serverId: string;
  transport: McpTransport;
  client: any;
  toolNames: string[];
  protocolVersion?: string;
  latencyMs: number;
}

interface PooledClientEntry {
  serverId: string;
  configFingerprint: string;
  state: 'connecting' | 'ready' | 'degraded' | 'closed';
  connectedClient: ConnectedClient | null;
  connectPromise: Promise<ConnectedClient> | null;
  lastError: Error | null;
  nextRetryAt: number;
  retryDelayMs: number;
  idleTimer: NodeJS.Timeout | null;
  lastUsedAt: number;
}

interface ProbeCacheEntry {
  fingerprint: string;
  expiresAt: number;
  status: {
    available: boolean;
    attachable: boolean;
    statusMessage: string;
    code?: McpSkippedReasonCode;
    protocolVersion?: string;
    toolCount?: number;
    latencyMs?: number;
    transport?: McpTransport;
  };
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`${label} timeout after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const normalizeToolNames = (value: unknown): string[] => {
  if (!isObject(value)) return [];
  const rawTools = Array.isArray(value.tools) ? value.tools : [];

  return rawTools
    .map((tool) => (isObject(tool) && typeof tool.name === 'string' ? tool.name.trim() : ''))
    .filter((name) => name.length > 0);
};

const getNextCursor = (value: unknown): string | undefined => {
  if (!isObject(value)) return undefined;
  const next =
    typeof value.nextCursor === 'string'
      ? value.nextCursor.trim()
      : typeof value.cursor === 'string'
      ? value.cursor.trim()
      : '';
  return next.length > 0 ? next : undefined;
};

const classifyErrorCode = (error: unknown): McpSkippedReasonCode => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('timeout')) return 'connect_timeout';
  if (message.includes('list') && message.includes('tool')) return 'list_tools_failed';
  if (message.includes('initialize')) return 'initialize_failed';
  return 'initialize_failed';
};

const classifyError = (error: unknown, fallbackCode?: McpSkippedReasonCode): Error & { code: McpSkippedReasonCode } => {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const code = fallbackCode || classifyErrorCode(error);
  (normalized as Error & { code: McpSkippedReasonCode }).code = code;
  return normalized as Error & { code: McpSkippedReasonCode };
};

const getConfigFingerprint = (server: McpServerConfig): string => {
  return JSON.stringify({
    id: server.id,
    transport: server.transport,
    enabled: server.enabled,
    command: server.command,
    args: server.args,
    env: server.env,
    cwd: server.cwd,
    url: server.url,
    headers: server.headers,
    sseFallback: server.sseFallback,
    connectTimeoutMs: server.connectTimeoutMs,
    timeoutMs: server.timeoutMs,
  });
};

const mergeRequestInitHeaders = (headers: Record<string, string>): RequestInit | undefined => {
  if (Object.keys(headers).length === 0) return undefined;
  return {
    headers: {
      ...headers,
    },
  };
};

const shouldFallbackToSse = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('405') ||
    message.includes('404') ||
    message.includes('not allowed') ||
    message.includes('unsupported') ||
    message.includes('streamable') ||
    message.includes('accept') ||
    message.includes('timeout')
  );
};

export class McpConnectionPool {
  private readonly entries = new Map<string, PooledClientEntry>();
  private readonly probeCache = new Map<string, ProbeCacheEntry>();

  private scheduleIdleClose(entry: PooledClientEntry): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
    }

    entry.idleTimer = setTimeout(() => {
      this.closeEntry(entry.serverId).catch(() => undefined);
    }, IDLE_TTL_MS);
    if (typeof entry.idleTimer.unref === 'function') {
      entry.idleTimer.unref();
    }
  }

  private async closeConnectedClient(client: ConnectedClient | null): Promise<void> {
    if (!client) return;
    try {
      if (typeof client.client?.close === 'function') {
        await client.client.close();
      }
    } catch {
      // Ignore close errors.
    }
  }

  private async closeEntry(serverId: string): Promise<void> {
    const existing = this.entries.get(serverId);
    if (!existing) return;

    if (existing.idleTimer) {
      clearTimeout(existing.idleTimer);
      existing.idleTimer = null;
    }

    await this.closeConnectedClient(existing.connectedClient);
    this.entries.delete(serverId);
  }

  private async listServerTools(client: any, timeoutMs: number): Promise<string[]> {
    const deduped = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < 20; page += 1) {
      const listPromise = client.listTools(cursor ? { cursor } : undefined, {
        timeout: timeoutMs,
      });
      const result = await withTimeout(listPromise, timeoutMs, 'MCP listTools');
      normalizeToolNames(result).forEach((toolName) => deduped.add(toolName));
      cursor = getNextCursor(result);
      if (!cursor) break;
    }

    return [...deduped];
  }

  private async connectViaTransport(
    server: McpServerConfig,
    transportMode: McpTransport
  ): Promise<ConnectedClient> {
    const sdk = await loadMcpSdk();
    const requestInit = mergeRequestInitHeaders(server.headers);
    const startedAt = Date.now();

    let transport: any;
    if (transportMode === 'stdio') {
      transport = new sdk.StdioClientTransport({
        command: server.command,
        args: server.args,
        env: {
          ...process.env,
          ...server.env,
        },
        cwd: server.cwd,
      });
    } else if (transportMode === 'http') {
      transport = new sdk.StreamableHTTPClientTransport(new URL(server.url as string), {
        requestInit,
      });
    } else {
      transport = new sdk.SSEClientTransport(new URL(server.url as string), {
        requestInit,
      });
    }

    const client = new sdk.Client(
      {
        name: 'all-model-chat-bff',
        version: '1.8.5',
      },
      {
        capabilities: {},
      }
    );

    try {
      await withTimeout(
        Promise.resolve(client.connect(transport)),
        server.connectTimeoutMs,
        `MCP connect (${server.id})`
      );

      const toolNames = await this.listServerTools(client, server.timeoutMs);
      const latencyMs = Date.now() - startedAt;
      const protocolVersion =
        typeof (transport as { protocolVersion?: unknown }).protocolVersion === 'string'
          ? ((transport as { protocolVersion?: string }).protocolVersion as string)
          : undefined;

      return {
        serverId: server.id,
        transport: transportMode,
        client,
        toolNames,
        protocolVersion,
        latencyMs,
      };
    } catch (error) {
      try {
        if (typeof client.close === 'function') {
          await client.close();
        }
      } catch {
        // Ignore cleanup errors.
      }
      try {
        if (typeof transport?.close === 'function') {
          await transport.close();
        }
      } catch {
        // Ignore cleanup errors.
      }
      throw error;
    }
  }

  private async createConnectedClient(server: McpServerConfig): Promise<ConnectedClient> {
    if (server.transport === 'http') {
      try {
        return await this.connectViaTransport(server, 'http');
      } catch (primaryError) {
        if (!server.sseFallback || !shouldFallbackToSse(primaryError)) {
          throw primaryError;
        }
        try {
          return await this.connectViaTransport(server, 'sse');
        } catch (fallbackError) {
          const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          throw new Error(
            `Streamable HTTP failed (${primaryMessage}); SSE fallback failed (${fallbackMessage}).`
          );
        }
      }
    }

    return this.connectViaTransport(server, server.transport);
  }

  async acquire(server: McpServerConfig): Promise<ConnectedClient> {
    const now = Date.now();
    const fingerprint = getConfigFingerprint(server);
    const existing = this.entries.get(server.id);

    if (existing && existing.configFingerprint !== fingerprint) {
      await this.closeEntry(server.id);
    }

    let entry = this.entries.get(server.id);
    if (!entry) {
      entry = {
        serverId: server.id,
        configFingerprint: fingerprint,
        state: 'closed',
        connectedClient: null,
        connectPromise: null,
        lastError: null,
        nextRetryAt: 0,
        retryDelayMs: RETRY_BASE_DELAY_MS,
        idleTimer: null,
        lastUsedAt: now,
      };
      this.entries.set(server.id, entry);
    }

    entry.lastUsedAt = now;
    this.scheduleIdleClose(entry);

    if (entry.state === 'ready' && entry.connectedClient) {
      return entry.connectedClient;
    }

    if (entry.connectPromise) {
      return entry.connectPromise;
    }

    if (entry.state === 'degraded' && now < entry.nextRetryAt) {
      throw classifyError(
        entry.lastError || new Error(`MCP server ${server.id} is cooling down after failure.`),
        'connect_timeout'
      );
    }

    entry.state = 'connecting';
    entry.connectPromise = (async () => {
      try {
        const connected = await this.createConnectedClient(server);
        entry.state = 'ready';
        entry.connectedClient = connected;
        entry.lastError = null;
        entry.nextRetryAt = 0;
        entry.retryDelayMs = RETRY_BASE_DELAY_MS;
        return connected;
      } catch (error) {
        const normalized = classifyError(error);
        entry.state = 'degraded';
        entry.connectedClient = null;
        entry.lastError = normalized;
        entry.nextRetryAt = Date.now() + entry.retryDelayMs;
        entry.retryDelayMs = Math.min(entry.retryDelayMs * 2, RETRY_MAX_DELAY_MS);
        throw normalized;
      } finally {
        entry.connectPromise = null;
      }
    })();

    return entry.connectPromise;
  }

  async probe(server: McpServerConfig): Promise<{
    available: boolean;
    attachable: boolean;
    statusMessage: string;
    code?: McpSkippedReasonCode;
    protocolVersion?: string;
    toolCount?: number;
    latencyMs?: number;
    transport?: McpTransport;
  }> {
    const fingerprint = getConfigFingerprint(server);
    const cached = this.probeCache.get(server.id);
    if (cached && cached.fingerprint === fingerprint && cached.expiresAt > Date.now()) {
      return cached.status;
    }

    const status = await (async () => {
      try {
        const connected = await this.acquire(server);
        return {
          available: true,
          attachable: true,
          statusMessage: `Handshake ok via ${connected.transport.toUpperCase()} (${connected.toolNames.length} tools).`,
          protocolVersion: connected.protocolVersion,
          toolCount: connected.toolNames.length,
          latencyMs: connected.latencyMs,
          transport: connected.transport,
        };
      } catch (error) {
        const normalized = classifyError(error);
        return {
          available: false,
          attachable: false,
          statusMessage: normalized.message,
          code: normalized.code,
        };
      }
    })();

    this.probeCache.set(server.id, {
      fingerprint,
      expiresAt: Date.now() + STATUS_CACHE_TTL_MS,
      status,
    });

    return status;
  }

  async closeAll(): Promise<void> {
    const serverIds = [...this.entries.keys()];
    await Promise.all(serverIds.map((serverId) => this.closeEntry(serverId)));
    this.probeCache.clear();
  }
}

let singletonPool: McpConnectionPool | null = null;

export const getMcpConnectionPool = (): McpConnectionPool => {
  if (!singletonPool) {
    singletonPool = new McpConnectionPool();
  }
  return singletonPool;
};
