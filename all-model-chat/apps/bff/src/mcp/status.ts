import type { McpServerStatus } from '@all-model-chat/shared-api';
import { spawnSync } from 'node:child_process';
import type { McpRuntimeConfig, McpRuntimeMode, McpServerConfig } from './types.js';
import { getMcpConnectionPool } from './pool/connectionPool.js';

const checkServerConfig = (server: McpServerConfig): { ok: boolean; message: string } => {
  if (!server.enabled) {
    return {
      ok: false,
      message: 'Disabled by configuration.',
    };
  }

  if (server.transport === 'stdio' && !server.command) {
    return {
      ok: false,
      message: 'Missing stdio command.',
    };
  }

  if ((server.transport === 'http' || server.transport === 'sse') && !server.url) {
    return {
      ok: false,
      message: 'Missing transport URL.',
    };
  }

  return {
    ok: true,
    message: 'Configuration valid.',
  };
};

export const buildMcpServerStatuses = async (runtime: McpRuntimeConfig): Promise<McpServerStatus[]> => {
  const checkedAt = new Date().toISOString();
  const pool = getMcpConnectionPool();

  return Promise.all(
    runtime.servers.map(async (server) => {
      const configCheck = checkServerConfig(server);

      if (!configCheck.ok) {
        return {
          id: server.id,
          name: server.name,
          transport: server.transport,
          available: false,
          attachable: false,
          errorCode: 'config_error',
          lastCheckedAt: checkedAt,
          statusMessage: configCheck.message,
        } satisfies McpServerStatus;
      }

      const probe = await pool.probe(server);

      return {
        id: server.id,
        name: server.name,
        transport: probe.transport || server.transport,
        available: probe.available,
        attachable: probe.attachable,
        errorCode: probe.code,
        protocolVersion: probe.protocolVersion,
        toolCount: probe.toolCount,
        latencyMs: probe.latencyMs,
        lastCheckedAt: checkedAt,
        statusMessage: probe.statusMessage,
      } satisfies McpServerStatus;
    })
  );
};

const commandExists = (command: string): boolean => {
  const result = spawnSync('bash', ['-lc', `command -v ${JSON.stringify(command)} >/dev/null 2>&1`], {
    stdio: 'ignore',
  });
  return result.status === 0;
};

const buildLegacyStatus = (server: McpServerConfig, checkedAt: string): McpServerStatus => {
  if (!server.enabled) {
    return {
      id: server.id,
      name: server.name,
      transport: server.transport,
      available: false,
      attachable: false,
      errorCode: 'config_error',
      lastCheckedAt: checkedAt,
      statusMessage: 'Disabled by configuration.',
    };
  }

  if (server.transport === 'stdio') {
    if (!server.command) {
      return {
        id: server.id,
        name: server.name,
        transport: server.transport,
        available: false,
        attachable: false,
        errorCode: 'config_error',
        lastCheckedAt: checkedAt,
        statusMessage: 'Missing stdio command.',
      };
    }

    const available = commandExists(server.command);
    return {
      id: server.id,
      name: server.name,
      transport: server.transport,
      available,
      attachable: available,
      lastCheckedAt: checkedAt,
      statusMessage: available
        ? `Command is resolvable: ${server.command}`
        : `Command not found in PATH: ${server.command}`,
    };
  }

  if (!server.url) {
    return {
      id: server.id,
      name: server.name,
      transport: server.transport,
      available: false,
      attachable: false,
      errorCode: 'config_error',
      lastCheckedAt: checkedAt,
      statusMessage: 'Missing transport URL.',
    };
  }

  try {
    new URL(server.url);
    return {
      id: server.id,
      name: server.name,
      transport: server.transport,
      available: true,
      attachable: false,
      lastCheckedAt: checkedAt,
      statusMessage: `${server.transport.toUpperCase()} endpoint configured (legacy runtime cannot attach remote transports).`,
    };
  } catch {
    return {
      id: server.id,
      name: server.name,
      transport: server.transport,
      available: false,
      attachable: false,
      errorCode: 'config_error',
      lastCheckedAt: checkedAt,
      statusMessage: `Invalid ${server.transport.toUpperCase()} URL: ${server.url}`,
    };
  }
};

export const buildMcpServerStatusesForMode = async (
  runtime: McpRuntimeConfig,
  runtimeMode: McpRuntimeMode
): Promise<McpServerStatus[]> => {
  if (runtimeMode === 'legacy') {
    const checkedAt = new Date().toISOString();
    return runtime.servers.map((server) => buildLegacyStatus(server, checkedAt));
  }

  return buildMcpServerStatuses(runtime);
};
