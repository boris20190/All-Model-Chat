import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { BffConfig } from '../config/env.js';
import type { McpRuntimeConfig, McpServerConfig, McpTransport } from './types.js';

const DEFAULT_MCP_CONFIG_PATH = '~/apps/all-model-chat-runtime/mcp.servers.json';
const MCP_RUNTIME_STATE_FILE_NAME = 'mcp.runtime.json';
const DEFAULT_MCP_TIMEOUT_MS = 15000;
const DEFAULT_MCP_CONNECT_TIMEOUT_MS = 20000;
let writeQueue: Promise<void> = Promise.resolve();

interface ParsedMcpConfigFile {
  servers: McpServerConfig[];
}

export interface McpManagedConfig {
  enabled: boolean;
  configPath: string;
  servers: McpServerConfig[];
  warnings: string[];
}

export interface McpImportSummary {
  created: string[];
  updated: string[];
  skipped: Array<{ id: string; reason: string }>;
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const expandHomePath = (rawPath: string): string => {
  if (!rawPath.startsWith('~/')) return rawPath;
  return path.join(os.homedir(), rawPath.slice(2));
};

const toAbsolutePath = (rawPath: string): string => {
  const expanded = expandHomePath(rawPath.trim());
  if (path.isAbsolute(expanded)) return expanded;
  return path.resolve(expanded);
};

const normalizeTransport = (value: unknown): McpTransport | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'stdio' || normalized === 'http' || normalized === 'sse') {
    return normalized;
  }
  return null;
};

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const normalizeArgs = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
};

const normalizeEnvMap = (value: unknown): Record<string, string> => {
  if (!isObject(value)) return {};

  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== 'string') continue;
    result[key] = raw;
  }

  return result;
};

const normalizeHeaders = (value: unknown): Record<string, string> => {
  if (!isObject(value)) return {};
  const result: Record<string, string> = {};

  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== 'string') continue;
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    result[normalizedKey] = raw;
  }

  return result;
};

const normalizePositiveInteger = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return value;
};

const normalizeServerConfig = (
  rawServer: unknown,
  index: number,
  seenIds: Set<string>,
  warnings: string[]
): McpServerConfig | null => {
  if (!isObject(rawServer)) {
    warnings.push(`mcp.servers[${index}] must be an object.`);
    return null;
  }

  const id = normalizeString(rawServer.id);
  if (!id) {
    warnings.push(`mcp.servers[${index}] is missing required string field \"id\".`);
    return null;
  }

  if (seenIds.has(id)) {
    warnings.push(`mcp.servers[${index}] has duplicate id \"${id}\" and was skipped.`);
    return null;
  }

  const transport = normalizeTransport(rawServer.transport);
  if (!transport) {
    warnings.push(
      `mcp.servers[${index}] has unsupported transport \"${String(
        (rawServer as Record<string, unknown>).transport
      )}\".`
    );
    return null;
  }

  const name = normalizeString(rawServer.name) || id;
  const enabledRaw = rawServer.enabled;
  const enabled = typeof enabledRaw === 'boolean' ? enabledRaw : true;
  const sseFallbackRaw = rawServer.sseFallback;
  const sseFallback = typeof sseFallbackRaw === 'boolean' ? sseFallbackRaw : true;
  const timeoutMs = normalizePositiveInteger(rawServer.timeoutMs, DEFAULT_MCP_TIMEOUT_MS);
  const connectTimeoutFallback = Math.max(DEFAULT_MCP_CONNECT_TIMEOUT_MS, timeoutMs);

  const server: McpServerConfig = {
    id,
    name,
    transport,
    enabled,
    command: normalizeString(rawServer.command),
    args: normalizeArgs(rawServer.args),
    env: normalizeEnvMap(rawServer.env),
    cwd: normalizeString(rawServer.cwd),
    url: normalizeString(rawServer.url),
    headers: normalizeHeaders(rawServer.headers),
    sseFallback,
    connectTimeoutMs: normalizePositiveInteger(rawServer.connectTimeoutMs, connectTimeoutFallback),
    timeoutMs,
  };

  if (transport === 'stdio' && !server.command) {
    warnings.push(`mcp.servers[${index}] (${id}) requires \"command\" for stdio transport.`);
    return null;
  }

  if ((transport === 'http' || transport === 'sse') && !server.url) {
    warnings.push(`mcp.servers[${index}] (${id}) requires \"url\" for ${transport} transport.`);
    return null;
  }

  seenIds.add(id);
  return server;
};

