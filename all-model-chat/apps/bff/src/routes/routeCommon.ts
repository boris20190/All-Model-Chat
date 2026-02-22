import { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiErrorPayload } from '@all-model-chat/shared-api';

export const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export class RequestValidationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

export const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

export const sanitizeApiKey = (rawKey: string): string => {
  return rawKey
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u00A0]/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
    .replace(/^["']+|["']+$/g, '');
};

export const sendJson = (response: ServerResponse, status: number, payload: unknown): void => {
  response.writeHead(status, JSON_HEADERS);
  response.end(JSON.stringify(payload));
};

const readRequestBody = async (
  request: IncomingMessage,
  options: {
    maxBytes: number;
    encoding?: BufferEncoding;
  }
): Promise<Buffer | string> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let isCompleted = false;

    if (options.encoding) {
      request.setEncoding(options.encoding);
    }

    request.on('data', (chunk: Buffer | string) => {
      if (isCompleted) return;

      const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, options.encoding || 'utf8');
      totalBytes += bufferChunk.length;

      if (totalBytes > options.maxBytes) {
        isCompleted = true;
        reject(
          new RequestValidationError(
            'payload_too_large',
            413,
            `Request body exceeds ${options.maxBytes} bytes.`
          )
        );
        request.destroy();
        return;
      }

      chunks.push(bufferChunk);
    });

    request.on('end', () => {
      if (isCompleted) return;
      isCompleted = true;
      const buffer = Buffer.concat(chunks);
      if (options.encoding) {
        resolve(buffer.toString(options.encoding));
        return;
      }
      resolve(buffer);
    });

    request.on('aborted', () => {
      if (isCompleted) return;
      isCompleted = true;
      reject(new RequestValidationError('request_aborted', 499, 'Request was aborted by the client.'));
    });

    request.on('error', (error) => {
      if (isCompleted) return;
      isCompleted = true;
      reject(error);
    });
  });
};

export const readJsonBody = async (
  request: IncomingMessage,
  maxBytes: number = 2 * 1024 * 1024
): Promise<unknown> => {
  const rawBody = (await readRequestBody(request, {
    maxBytes,
    encoding: 'utf8',
  })) as string;

  if (!rawBody.trim()) {
    throw new RequestValidationError('invalid_request', 400, 'Request body is required.');
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new RequestValidationError('invalid_json', 400, 'Request body must be valid JSON.');
  }
};

export const readBinaryBody = async (
  request: IncomingMessage,
  maxBytes: number = 64 * 1024 * 1024
): Promise<Buffer> => {
  const body = await readRequestBody(request, { maxBytes });
  return body as Buffer;
};

const readNumericStatus = (error: unknown): number | null => {
  if (!isObject(error)) return null;

  const status = error.status;
  if (typeof status === 'number' && Number.isFinite(status)) return status;

  const statusCode = error.statusCode;
  if (typeof statusCode === 'number' && Number.isFinite(statusCode)) return statusCode;

  return null;
};

