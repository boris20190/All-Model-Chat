import { spawnSync } from 'node:child_process';
import type { McpServerStatus } from '@all-model-chat/shared-api';
import type { McpRuntimeConfig, McpServerConfig } from './types.js';

const commandExists = (command: string): boolean => {
  const result = spawnSync('bash', ['-lc', `command -v ${JSON.stringify(command)} >/dev/null 2>&1`], {
    stdio: 'ignore',
  });
  return result.status === 0;
};

const checkServerAvailability = (server: McpServerConfig): { available: boolean; statusMessage: string } => {
  if (!server.enabled) {
    return {
      available: false,
      statusMessage: 'Disabled by configuration.',
    };
  }

  if (server.transport === 'stdio') {
    if (!server.command) {
      return {
        available: false,
        statusMessage: 'Missing stdio command.',
      };
    }

    return commandExists(server.command)
      ? {
          available: true,
          statusMessage: `Command is resolvable: ${server.command}`,
        }
      : {
          available: false,
          statusMessage: `Command not found in PATH: ${server.command}`,
        };
  }

  if (!server.url) {
    return {
      available: false,
      statusMessage: 'Missing transport URL.',
    };
  }

  try {
    // Validate URL format only to keep status checks lightweight.
    // Runtime attach currently supports stdio servers.
    new URL(server.url);
    return {
      available: true,
      statusMessage: `${server.transport.toUpperCase()} endpoint configured.`,
    };
  } catch {
    return {
      available: false,
      statusMessage: `Invalid ${server.transport.toUpperCase()} URL: ${server.url}`,
    };
  }
};

export const buildMcpServerStatuses = (runtime: McpRuntimeConfig): McpServerStatus[] => {
  const checkedAt = new Date().toISOString();

  return runtime.servers.map((server) => {
    const availability = checkServerAvailability(server);

    return {
      id: server.id,
      name: server.name,
      available: availability.available,
      lastCheckedAt: checkedAt,
      statusMessage: availability.statusMessage,
    };
  });
};