const parseServersArray = (rawServers: unknown, warnings: string[]): McpServerConfig[] => {
  if (!Array.isArray(rawServers)) {
    warnings.push('MCP config must contain an array field \"servers\".');
    return [];
  }

  const seenIds = new Set<string>();
  const servers: McpServerConfig[] = [];

  rawServers.forEach((rawServer, index) => {
    const normalized = normalizeServerConfig(rawServer, index, seenIds, warnings);
    if (normalized) {
      servers.push(normalized);
    }
  });

  return servers;
};

const normalizeFromMcpServersObject = (
  rawMcpServers: unknown,
  warnings: string[]
): McpServerConfig[] => {
  if (!isObject(rawMcpServers)) {
    warnings.push('Import payload must contain an object field \"mcpServers\".');
    return [];
  }

  const rawServers: unknown[] = [];
  for (const [key, value] of Object.entries(rawMcpServers)) {
    if (!isObject(value)) {
      warnings.push(`mcpServers.${key} must be an object.`);
      continue;
    }

    rawServers.push({
      ...value,
      id: normalizeString(value.id) || key,
      transport: normalizeString(value.transport) || 'stdio',
    });
  }

  return parseServersArray(rawServers, warnings);
};

const parseConfigJson = (rawText: string, warnings: string[]): ParsedMcpConfigFile => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    warnings.push(
      `Failed to parse MCP config JSON: ${error instanceof Error ? error.message : String(error)}.`
    );
    return { servers: [] };
  }

  if (!isObject(parsed)) {
    warnings.push('MCP config root must be a JSON object.');
    return { servers: [] };
  }

  if (Array.isArray(parsed.servers)) {
    return {
      servers: parseServersArray(parsed.servers, warnings),
    };
  }

  if (isObject(parsed.mcpServers)) {
    return {
      servers: normalizeFromMcpServersObject(parsed.mcpServers, warnings),
    };
  }

  warnings.push('MCP config must include either "servers" array or "mcpServers" object.');
  return { servers: [] };
};

const parseImportPayload = (
  payload: unknown,
  warnings: string[]
): { enabled?: boolean; servers: McpServerConfig[] } => {
  if (!isObject(payload)) {
    warnings.push('Import payload root must be a JSON object.');
    return { servers: [] };
  }

  const enabled = typeof payload.enabled === 'boolean' ? payload.enabled : undefined;

  if (Array.isArray(payload.servers)) {
    return { enabled, servers: parseServersArray(payload.servers, warnings) };
  }

  if (isObject(payload.mcpServers)) {
    return { enabled, servers: normalizeFromMcpServersObject(payload.mcpServers, warnings) };
  }

  warnings.push('Import payload must include either \"servers\" or \"mcpServers\".');
  return { enabled, servers: [] };
};

const ensureParentDir = async (filePath: string): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
};

const enqueueWrite = async <T>(writer: () => Promise<T>): Promise<T> => {
  const previous = writeQueue;
  let releaseQueue: () => void = () => {};
  writeQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previous;
  try {
    return await writer();
  } finally {
    releaseQueue();
  }
};

const resolveMcpStatePath = (configPath: string): string => {
  return path.join(path.dirname(configPath), MCP_RUNTIME_STATE_FILE_NAME);
};

const persistConfigFile = async (
  configPath: string,
  payload: { servers: McpServerConfig[] }
): Promise<void> => {
  await ensureParentDir(configPath);
  const serialized = JSON.stringify(
    {
      servers: payload.servers,
    },
    null,
    2
  );
  await writeFile(configPath, `${serialized}\n`, 'utf8');
};

const persistMcpEnabledState = async (configPath: string, enabled: boolean): Promise<void> => {
  const statePath = resolveMcpStatePath(configPath);
  await ensureParentDir(statePath);
  const serialized = JSON.stringify({ enabled }, null, 2);
  await writeFile(statePath, `${serialized}\n`, 'utf8');
};

export const resolveMcpConfigPath = (rawPath: string | undefined): string => {
  return toAbsolutePath(rawPath || DEFAULT_MCP_CONFIG_PATH);
};

