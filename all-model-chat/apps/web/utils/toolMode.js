const TOOL_MODES = ['builtin', 'custom', 'none'];

export const normalizeToolMode = (value) => {
    if (TOOL_MODES.includes(value)) {
        return value;
    }
    return 'none';
};

export const hasBuiltinToolsEnabled = (settings) => {
    if (!settings) return false;

    return Boolean(
        settings.isGoogleSearchEnabled ||
        settings.isCodeExecutionEnabled ||
        settings.isUrlContextEnabled ||
        settings.isDeepSearchEnabled
    );
};

export const hasMcpToolsSelected = (settings) => {
    if (!settings || !Array.isArray(settings.enabledMcpServerIds)) return false;

    return settings.enabledMcpServerIds.some((id) => typeof id === 'string' && id.trim().length > 0);
};

export const resolveToolMode = (settings) => {
    const explicitMode = normalizeToolMode(settings?.toolMode);
    const builtinEnabled = hasBuiltinToolsEnabled(settings);
    const mcpSelected = hasMcpToolsSelected(settings);

    if (explicitMode === 'custom') return 'custom';
    if (explicitMode === 'builtin' && builtinEnabled) return 'builtin';
    if (explicitMode === 'none' && !builtinEnabled && !mcpSelected) return 'none';

    if (mcpSelected) return 'custom';
    if (builtinEnabled) return 'builtin';

    return explicitMode;
};

export const isBuiltinModeActive = (settings) => resolveToolMode(settings) === 'builtin';

export const isCustomModeActive = (settings) => resolveToolMode(settings) === 'custom';

export const shouldRequireWebGrounding = (settings) => {
    const resolvedMode = resolveToolMode(settings);
    if (resolvedMode !== 'builtin') return false;

    return Boolean(settings?.isGoogleSearchEnabled || settings?.isDeepSearchEnabled);
};

export const buildWebGroundingRequest = (settings, policy = 'warn') => {
    if (!shouldRequireWebGrounding(settings)) return undefined;

    return {
        required: true,
        policy: policy === 'off' ? 'off' : 'warn',
    };
};

export const toggleServerSelection = (currentServerIds, targetServerId) => {
    const normalizedId = typeof targetServerId === 'string' ? targetServerId.trim() : '';
    if (!normalizedId) return Array.isArray(currentServerIds) ? [...currentServerIds] : [];

    const set = new Set(
        Array.isArray(currentServerIds)
            ? currentServerIds
                .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                .filter((entry) => entry.length > 0)
            : []
    );

    if (set.has(normalizedId)) {
        set.delete(normalizedId);
    } else {
        set.add(normalizedId);
    }

    return [...set];
};
