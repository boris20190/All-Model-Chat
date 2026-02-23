import type { McpServersResponse } from '@all-model-chat/shared-api';
import { fetchBffJson } from './bffApi';

interface McpServersResponseWithWarnings extends McpServersResponse {
    warnings?: string[];
}

export const getMcpServersApi = async (signal?: AbortSignal): Promise<McpServersResponseWithWarnings> => {
    return fetchBffJson<McpServersResponseWithWarnings>('/api/mcp/servers', { method: 'GET' }, signal);
};