const loadRawMcpConfig = async (
  configPath: string
): Promise<{ parsed: ParsedMcpConfigFile; warnings: string[]; fileFound: boolean }> => {
  const warnings: string[] = [];
  let rawText = '';

  try {
    rawText = await readFile(configPath, 'utf8');
  } catch (error) {
    warnings.push(
      `Failed to read MCP config file at ${configPath}: ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
    return {
      parsed: { servers: [] },
      warnings,
      fileFound: false,
    };
  }

  return {
    parsed: parseConfigJson(rawText, warnings),
    warnings,
    fileFound: true,
  };
};

const loadMcpEnabledState = async (
  configPath: string,
  fallbackEnabled: boolean
): Promise<{ enabled: boolean; warnings: string[] }> => {
  const statePath = resolveMcpStatePath(configPath);
  const warnings: string[] = [];

  let rawText = '';
  try {
    rawText = await readFile(statePath, 'utf8');
  } catch (error) {
    const errno = (error as NodeJS.ErrnoException | null)?.code;
    const message = error instanceof Error ? error.message : String(error);
    if (errno === 'ENOENT') {
      return {
        enabled: fallbackEnabled,
        warnings,
      };
    }

    warnings.push(`Failed to read MCP runtime state file at ${statePath}: ${message}.`);
    return {
      enabled: fallbackEnabled,
      warnings,
    };
  }

  try {
    const parsed = JSON.parse(rawText);
    if (!isObject(parsed)) {
      warnings.push(`MCP runtime state file at ${statePath} must be a JSON object.`);
      return {
        enabled: fallbackEnabled,
        warnings,
      };
    }

    if (typeof parsed.enabled === 'boolean') {
      return {
        enabled: parsed.enabled,
        warnings,
      };
    }

    warnings.push(`MCP runtime state file at ${statePath} is missing boolean field "enabled".`);
    return {
      enabled: fallbackEnabled,
      warnings,
    };
  } catch (error) {
    warnings.push(
      `Failed to parse MCP runtime state JSON at ${statePath}: ${
        error instanceof Error ? error.message : String(error)
      }.`
    );
    return {
      enabled: fallbackEnabled,
      warnings,
    };
  }
};

export const loadManagedMcpConfig = async (config: BffConfig): Promise<McpManagedConfig> => {
  const configPath = resolveMcpConfigPath(config.mcpConfigPath);
  const loaded = await loadRawMcpConfig(configPath);
  const runtimeState = await loadMcpEnabledState(configPath, config.mcpEnabled);

  return {
    enabled: runtimeState.enabled,
    configPath,
    servers: loaded.parsed.servers,
    warnings: [...loaded.warnings, ...runtimeState.warnings],
  };
};

export const saveManagedMcpConfig = async (
  config: BffConfig,
  payload: { enabled: boolean; servers: unknown }
): Promise<McpManagedConfig> => {
  const configPath = resolveMcpConfigPath(config.mcpConfigPath);
  const warnings: string[] = [];
  const servers = parseServersArray(payload.servers, warnings);

  await enqueueWrite(async () => {
    await persistConfigFile(configPath, {
      servers,
    });
    await persistMcpEnabledState(configPath, payload.enabled);
  });

  const reloaded = await loadManagedMcpConfig(config);
  return {
    ...reloaded,
    warnings: [...reloaded.warnings, ...warnings],
  };
};

export const importManagedMcpConfig = async (
  config: BffConfig,
  payload: unknown
): Promise<{ config: McpManagedConfig; summary: McpImportSummary }> => {
  const current = await loadManagedMcpConfig(config);
  const warnings: string[] = [];
  const imported = parseImportPayload(payload, warnings);
  const incomingById = new Map(imported.servers.map((server) => [server.id, server]));

  const created: string[] = [];
  const updated: string[] = [];
  const mergedServers: McpServerConfig[] = current.servers.map((server) => {
    const incoming = incomingById.get(server.id);
    if (!incoming) {
      return server;
    }
    updated.push(server.id);
    incomingById.delete(server.id);
    return incoming;
  });

  for (const [id, server] of incomingById.entries()) {
    created.push(id);
    mergedServers.push(server);
  }

  const nextEnabled = typeof imported.enabled === 'boolean' ? imported.enabled : current.enabled;
  await enqueueWrite(async () => {
    await persistConfigFile(current.configPath, {
      servers: mergedServers,
    });
    await persistMcpEnabledState(current.configPath, nextEnabled);
  });

  const reloaded = await loadManagedMcpConfig(config);
  const summary: McpImportSummary = {
    created,
    updated,
    skipped: warnings.map((reason, index) => ({
      id: `warning-${index + 1}`,
      reason,
    })),
  };

  return {
    config: {
      ...reloaded,
      warnings: [...reloaded.warnings, ...warnings],
    },
    summary,
  };
};

export const loadMcpRuntimeConfig = async (config: BffConfig): Promise<McpRuntimeConfig> => {
  if (!config.mcpEnabled) {
    return {
      enabled: false,
      configPath: resolveMcpConfigPath(config.mcpConfigPath),
      servers: [],
      warnings: [],
    };
  }

  const managed = await loadManagedMcpConfig(config);
  const warnings = [...managed.warnings];
  const enabled = managed.enabled;

  return {
    enabled,
    configPath: managed.configPath,
    servers: managed.servers,
    warnings,
  };
};
