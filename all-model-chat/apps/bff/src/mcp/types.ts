import type { McpServerStatus } from '@all-model-chat/shared-api';

export type McpTransport = 'stdio' | 'http' | 'sse';

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
  skipped: Array<{ id: string; reason: string }>;
  close: () => Promise<void>;
}

export interface McpStatusContext {
  runtime: McpRuntimeConfig;
  statuses: McpServerStatus[];
}
