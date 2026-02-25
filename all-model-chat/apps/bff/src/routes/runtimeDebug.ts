import { IncomingMessage, ServerResponse } from 'node:http';
import type {
  RuntimeDebugConfigResponse,
  RuntimeDebugConfigUpdateRequest,
} from '@all-model-chat/shared-api';
import { RuntimeErrorLogger } from '../runtime/errorLogger.js';
import {
  RequestValidationError,
  isObject,
  readJsonBody,
  sendJson,
} from './routeCommon.js';
import { saveRuntimeDebugEnabled } from '../runtime/debugConfig.js';

const sendMethodNotAllowed = (response: ServerResponse): void => {
  sendJson(response, 405, {
    error: {
      code: 'method_not_allowed',
      message: 'Method Not Allowed',
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

export const handleRuntimeDebugRoute = async (
  request: IncomingMessage,
  response: ServerResponse,
  errorLogger: RuntimeErrorLogger
): Promise<void> => {
  if (request.method === 'GET') {
    const config = errorLogger.getConfig();
    const payload: RuntimeDebugConfigResponse = {
      enabled: config.enabled,
      logPath: config.logPath,
      maxBytes: config.maxBytes,
      maxFiles: config.maxFiles,
    };
    sendJson(response, 200, payload);
    return;
  }

  if (request.method !== 'PUT') {
    sendMethodNotAllowed(response);
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

  const update = parsed as Partial<RuntimeDebugConfigUpdateRequest>;
  if (typeof update.enabled !== 'boolean') {
    sendBadRequest(response, '`enabled` must be a boolean.');
    return;
  }

  await saveRuntimeDebugEnabled(update.enabled);
  errorLogger.setEnabled(update.enabled);

  const config = errorLogger.getConfig();
  const payload: RuntimeDebugConfigResponse = {
    enabled: config.enabled,
    logPath: config.logPath,
    maxBytes: config.maxBytes,
    maxFiles: config.maxFiles,
  };
  sendJson(response, 200, payload);
};
