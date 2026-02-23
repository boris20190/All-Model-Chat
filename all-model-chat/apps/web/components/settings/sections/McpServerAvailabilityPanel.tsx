import React, { useCallback, useEffect, useState } from 'react';
import type { McpServerStatus, McpServersResponse } from '@all-model-chat/shared-api';
import { RefreshCw, PlugZap, TriangleAlert, CircleCheck } from 'lucide-react';
import { getMcpServersApi } from '../../../services/api/mcpApi';

interface McpServerAvailabilityPanelProps {
  t: (key: string) => string;
}

interface McpServersPayloadWithWarnings extends McpServersResponse {
  warnings?: string[];
}

export const McpServerAvailabilityPanel: React.FC<McpServerAvailabilityPanelProps> = ({ t }) => {
  const [servers, setServers] = useState<McpServerStatus[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const payload = await getMcpServersApi() as McpServersPayloadWithWarnings;
      setServers(Array.isArray(payload.servers) ? payload.servers : []);
      setIsEnabled(!!payload.enabled);
      setWarnings(Array.isArray(payload.warnings) ? payload.warnings : []);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return (
    <div className="pt-6 border-t border-[var(--theme-border-secondary)] space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--theme-text-tertiary)] flex items-center gap-2">
          <PlugZap size={14} strokeWidth={1.5} />
          MCP Availability
        </h4>
        <button
          type="button"
          onClick={fetchStatus}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-[var(--theme-border-secondary)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-tertiary)] disabled:opacity-50 text-xs"
        >
          <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
          {t('refresh') || 'Refresh'}
        </button>
      </div>

      {!isEnabled && (
        <div className="text-xs text-[var(--theme-text-tertiary)]">
          MCP is disabled on backend (`BFF_MCP_ENABLED=false`).
        </div>
      )}

      {error && (
        <div className="text-xs text-[var(--theme-text-danger)]">{error}</div>
      )}

      {warnings.length > 0 && (
        <div className="space-y-1">
          {warnings.map((warning, index) => (
            <div key={`${warning}-${index}`} className="text-xs text-amber-600 flex items-start gap-1.5">
              <TriangleAlert size={12} className="mt-0.5" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}

      {isEnabled && servers.length === 0 && !error && (
        <div className="text-xs text-[var(--theme-text-tertiary)]">No MCP servers configured.</div>
      )}

      {servers.length > 0 && (
        <div className="space-y-2 max-h-48 overflow-auto custom-scrollbar pr-1">
          {servers.map((server) => (
            <div
              key={server.id}
              className="rounded-lg border border-[var(--theme-border-secondary)] p-2.5 bg-[var(--theme-bg-secondary)]"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-[var(--theme-text-primary)]">{server.name}</div>
                <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] ${server.available ? 'text-green-600 bg-green-500/10' : 'text-amber-600 bg-amber-500/10'}`}>
                  {server.available ? <CircleCheck size={11} /> : <TriangleAlert size={11} />}
                  {server.available ? 'available' : 'unavailable'}
                </div>
              </div>
              <div className="text-xs text-[var(--theme-text-tertiary)] mt-1">{server.statusMessage || server.id}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
