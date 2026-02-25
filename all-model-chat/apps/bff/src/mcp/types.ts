import type { McpServerStatus } from '@all-model-chat/shared-api';

export type McpTransport = 'stdio' | 'http' | 'sse';
export type McpRuntimeMode = 'legacy' | 'sdk';

export type McpSkippedReasonCode =
  | 'config_error'
  | 'connect_timeout'
  | 'initialize_failed'
  | 'list_tools_failed';

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransport;
  enabled: boolean;
  command?: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  url?: string;
  headers: Record<string, string>;
  sseFallback: boolean;
  connectTimeoutMs: number;
  timeoutMs: number;
}

export interface McpRuntimeConfig {
  enabled: boolean;
  configPath: string;
  servers: McpServerConfig[];
  warnings: string[];
}

export interface McpAttachResult {
  tools: unknown[];
  attachedServerIds: string[];
  attachMeta: Array<{
    serverId: string;
    transport: string;
    protocolVersion?: string;
    toolCount?: number;
    latencyMs?: number;
  }>;
  skipped: Array<{ id: string; reason: string; code?: McpSkippedReasonCode }>;
  invokedTools: Array<{ serverId: string; toolName: string }>;
  close: () => Promise<void>;
}

export interface McpStatusContext {
  runtime: McpRuntimeConfig;
  statuses: McpServerStatus[];
}
