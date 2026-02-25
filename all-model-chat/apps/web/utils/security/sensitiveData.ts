import { AppSettings, ChatSettings, SavedChatSession } from '../../types';

const LEGACY_BUILTIN_TOOL_FIELDS = [
    'isGoogleSearchEnabled',
    'isCodeExecutionEnabled',
    'isUrlContextEnabled',
    'isDeepSearchEnabled',
    'toolMode',
    'mcpSelectionLocked',
] as const;

const stripLegacyBuiltinToolFields = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object') {
        return {};
    }

    const clone: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    LEGACY_BUILTIN_TOOL_FIELDS.forEach((field) => {
        delete clone[field];
    });
    return clone;
};

const normalizeEnabledMcpServerIds = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    const deduped = new Set<string>();
    value.forEach((entry) => {
        if (typeof entry !== 'string') return;
        const normalized = entry.trim();
        if (normalized.length > 0) deduped.add(normalized);
    });
    return [...deduped];
};

/**
 * Keep session-level settings free of raw provider secrets before persistence/export.
 */
export const sanitizeChatSettingsForStorage = (settings: ChatSettings): ChatSettings => {
    const normalized = stripLegacyBuiltinToolFields(settings);
    return {
        ...(normalized as ChatSettings),
        lockedApiKey: null,
        enabledMcpServerIds: normalizeEnabledMcpServerIds(normalized.enabledMcpServerIds),
    };
};

/**
 * Keep app-level settings free of raw provider secrets before persistence/export.
 */
export const sanitizeAppSettingsForStorage = (settings: AppSettings): AppSettings => {
    const normalized = stripLegacyBuiltinToolFields(settings);
    return {
        ...(normalized as AppSettings),
        apiKey: null,
        lockedApiKey: null,
        enabledMcpServerIds: normalizeEnabledMcpServerIds(normalized.enabledMcpServerIds),
    };
};

/**
 * Keep stored/exported session payloads free of raw provider secrets.
 */
export const sanitizeSessionForStorage = (session: SavedChatSession): SavedChatSession => ({
    ...session,
    settings: sanitizeChatSettingsForStorage(session.settings),
});