const tryParseJsonObject = (rawText: string | undefined): Record<string, unknown> | null => {
  if (!rawText) return null;
  const text = rawText.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return null;

  try {
    const parsed = JSON.parse(text);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const readProviderReasonFromDetails = (details: unknown): string | undefined => {
  if (!Array.isArray(details)) return undefined;

  for (const item of details) {
    if (!isObject(item)) continue;
    if (typeof item.reason === 'string' && item.reason.length > 0) {
      return item.reason;
    }
  }

  return undefined;
};

const extractProviderDiagnostics = (
  error: unknown,
  rawMessage: string
): {
  providerStatus?: string;
  providerReason?: string;
  providerMessage?: string;
} => {
  let providerStatus: string | undefined;
  let providerReason: string | undefined;
  let providerMessage: string | undefined;

  const parsedDirect = tryParseJsonObject(rawMessage);
  const parsedDirectError = isObject(parsedDirect?.error) ? parsedDirect.error : null;

  const sdkPayload = isObject(error) && typeof error.message === 'string'
    ? tryParseJsonObject(error.message)
    : null;
  const sdkError = isObject(sdkPayload?.error) ? sdkPayload.error : null;

  const nestedProviderPayload = tryParseJsonObject(
    (typeof sdkError?.message === 'string' && sdkError.message) ||
      (typeof parsedDirectError?.message === 'string' ? parsedDirectError.message : undefined)
  );
  const nestedProviderError = isObject(nestedProviderPayload?.error) ? nestedProviderPayload.error : null;

  providerMessage =
    (typeof nestedProviderError?.message === 'string' && nestedProviderError.message) ||
    (typeof parsedDirectError?.message === 'string' && parsedDirectError.message) ||
    (typeof sdkError?.message === 'string' && sdkError.message) ||
    undefined;

  providerStatus =
    (typeof nestedProviderError?.status === 'string' && nestedProviderError.status) ||
    (typeof parsedDirectError?.status === 'string' && parsedDirectError.status) ||
    (typeof sdkError?.status === 'string' && sdkError.status) ||
    undefined;

  providerReason =
    readProviderReasonFromDetails(nestedProviderError?.details) ||
    readProviderReasonFromDetails(parsedDirectError?.details) ||
    readProviderReasonFromDetails(sdkError?.details);

  return {
    providerStatus,
    providerReason,
    providerMessage,
  };
};

export const mapProviderError = (error: unknown): ApiErrorPayload => {
  if (error instanceof RequestValidationError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      retryable: false,
    };
  }

  const status = readNumericStatus(error) ?? 500;
  const message = error instanceof Error ? error.message : 'Upstream request failed.';
  const providerDiagnostics = extractProviderDiagnostics(error, message);
  const messageForClient = providerDiagnostics.providerMessage || message;
  const matchText = `${message}\n${providerDiagnostics.providerMessage || ''}`;

  if (matchText.includes('does not support uploading files')) {
    return {
      code: 'provider_feature_not_supported',
      message: messageForClient,
      status: 400,
      retryable: false,
      ...providerDiagnostics,
    };
  }
  if (matchText.includes('only supported by the Gemini Developer API')) {
    return {
      code: 'provider_feature_not_supported',
      message: messageForClient,
      status: 400,
      retryable: false,
      ...providerDiagnostics,
    };
  }
  if (matchText.includes('No provider API keys configured.')) {
    return {
      code: 'provider_key_not_configured',
      message: messageForClient,
      status: 503,
      retryable: false,
      ...providerDiagnostics,
    };
  }
  if (matchText.includes('No provider API keys available.')) {
    return {
      code: 'provider_key_temporarily_unavailable',
      message: messageForClient,
      status: 503,
      retryable: true,
      ...providerDiagnostics,
    };
  }
  if (status === 400) {
    return {
      code: 'provider_invalid_request',
      message: messageForClient,
      status,
      retryable: false,
      ...providerDiagnostics,
    };
  }
  if (status === 401) {
    return {
      code: 'provider_auth_failed',
      message: messageForClient,
      status,
      retryable: false,
      ...providerDiagnostics,
    };
  }
  if (status === 403) {
    return {
      code: 'provider_forbidden',
      message: messageForClient,
      status,
      retryable: false,
      ...providerDiagnostics,
    };
  }
  if (status === 404) {
    return {
      code: 'provider_not_found',
      message: messageForClient,
      status,
      retryable: false,
      ...providerDiagnostics,
    };
  }
  if (status === 408) {
    return {
      code: 'provider_timeout',
      message: messageForClient,
      status,
      retryable: true,
      ...providerDiagnostics,
    };
  }
  if (status === 429) {
    return {
      code: 'provider_rate_limited',
      message: messageForClient,
      status,
      retryable: true,
      ...providerDiagnostics,
    };
  }
  if (status >= 500 && status <= 599) {
    return {
      code: 'provider_upstream_error',
      message: messageForClient,
      status,
      retryable: true,
      ...providerDiagnostics,
    };
  }

  return {
    code: 'provider_unknown_error',
    message: messageForClient,
    status,
    retryable: status >= 500 || status === 429,
    ...providerDiagnostics,
  };
};

export const parseRequestUrl = (request: IncomingMessage): URL => {
  return new URL(request.url || '/', 'http://127.0.0.1');
};
