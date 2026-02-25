import type {
    McpConfigResponse,
    McpImportRequest,
    McpImportResponse,
    McpServersResponse,
    RuntimeDebugConfigResponse,
    RuntimeDebugConfigUpdateRequest,
} from '@all-model-chat/shared-api';
import { fetchBffJson } from './bffApi';

interface McpServersResponseWithWarnings extends McpServersResponse {
    warnings?: string[];
}

export const getMcpServersApi = async (signal?: AbortSignal): Promise<McpServersResponseWithWarnings> => {
    return fetchBffJson<McpServersResponseWithWarnings>('/api/mcp/servers', { method: 'GET' }, signal);
};

export const getMcpConfigApi = async (signal?: AbortSignal): Promise<McpConfigResponse> => {
    return fetchBffJson<McpConfigResponse>('/api/mcp/config', { method: 'GET' }, signal);
};

export const putMcpConfigApi = async (
    payload: Pick<McpConfigResponse, 'enabled' | 'servers'>,
    signal?: AbortSignal
): Promise<McpConfigResponse> => {
    return fetchBffJson<McpConfigResponse>(
        '/api/mcp/config',
        {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        },
        signal
    );
};

export const importMcpConfigApi = async (
    payload: McpImportRequest,
    signal?: AbortSignal
): Promise<McpImportResponse> => {
    return fetchBffJson<McpImportResponse>(
        '/api/mcp/config/import',
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        },
        signal
    );
};

export const getRuntimeDebugApi = async (signal?: AbortSignal): Promise<RuntimeDebugConfigResponse> => {
    return fetchBffJson<RuntimeDebugConfigResponse>('/api/runtime/debug', { method: 'GET' }, signal);
};

export const setRuntimeDebugApi = async (
    payload: RuntimeDebugConfigUpdateRequest,
    signal?: AbortSignal
): Promise<RuntimeDebugConfigResponse> => {
    return fetchBffJson<RuntimeDebugConfigResponse>(
        '/api/runtime/debug',
        {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        },
        signal
    );
};
