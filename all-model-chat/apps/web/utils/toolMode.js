export const hasMcpToolsSelected = (settings) => {
    if (!settings || !Array.isArray(settings.enabledMcpServerIds)) return false;

    return settings.enabledMcpServerIds.some((id) => typeof id === 'string' && id.trim().length > 0);
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
