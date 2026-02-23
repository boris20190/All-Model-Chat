import { IncomingMessage, ServerResponse } from 'node:http';
import type { McpServersResponse } from '@all-model-chat/shared-api';
import type { BffConfig } from '../config/env.js';
import { loadMcpRuntimeConfig } from '../mcp/config.js';
import { buildMcpServerStatuses } from '../mcp/status.js';
import { sendJson } from './routeCommon.js';

export const handleMcpServersRoute = async (
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig
): Promise<void> => {
  if (request.method !== 'GET') {
    sendJson(response, 405, {
      error: {
        code: 'method_not_allowed',
        message: 'Method Not Allowed',
        status: 405,
      },
    });
    return;
  }

  const runtime = await loadMcpRuntimeConfig(config);
  const statuses = buildMcpServerStatuses(runtime);

  const payload: McpServersResponse & {
    warnings?: string[];
  } = {
    enabled: runtime.enabled,
    servers: statuses,
  };

  if (runtime.warnings.length > 0) {
    payload.warnings = runtime.warnings;
  }

  sendJson(response, 200, payload);
};
