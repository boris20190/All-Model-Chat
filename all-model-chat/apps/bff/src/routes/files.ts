import { IncomingMessage, ServerResponse } from 'node:http';
import { GeminiProviderClient } from '../providers/geminiClient.js';
import type { FileMetadataResponse, FileUploadResponse } from '@all-model-chat/shared-api';
import {
  RequestValidationError,
  mapProviderError,
  parseRequestUrl,
  readBinaryBody,
  sendJson,
} from './routeCommon.js';

const LIST_PAGE_SIZE_DEFAULT = 50;
const LIST_PAGE_SIZE_MAX = 100;

const isFileNotFoundError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : '';
  return message.includes('NOT_FOUND') || message.includes('404');
};

const parseListPageSize = (rawPageSize: string | null): number => {
  if (!rawPageSize) return LIST_PAGE_SIZE_DEFAULT;

  const pageSize = Number.parseInt(rawPageSize, 10);
  if (!Number.isInteger(pageSize) || pageSize <= 0 || pageSize > LIST_PAGE_SIZE_MAX) {
    throw new RequestValidationError(
      'invalid_request',
      400,
      `\`pageSize\` must be an integer between 1 and ${LIST_PAGE_SIZE_MAX}.`
    );
  }

  return pageSize;
};

const ensureFilesApiSupported = (geminiProviderClient: GeminiProviderClient): void => {
  if (!geminiProviderClient.getProviderConfigSnapshot().useVertexAi) return;

  throw new RequestValidationError(
    'provider_feature_not_supported',
    400,
    'Files list/delete APIs are currently supported only in Gemini Developer API mode. Disable Vertex mode in BFF configuration to use this feature.'
  );
};

const handleFileUpload = async (
  request: IncomingMessage,
  response: ServerResponse,
  geminiProviderClient: GeminiProviderClient
): Promise<void> => {
  const requestUrl = parseRequestUrl(request);
  const displayName = requestUrl.searchParams.get('displayName')?.trim() || '';
  const mimeType = requestUrl.searchParams.get('mimeType')?.trim() || '';

  if (!displayName) {
    throw new RequestValidationError('invalid_request', 400, '`displayName` query parameter is required.');
  }
  if (!mimeType) {
    throw new RequestValidationError('invalid_request', 400, '`mimeType` query parameter is required.');
  }

  const body = await readBinaryBody(request, 64 * 1024 * 1024);
  if (body.length === 0) {
    throw new RequestValidationError('invalid_request', 400, 'Upload body is empty.');
  }

  const uploadedFile = await geminiProviderClient.withClient(async ({ client }) => {
    const fileBlob = new Blob([new Uint8Array(body)], { type: mimeType });
    return client.files.upload({
      file: fileBlob,
      config: {
        displayName,
        mimeType,
      },
    });
  });

  const payload: FileUploadResponse = { file: uploadedFile };
  sendJson(response, 200, payload);
};

const handleFileMetadata = async (
  request: IncomingMessage,
  response: ServerResponse,
  geminiProviderClient: GeminiProviderClient
): Promise<void> => {
  const requestUrl = parseRequestUrl(request);
  const name = requestUrl.searchParams.get('name')?.trim() || '';

  if (!name) {
    throw new RequestValidationError('invalid_request', 400, '`name` query parameter is required.');
  }

  try {
    const file = await geminiProviderClient.withClient(async ({ client }) => {
      return client.files.get({ name });
    });

    const payload: FileMetadataResponse = { file };
    sendJson(response, 200, payload);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      const payload: FileMetadataResponse = { file: null };
      sendJson(response, 200, payload);
      return;
    }

    throw error;
  }
};

const handleFileList = async (
  request: IncomingMessage,
  response: ServerResponse,
  geminiProviderClient: GeminiProviderClient
): Promise<void> => {
  ensureFilesApiSupported(geminiProviderClient);

  const requestUrl = parseRequestUrl(request);
  const pageSize = parseListPageSize(requestUrl.searchParams.get('pageSize')?.trim() || null);
  const pageToken = requestUrl.searchParams.get('pageToken')?.trim() || undefined;

  const { files, nextPageToken } = await geminiProviderClient.withClient(async ({ client }) => {
    const pager = await client.files.list({
      config: {
        pageSize,
        ...(pageToken ? { pageToken } : {}),
      },
    });

    return {
      files: pager.page || [],
      nextPageToken: pager.params.config?.pageToken || undefined,
    };
  });

  sendJson(response, 200, { files, nextPageToken });
};

const handleFileDelete = async (
  request: IncomingMessage,
  response: ServerResponse,
  geminiProviderClient: GeminiProviderClient
): Promise<void> => {
  ensureFilesApiSupported(geminiProviderClient);

  const requestUrl = parseRequestUrl(request);
  const name = requestUrl.searchParams.get('name')?.trim() || '';

  if (!name) {
    throw new RequestValidationError('invalid_request', 400, '`name` query parameter is required.');
  }
  if (!name.startsWith('files/')) {
    throw new RequestValidationError('invalid_request', 400, '`name` must start with `files/`.');
  }

  await geminiProviderClient.withClient(async ({ client }) => {
    await client.files.delete({ name });
    return null;
  });

  sendJson(response, 200, { ok: true, name });
};

export const handleFilesRoute = async (
  request: IncomingMessage,
  response: ServerResponse,
  geminiProviderClient: GeminiProviderClient
): Promise<boolean> => {
  const method = request.method || 'GET';
  const path = (request.url || '/').split('?')[0];

  if (path === '/api/files/upload') {
    if (method !== 'POST') {
      sendJson(response, 405, { error: { code: 'method_not_allowed', message: 'Method Not Allowed', status: 405 } });
      return true;
    }

    try {
      await handleFileUpload(request, response, geminiProviderClient);
    } catch (error) {
      const mapped = mapProviderError(error);
      sendJson(response, mapped.status, { error: mapped });
    }
    return true;
  }

  if (path === '/api/files/list') {
    if (method !== 'GET') {
      sendJson(response, 405, { error: { code: 'method_not_allowed', message: 'Method Not Allowed', status: 405 } });
      return true;
    }

    try {
      await handleFileList(request, response, geminiProviderClient);
    } catch (error) {
      const mapped = mapProviderError(error);
      sendJson(response, mapped.status, { error: mapped });
    }
    return true;
  }

  if (path === '/api/files/delete') {
    if (method !== 'DELETE') {
      sendJson(response, 405, { error: { code: 'method_not_allowed', message: 'Method Not Allowed', status: 405 } });
      return true;
    }

    try {
      await handleFileDelete(request, response, geminiProviderClient);
    } catch (error) {
      const mapped = mapProviderError(error);
      sendJson(response, mapped.status, { error: mapped });
    }
    return true;
  }

  if (path === '/api/files/metadata') {
    if (method !== 'GET') {
      sendJson(response, 405, { error: { code: 'method_not_allowed', message: 'Method Not Allowed', status: 405 } });
      return true;
    }

    try {
      await handleFileMetadata(request, response, geminiProviderClient);
    } catch (error) {
      const mapped = mapProviderError(error);
      sendJson(response, mapped.status, { error: mapped });
    }
    return true;
  }

  return false;
};
