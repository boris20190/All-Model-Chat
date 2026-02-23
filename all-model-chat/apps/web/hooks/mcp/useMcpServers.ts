import { useCallback, useEffect, useState } from 'react';
import type { McpServerStatus, McpServersResponse } from '@all-model-chat/shared-api';
import { getMcpServersApi } from '../../services/api/mcpApi';
import { logService } from '../../services/logService';

interface McpServersResponseWithWarnings extends McpServersResponse {
    warnings?: string[];
}

export const useMcpServers = () => {
    const [isEnabled, setIsEnabled] = useState(false);
    const [servers, setServers] = useState<McpServerStatus[]>([]);
    const [warnings, setWarnings] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const payload = await getMcpServersApi() as McpServersResponseWithWarnings;
            setIsEnabled(!!payload.enabled);
            setServers(Array.isArray(payload.servers) ? payload.servers : []);
            setWarnings(Array.isArray(payload.warnings) ? payload.warnings : []);
        } catch (fetchError) {
            const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
            setError(message);
            logService.warn('Failed to fetch MCP server statuses.', { error: message });
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    return {
        isEnabled,
        servers,
        warnings,
        isLoading,
        error,
        refresh,
    };
};
