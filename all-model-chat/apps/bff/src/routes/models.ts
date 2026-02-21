import { IncomingMessage, ServerResponse } from 'node:http';
import { GoogleGenAI } from '@google/genai';
import { GeminiProviderClient } from '../providers/geminiClient.js';
import {
  RequestValidationError,
  mapProviderError,
  parseRequestUrl,
  sendJson,
} from './routeCommon.js';

const LIST_PAGE_SIZE_DEFAULT = 1000;
const LIST_PAGE_SIZE_MAX = 1000;
const LIST_MAX_PAGES_DEFAULT = 10;
const LIST_MAX_PAGES_CAP = 10;

const GENERATIVE_ACTION_ALLOWLIST = new Set([
  'generateContent',
  'generateImages',
  'editImage',
  'upscaleImage',
]);

const VERTEX_EXPRESS_FALLBACK_MODELS = [
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', rawName: 'models/gemini-3.1-pro-preview' },
  { id: 'gemini-3.1-pro-preview-customtools', name: 'Gemini 3.1 Pro Preview (Custom Tools)', rawName: 'models/gemini-3.1-pro-preview-customtools' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', rawName: 'models/gemini-3-flash-preview' },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview', rawName: 'models/gemini-3-pro-preview' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', rawName: 'models/gemini-2.5-pro' },
  { id: 'gemini-2.5-flash-preview-09-2025', name: 'Gemini 2.5 Flash', rawName: 'models/gemini-2.5-flash-preview-09-2025' },
];

const parseBoundedInteger = (
  rawValue: string | null,
  fieldName: string,
  fallback: number,
  max: number
): number => {
  if (!rawValue) return fallback;
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new RequestValidationError(
      'invalid_request',
      400,
      "'" + fieldName + "' must be an integer between 1 and " + max + "."
    );
  }
  return parsed;
};

const parseBooleanQuery = (
  rawValue: string | null,
  fieldName: string,
  fallback: boolean
): boolean => {
  if (rawValue === null) return fallback;
  const normalized = rawValue.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  throw new RequestValidationError('invalid_request', 400, "'" + fieldName + "' must be a boolean value.");
};

