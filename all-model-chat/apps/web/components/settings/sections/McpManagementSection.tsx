import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
    McpConfigResponse,
    McpConfigServer,
    McpImportResponse,
    McpServerStatus,
    RuntimeDebugConfigResponse,
} from '@all-model-chat/shared-api';
import { RefreshCw, Upload, Trash2, ToggleLeft, ToggleRight, Bug, Pencil, Save, X } from 'lucide-react';
import {
    getMcpConfigApi,
    getMcpServersApi,
    getRuntimeDebugApi,
    importMcpConfigApi,
    putMcpConfigApi,
    setRuntimeDebugApi,
} from '../../../services/api/mcpApi';

interface McpManagementSectionProps {
    t: (key: string) => string;
    onChanged?: () => void;
}

const parseJson = (raw: string): unknown => {
    const trimmed = raw.trim();
    if (!trimmed) {
        throw new Error('JSON is empty.');
    }
    return JSON.parse(trimmed);
};

export const McpManagementSection: React.FC<McpManagementSectionProps> = ({ t, onChanged }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [config, setConfig] = useState<McpConfigResponse | null>(null);
    const [runtimeDebug, setRuntimeDebug] = useState<RuntimeDebugConfigResponse | null>(null);
    const [statuses, setStatuses] = useState<McpServerStatus[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [importText, setImportText] = useState('');
    const [importSummary, setImportSummary] = useState<McpImportResponse['summary'] | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [editingServerId, setEditingServerId] = useState<string | null>(null);
    const [editingJson, setEditingJson] = useState('');

    const notifyMcpUpdated = useCallback(() => {
        onChanged?.();
        window.dispatchEvent(new Event('mcp-config-updated'));
    }, [onChanged]);

    const normalizeServerDraft = useCallback((raw: unknown, fallbackId: string): McpConfigServer => {
        const source = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
        const id = typeof source.id === 'string' && source.id.trim().length > 0 ? source.id.trim() : fallbackId;
        const name =
            typeof source.name === 'string' && source.name.trim().length > 0
                ? source.name.trim()
                : id;
        const transport =
            source.transport === 'http' || source.transport === 'sse' || source.transport === 'stdio'
                ? source.transport
                : 'stdio';
        const enabled = typeof source.enabled === 'boolean' ? source.enabled : true;
        const args = Array.isArray(source.args)
            ? source.args.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
            : [];
        const env = source.env && typeof source.env === 'object'
            ? Object.fromEntries(
                Object.entries(source.env as Record<string, unknown>).filter(
                    (entry): entry is [string, string] => typeof entry[1] === 'string'
                )
            )
            : {};
        const headers = source.headers && typeof source.headers === 'object'
            ? Object.fromEntries(
                Object.entries(source.headers as Record<string, unknown>).filter(
                    (entry): entry is [string, string] => typeof entry[1] === 'string'
                )
            )
            : {};
        const sseFallback = typeof source.sseFallback === 'boolean' ? source.sseFallback : true;
        const connectTimeoutMs =
            typeof source.connectTimeoutMs === 'number' &&
            Number.isInteger(source.connectTimeoutMs) &&
            source.connectTimeoutMs > 0
                ? source.connectTimeoutMs
                : undefined;
        const timeoutMs =
            typeof source.timeoutMs === 'number' && Number.isInteger(source.timeoutMs) && source.timeoutMs > 0
                ? source.timeoutMs
                : undefined;

        return {
            id,
            name,
            transport,
            enabled,
            command: typeof source.command === 'string' && source.command.trim().length > 0 ? source.command : undefined,
            args,
            env,
            cwd: typeof source.cwd === 'string' && source.cwd.trim().length > 0 ? source.cwd : undefined,
            url: typeof source.url === 'string' && source.url.trim().length > 0 ? source.url : undefined,
            headers,
            sseFallback,
            connectTimeoutMs,
            timeoutMs,
        };
    }, []);

    const refresh = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [mcpConfig, debugConfig, statusPayload] = await Promise.all([
                getMcpConfigApi(),
                getRuntimeDebugApi(),
                getMcpServersApi(),
            ]);
            setConfig(mcpConfig);
            setRuntimeDebug(debugConfig);
            setStatuses(statusPayload.servers || []);
        } catch (fetchError) {
            setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const saveConfig = useCallback(async (nextEnabled: boolean, nextServers: McpConfigServer[]) => {
        setIsSaving(true);
        setError(null);
        try {
            const updated = await putMcpConfigApi({
                enabled: nextEnabled,
                servers: nextServers,
            });
            setConfig(updated);
            notifyMcpUpdated();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : String(saveError));
        } finally {
            setIsSaving(false);
        }
    }, [notifyMcpUpdated]);

    const toggleGlobalEnabled = useCallback(() => {
        if (!config) return;
        saveConfig(!config.enabled, config.servers);
    }, [config, saveConfig]);

    const toggleServerEnabled = useCallback((targetId: string) => {
        if (!config) return;
        const nextServers = config.servers.map((server) =>
            server.id === targetId
                ? {
                    ...server,
                    enabled: !server.enabled,
                }
                : server
        );
        saveConfig(config.enabled, nextServers);
    }, [config, saveConfig]);

    const deleteServer = useCallback((targetId: string) => {
        if (!config) return;
        const nextServers = config.servers.filter((server) => server.id !== targetId);
        saveConfig(config.enabled, nextServers);
    }, [config, saveConfig]);

    const beginEditServer = useCallback((server: McpConfigServer) => {
        setEditingServerId(server.id);
        setEditingJson(JSON.stringify(server, null, 2));
        setError(null);
    }, []);

    const cancelEditServer = useCallback(() => {
        setEditingServerId(null);
        setEditingJson('');
        setError(null);
    }, []);

    const saveEditServer = useCallback(async () => {
        if (!config || !editingServerId) return;
        setError(null);

        try {
            const parsed = parseJson(editingJson);
            const nextServer = normalizeServerDraft(parsed, editingServerId);
            const duplicate = config.servers.some(
                (server) => server.id === nextServer.id && server.id !== editingServerId
            );
            if (duplicate) {
                throw new Error(`Server id "${nextServer.id}" already exists.`);
            }

            const nextServers = config.servers.map((server) =>
                server.id === editingServerId ? nextServer : server
            );
            await saveConfig(config.enabled, nextServers);
            setEditingServerId(null);
            setEditingJson('');
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : String(saveError));
        }
    }, [config, editingJson, editingServerId, normalizeServerDraft, saveConfig]);

    const importFromText = useCallback(async () => {
        setError(null);
        setImportSummary(null);
        setIsSaving(true);
        try {
            const payload = parseJson(importText);
            const imported = await importMcpConfigApi({ payload });
            setConfig(imported);
            setImportSummary(imported.summary);
            notifyMcpUpdated();
        } catch (importError) {
            setError(importError instanceof Error ? importError.message : String(importError));
        } finally {
            setIsSaving(false);
        }
    }, [importText, notifyMcpUpdated]);

    const importFromFile = useCallback(async (file: File) => {
        try {
            const text = await file.text();
            setImportText(text);
            const payload = parseJson(text);
            const imported = await importMcpConfigApi({ payload });
            setConfig(imported);
            setImportSummary(imported.summary);
            notifyMcpUpdated();
            setError(null);
        } catch (importError) {
            setError(importError instanceof Error ? importError.message : String(importError));
        }
    }, [notifyMcpUpdated]);

    const toggleRuntimeDebug = useCallback(async () => {
        if (!runtimeDebug) return;
        setIsSaving(true);
        setError(null);
        try {
            const updated = await setRuntimeDebugApi({ enabled: !runtimeDebug.enabled });
            setRuntimeDebug(updated);
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : String(saveError));
        } finally {
            setIsSaving(false);
        }
    }, [runtimeDebug]);

    const sortedServers = useMemo(() => {
        if (!config?.servers) return [];
        return [...config.servers].sort((a, b) => a.name.localeCompare(b.name));
    }, [config?.servers]);

    const statusById = useMemo(() => {
        return new Map(statuses.map((entry) => [entry.id, entry]));
    }, [statuses]);

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[var(--theme-text-primary)]">
                    {t('settingsMcpTitle') || 'MCP Servers'}
                </h3>
                <button
                    type="button"
                    onClick={refresh}
                    disabled={isLoading || isSaving}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-[var(--theme-border-secondary)] text-sm text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-tertiary)] disabled:opacity-60"
                >
                    <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                    {t('refresh') || 'Refresh'}
                </button>
            </div>

            {error && (
                <div className="text-sm text-[var(--theme-text-danger)] border border-red-500/20 rounded-md px-3 py-2 bg-red-500/5">
                    {error}
                </div>
            )}

            <div className="rounded-xl border border-[var(--theme-border-secondary)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-sm font-medium text-[var(--theme-text-primary)]">
                            {t('settingsMcpGlobalToggle') || 'Enable MCP globally'}
                        </div>
                        <div className="text-xs text-[var(--theme-text-tertiary)] mt-1">
                            {config?.configPath || ''}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={toggleGlobalEnabled}
                        disabled={!config || isSaving}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-[var(--theme-border-secondary)] text-sm text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-tertiary)] disabled:opacity-60"
                    >
                        {config?.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                        {config?.enabled ? (t('enabled') || 'Enabled') : (t('disabled') || 'Disabled')}
                    </button>
                </div>

                {Array.isArray(config?.warnings) && config!.warnings!.length > 0 && (
                    <div className="text-xs text-amber-600 space-y-1">
                        {config!.warnings!.map((warning, index) => (
                            <div key={`${warning}-${index}`}>{warning}</div>
                        ))}
                    </div>
                )}
            </div>

            <div className="rounded-xl border border-[var(--theme-border-secondary)] p-4 space-y-3">
                <div className="text-sm font-medium text-[var(--theme-text-primary)]">
                    {t('settingsMcpImportJson') || 'Import MCP JSON'}
                </div>
                <textarea
                    value={importText}
                    onChange={(event) => setImportText(event.target.value)}
                    rows={8}
                    className="w-full rounded-md border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-input)] px-3 py-2 text-sm font-mono text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-tertiary)]"
                    placeholder='{"mcpServers": {"my-server": {"command": "...", "args": ["..."]}}}'
                />
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={importFromText}
                        disabled={isSaving}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-[var(--theme-border-secondary)] text-sm text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-tertiary)] disabled:opacity-60"
                    >
                        <Upload size={14} />
                        {t('import') || 'Import'}
                    </button>
                    <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-[var(--theme-border-secondary)] text-sm text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-tertiary)] cursor-pointer">
                        <Upload size={14} />
                        {t('settingsMcpImportFile') || 'Import File'}
                        <input
                            type="file"
                            accept=".json,application/json"
                            className="hidden"
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) {
                                    importFromFile(file);
                                }
                                event.currentTarget.value = '';
                            }}
                        />
                    </label>
                </div>
                {importSummary && (
                    <div className="text-xs text-[var(--theme-text-secondary)]">
                        {`created=${importSummary.created.length}, updated=${importSummary.updated.length}, skipped=${importSummary.skipped.length}`}
                    </div>
                )}
            </div>

            <div className="rounded-xl border border-[var(--theme-border-secondary)] p-4 space-y-3">
                <div className="text-sm font-medium text-[var(--theme-text-primary)]">
                    {t('settingsMcpServers') || 'Configured Servers'}
                </div>
                {sortedServers.length === 0 && (
                    <div className="text-xs text-[var(--theme-text-tertiary)]">
                        {t('settingsMcpNoServers') || 'No MCP servers configured.'}
                    </div>
                )}
                {sortedServers.length > 0 && (
                    <div className="space-y-2">
                        {sortedServers.map((server) => (
                            (() => {
                                const runtimeStatus = statusById.get(server.id);
                                return (
                            <div
                                key={server.id}
                                className="rounded-md border border-[var(--theme-border-secondary)] px-3 py-2 bg-[var(--theme-bg-secondary)]"
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium text-[var(--theme-text-primary)] truncate">
                                            {server.name}
                                        </div>
                                        <div className="text-xs text-[var(--theme-text-tertiary)] truncate">
                                            {`${server.id} • ${server.transport} • attachable=${String(runtimeStatus?.attachable ?? false)} • tools=${String(runtimeStatus?.toolCount ?? 0)}${runtimeStatus?.protocolVersion ? ` • protocol=${runtimeStatus.protocolVersion}` : ''}${typeof runtimeStatus?.latencyMs === 'number' ? ` • ${runtimeStatus.latencyMs}ms` : ''}`}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => toggleServerEnabled(server.id)}
                                            disabled={isSaving}
                                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--theme-border-secondary)] text-xs text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-tertiary)] disabled:opacity-60"
                                        >
                                            {server.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                                            {server.enabled ? (t('enabled') || 'Enabled') : (t('disabled') || 'Disabled')}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => beginEditServer(server)}
                                            disabled={isSaving}
                                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--theme-border-secondary)] text-xs text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-tertiary)] disabled:opacity-60"
                                        >
                                            <Pencil size={14} />
                                            {t('edit') || 'Edit'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => deleteServer(server.id)}
                                            disabled={isSaving}
                                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-red-500/30 text-xs text-red-600 hover:bg-red-500/10 disabled:opacity-60"
                                        >
                                            <Trash2 size={14} />
                                            {t('delete') || 'Delete'}
                                        </button>
                                    </div>
                                </div>
                                {editingServerId === server.id && (
                                    <div className="mt-3 space-y-2">
                                        <textarea
                                            value={editingJson}
                                            onChange={(event) => setEditingJson(event.target.value)}
                                            rows={10}
                                            className="w-full rounded-md border border-[var(--theme-border-secondary)] bg-[var(--theme-bg-input)] px-3 py-2 text-xs font-mono text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-tertiary)]"
                                        />
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={saveEditServer}
                                                disabled={isSaving}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--theme-border-secondary)] text-xs text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-tertiary)] disabled:opacity-60"
                                            >
                                                <Save size={13} />
                                                {t('save') || 'Save'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={cancelEditServer}
                                                disabled={isSaving}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--theme-border-secondary)] text-xs text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-tertiary)] disabled:opacity-60"
                                            >
                                                <X size={13} />
                                                {t('cancel') || 'Cancel'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                                );
                            })()
                        ))}
                    </div>
                )}
            </div>

            <div className="rounded-xl border border-[var(--theme-border-secondary)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium text-[var(--theme-text-primary)]">
                        <Bug size={15} />
                        {t('settingsDebugMode') || 'Runtime Debug Mode'}
                    </div>
                    <button
                        type="button"
                        onClick={toggleRuntimeDebug}
                        disabled={!runtimeDebug || isSaving}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-[var(--theme-border-secondary)] text-sm text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-tertiary)] disabled:opacity-60"
                    >
                        {runtimeDebug?.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                        {runtimeDebug?.enabled ? (t('enabled') || 'Enabled') : (t('disabled') || 'Disabled')}
                    </button>
                </div>
                {runtimeDebug && (
                    <div className="text-xs text-[var(--theme-text-tertiary)]">
                        {`${runtimeDebug.logPath} • ${runtimeDebug.maxBytes} bytes • ${runtimeDebug.maxFiles} files`}
                    </div>
                )}
            </div>
        </div>
    );
};
