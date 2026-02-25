import { IncomingMessage, ServerResponse } from 'node:http';
import type {
  McpConfigResponse,
  McpImportResponse,
  McpServersResponse,
} from '@all-model-chat/shared-api';
import type { BffConfig } from '../config/env.js';
import {
  importManagedMcpConfig,
  loadManagedMcpConfig,
  loadMcpRuntimeConfig,
  saveManagedMcpConfig,
} from '../mcp/config.js';
import { buildMcpServerStatusesForMode } from '../mcp/status.js';
import {
  isObject,
  RequestValidationError,
  readJsonBody,
  sendJson,
} from './routeCommon.js';

const sendMethodNotAllowed = (response: ServerResponse, method: string): void => {
  sendJson(response, 405, {
    error: {
      code: 'method_not_allowed',
      message: `Method ${method} Not Allowed`,
      status: 405,
    },
  });
};

const sendBadRequest = (response: ServerResponse, message: string): void => {
  sendJson(response, 400, {
    error: {
      code: 'invalid_request',
      message,
      status: 400,
    },
  });
};

const sendValidationError = (response: ServerResponse, error: RequestValidationError): void => {
  sendJson(response, error.status, {
    error: {
      code: error.code,
      message: error.message,
      status: error.status,
    },
  });
};

export const handleMcpServersRoute = async (
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig
): Promise<void> => {
  if (request.method !== 'GET') {
    sendMethodNotAllowed(response, request.method || 'UNKNOWN');
    return;
  }

  const runtime = await loadMcpRuntimeConfig(config);
  const statuses = await buildMcpServerStatusesForMode(runtime, config.mcpRuntimeMode);

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

export const handleMcpConfigRoute = async (
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig
): Promise<void> => {
  if (request.method === 'GET') {
    const managed = await loadManagedMcpConfig(config);
    const payload: McpConfigResponse = {
      enabled: managed.enabled,
      configPath: managed.configPath,
      servers: managed.servers,
      warnings: managed.warnings,
    };
    sendJson(response, 200, payload);
    return;
  }

  if (request.method !== 'PUT') {
    sendMethodNotAllowed(response, request.method || 'UNKNOWN');
    return;
  }

  let parsed: unknown;
  try {
    parsed = await readJsonBody(request);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      sendValidationError(response, error);
      return;
    }
    throw error;
  }

  if (!isObject(parsed)) {
    sendBadRequest(response, 'Request body must be a JSON object.');
    return;
  }

  if (typeof parsed.enabled !== 'boolean') {
    sendBadRequest(response, '`enabled` must be a boolean.');
    return;
  }

  if (!Array.isArray(parsed.servers)) {
    sendBadRequest(response, '`servers` must be an array.');
    return;
  }

  const saved = await saveManagedMcpConfig(config, {
    enabled: parsed.enabled,
    servers: parsed.servers,
  });

  const payload: McpConfigResponse = {
    enabled: saved.enabled,
    configPath: saved.configPath,
    servers: saved.servers,
    warnings: saved.warnings,
  };
  sendJson(response, 200, payload);
};

export const handleMcpImportRoute = async (
  request: IncomingMessage,
  response: ServerResponse,
  config: BffConfig
): Promise<void> => {
  if (request.method !== 'POST') {
    sendMethodNotAllowed(response, request.method || 'UNKNOWN');
    return;
  }

  let parsed: unknown;
  try {
    parsed = await readJsonBody(request);
  } catch (error) {
    if (error instanceof RequestValidationError) {
      sendValidationError(response, error);
      return;
    }
    throw error;
  }

  const payloadToImport =
    isObject(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'payload')
      ? parsed.payload
      : parsed;

  const imported = await importManagedMcpConfig(config, payloadToImport);
  const payload: McpImportResponse = {
    enabled: imported.config.enabled,
    configPath: imported.config.configPath,
    servers: imported.config.servers,
    warnings: imported.config.warnings,
    summary: imported.summary,
  };
  sendJson(response, 200, payload);
};
