import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { BffConfig } from '../config/env.js';
import type { McpRuntimeConfig, McpServerConfig, McpTransport } from './types.js';

const DEFAULT_MCP_CONFIG_PATH = '~/apps/all-model-chat-runtime/mcp.servers.json';
const DEFAULT_MCP_TIMEOUT_MS = 15000;

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
    timeoutMs: normalizePositiveInteger(rawServer.timeoutMs, DEFAULT_MCP_TIMEOUT_MS),
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

const parseConfigJson = (rawText: string, warnings: string[]): McpServerConfig[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    warnings.push(
      `Failed to parse MCP config JSON: ${error instanceof Error ? error.message : String(error)}.`
    );
    return [];
  }

  if (!isObject(parsed)) {
    warnings.push('MCP config root must be a JSON object.');
    return [];
  }

  const rawServers = parsed.servers;
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

export const resolveMcpConfigPath = (rawPath: string | undefined): string => {
  return toAbsolutePath(rawPath || DEFAULT_MCP_CONFIG_PATH);
};

export const loadMcpRuntimeConfig = async (config: BffConfig): Promise<McpRuntimeConfig> => {
  const configPath = resolveMcpConfigPath(config.mcpConfigPath);
  const warnings: string[] = [];

  if (!config.mcpEnabled) {
    return {
      enabled: false,
      configPath,
      servers: [],
      warnings,
    };
  }

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
      enabled: true,
      configPath,
      servers: [],
      warnings,
    };
  }

  const servers = parseConfigJson(rawText, warnings);
  return {
    enabled: true,
    configPath,
    servers,
    warnings,
  };
};