const extractApiKeyOverride = (request: IncomingMessage): string | undefined => {
  const rawHeader = request.headers['x-api-key-override'];
  const value = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeModelId = (rawName: string): string => {
  const trimmed = rawName.trim();
  if (!trimmed) return '';
  const marker = '/models/';
  const markerIndex = trimmed.lastIndexOf(marker);
  if (markerIndex >= 0) {
    return trimmed.slice(markerIndex + marker.length);
  }
  if (trimmed.startsWith('models/')) {
    return trimmed.slice('models/'.length);
  }
  return trimmed;
};

const normalizeSupportedActions = (model: any): string[] => {
  const source = Array.isArray(model.supportedActions) ? model.supportedActions : [];
  return source.map((action: unknown) => String(action).trim()).filter((action: string) => action.length > 0);
};

const shouldIncludeModel = (supportedActions: string[], includeNonGenerative: boolean): boolean => {
  if (includeNonGenerative) return true;
  if (supportedActions.length === 0) return true;
  return supportedActions.some((action) => GENERATIVE_ACTION_ALLOWLIST.has(action));
};

const mergeModelPage = (
  target: Map<string, any>,
  models: any[],
  includeNonGenerative: boolean
): void => {
  for (const model of models) {
    const rawName = typeof model.name === 'string' ? model.name.trim() : '';
    if (!rawName) continue;

    const id = normalizeModelId(rawName);
    if (!id) continue;

    const supportedActions = normalizeSupportedActions(model);
    if (!shouldIncludeModel(supportedActions, includeNonGenerative)) {
      continue;
    }

    const displayName =
      typeof model.displayName === 'string' && model.displayName.trim().length > 0
        ? model.displayName.trim()
        : id;
    const description =
      typeof model.description === 'string' && model.description.trim().length > 0
        ? model.description.trim()
        : undefined;

    const previous = target.get(id);

    target.set(id, {
      id,
      name: displayName,
      rawName,
      description: previous?.description || description,
      supportedActions: supportedActions.length > 0 ? supportedActions : previous?.supportedActions,
    });
  }
};

const withResolvedClient = async <T>(
  providerClient: GeminiProviderClient,
  apiKeyOverride: string | undefined,
  operation: (client: GoogleGenAI) => Promise<T>
): Promise<T> => {
  if (!apiKeyOverride) {
    return providerClient.withClient(async ({ client }) => operation(client));
  }

  const providerConfig = providerClient.getProviderConfigSnapshot();
  const clientOptions: any = {
    apiKey: apiKeyOverride,
    vertexai: providerConfig.useVertexAi,
  };

  if (providerConfig.apiVersion) {
    clientOptions.apiVersion = providerConfig.apiVersion;
  }
  if (providerConfig.baseUrl) {
    clientOptions.httpOptions = { baseUrl: providerConfig.baseUrl };
  }

  const overrideClient = new GoogleGenAI(clientOptions);
  return operation(overrideClient);
};

export const handleModelsRoute = async (
  request: IncomingMessage,
  response: ServerResponse,
  providerClient: GeminiProviderClient
): Promise<void> => {
  if (request.method !== 'GET') {
    sendJson(response, 405, {
      error: { code: 'method_not_allowed', message: 'Method Not Allowed', status: 405 },
    });
    return;
  }

  try {
    const requestUrl = parseRequestUrl(request);
    const pageSize = parseBoundedInteger(
      requestUrl.searchParams.get('pageSize'),
      'pageSize',
      LIST_PAGE_SIZE_DEFAULT,
      LIST_PAGE_SIZE_MAX
    );
    const maxPages = parseBoundedInteger(
      requestUrl.searchParams.get('maxPages'),
      'maxPages',
      LIST_MAX_PAGES_DEFAULT,
      LIST_MAX_PAGES_CAP
    );
    const queryBaseRaw = requestUrl.searchParams.get('queryBase');
    const queryBase = queryBaseRaw === null ? undefined : parseBooleanQuery(queryBaseRaw, 'queryBase', true);
    const includeNonGenerative = parseBooleanQuery(
      requestUrl.searchParams.get('includeNonGenerative'),
      'includeNonGenerative',
      false
    );
    const apiKeyOverride = extractApiKeyOverride(request);

    const modelsById = await withResolvedClient(
      providerClient,
      apiKeyOverride,
      async (client) => {
        const result = new Map<string, any>();
        const listConfig: any = { pageSize };
        if (typeof queryBase === 'boolean') {
          listConfig.queryBase = queryBase;
        }

        const pager = await client.models.list({ config: listConfig });
        mergeModelPage(result, pager.page || [], includeNonGenerative);

        let fetchedPages = 1;
        while (pager.hasNextPage() && fetchedPages < maxPages) {
          const nextPage = await pager.nextPage();
          fetchedPages += 1;
          mergeModelPage(result, nextPage || [], includeNonGenerative);
        }

        return result;
      }
    );

    const payload = {
      models: [...modelsById.values()].sort((left, right) => left.name.localeCompare(right.name)),
    };
    sendJson(response, 200, payload);
  } catch (error: any) {
    const mapped = mapProviderError(error);
    const providerConfig = providerClient.getProviderConfigSnapshot();
    const isVertexExpressListMismatch =
      providerConfig.useVertexAi &&
      mapped.status === 404 &&
      (mapped.message.includes('/publishers/google/models') ||
        mapped.message.includes('base URL') ||
        mapped.message.includes('HTML error page'));

    if (isVertexExpressListMismatch) {
      const payload = {
        models: [...VERTEX_EXPRESS_FALLBACK_MODELS],
      };
      sendJson(response, 200, payload);
      return;
    }

    sendJson(response, mapped.status, { error: mapped });
  }
};
