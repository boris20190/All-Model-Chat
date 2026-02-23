import { useCallback } from 'react';
import { ChatSettings as IndividualChatSettings, SavedChatSession, UploadedFile } from '../../../types';
import type { ChatToolMode, McpServerStatus } from '@all-model-chat/shared-api';
import { cleanupFilePreviewUrls } from '../../../utils/appUtils';
import {
    hasBuiltinToolsEnabled,
    hasMcpToolsSelected,
    isCustomModeActive,
    resolveToolMode,
    toggleServerSelection,
} from '../../../utils/toolMode.js';

interface UseChatSessionActionsProps {
    activeSessionId: string | null;
    isLoading: boolean;
    updateAndPersistSessions: (updater: (prev: SavedChatSession[]) => SavedChatSession[], options?: { persist?: boolean }) => void;
    setCurrentChatSettings: (updater: (prevSettings: IndividualChatSettings) => IndividualChatSettings) => void;
    setSelectedFiles: (files: UploadedFile[]) => void;
    handleStopGenerating: () => void;
    startNewChat: () => void;
    handleTogglePinSession: (sessionId: string) => void;
    mcpServerStatuses: McpServerStatus[];
}

const applyBuiltinMode = (settings: IndividualChatSettings): IndividualChatSettings => {
    const builtinEnabled = hasBuiltinToolsEnabled(settings);

    if (!builtinEnabled) {
        return {
            ...settings,
            toolMode: hasMcpToolsSelected(settings) ? 'custom' : 'none',
        };
    }

    return {
        ...settings,
        toolMode: 'builtin',
        enabledMcpServerIds: [],
    };
};

const disableBuiltinToggles = (settings: IndividualChatSettings): IndividualChatSettings => {
    return {
        ...settings,
        isGoogleSearchEnabled: false,
        isCodeExecutionEnabled: false,
        isUrlContextEnabled: false,
        isDeepSearchEnabled: false,
    };
};

export const useChatSessionActions = ({
    activeSessionId,
    isLoading,
    updateAndPersistSessions,
    setCurrentChatSettings,
    setSelectedFiles,
    handleStopGenerating,
    startNewChat,
    handleTogglePinSession,
    mcpServerStatuses,
}: UseChatSessionActionsProps) => {

    const handleClearCurrentChat = useCallback(() => {
        if (isLoading) handleStopGenerating();
        if (activeSessionId) {
            updateAndPersistSessions(prev =>
                prev.map(s => {
                    if (s.id === activeSessionId) {
                        // Cleanup files in the cleared session
                        s.messages.forEach(msg => cleanupFilePreviewUrls(msg.files));

                        return {
                            ...s,
                            messages: [],
                            title: 'New Chat',
                            // Resetting lockedApiKey is crucial to allow using new global settings
                            settings: { ...s.settings, lockedApiKey: null }
                        };
                    }
                    return s;
                })
            );
            setSelectedFiles([]);
        } else {
            startNewChat();
        }
    }, [isLoading, activeSessionId, handleStopGenerating, updateAndPersistSessions, setSelectedFiles, startNewChat]);

    const handleTogglePinCurrentSession = useCallback(() => {
        if (activeSessionId) {
            handleTogglePinSession(activeSessionId);
        }
    }, [activeSessionId, handleTogglePinSession]);

    const selectToolMode = useCallback((mode: ChatToolMode) => {
        if (!activeSessionId) return;
        if (isLoading) handleStopGenerating();

        setCurrentChatSettings((prev) => {
            const selectionLocked = !!prev.mcpSelectionLocked;
            const mcpSelected = hasMcpToolsSelected(prev);

            if (selectionLocked && mcpSelected && mode !== 'custom') {
                return prev;
            }

            if (mode === 'custom') {
                return {
                    ...disableBuiltinToggles(prev),
                    toolMode: 'custom',
                };
            }

            if (mode === 'builtin') {
                return {
                    ...prev,
                    toolMode: 'builtin',
                    enabledMcpServerIds: [],
                };
            }

            return {
                ...disableBuiltinToggles(prev),
                toolMode: 'none',
                enabledMcpServerIds: selectionLocked ? prev.enabledMcpServerIds : [],
            };
        });
    }, [activeSessionId, isLoading, setCurrentChatSettings, handleStopGenerating]);

    const toggleMcpServer = useCallback((serverId: string) => {
        if (!activeSessionId) return;
        if (isLoading) handleStopGenerating();

        const status = mcpServerStatuses.find((entry) => entry.id === serverId);
        if (!status?.available) return;

        setCurrentChatSettings((prev) => {
            if (prev.mcpSelectionLocked) return prev;
            if (resolveToolMode(prev) === 'builtin' && hasBuiltinToolsEnabled(prev)) {
                return prev;
            }

            const nextServerIds = toggleServerSelection(prev.enabledMcpServerIds, serverId);

            return {
                ...disableBuiltinToggles(prev),
                enabledMcpServerIds: nextServerIds,
                toolMode: nextServerIds.length > 0 ? 'custom' : 'none',
            };
        });
    }, [activeSessionId, isLoading, setCurrentChatSettings, handleStopGenerating, mcpServerStatuses]);

    const toggleGoogleSearch = useCallback(() => {
        if (!activeSessionId) return;
        if (isLoading) handleStopGenerating();
        setCurrentChatSettings(prev => {
            if (isCustomModeActive(prev)) return prev;
            return applyBuiltinMode({ ...prev, isGoogleSearchEnabled: !prev.isGoogleSearchEnabled });
        });
    }, [activeSessionId, isLoading, setCurrentChatSettings, handleStopGenerating]);

    const toggleCodeExecution = useCallback(() => {
        if (!activeSessionId) return;
        if (isLoading) handleStopGenerating();
        setCurrentChatSettings(prev => {
            if (isCustomModeActive(prev)) return prev;
            return applyBuiltinMode({ ...prev, isCodeExecutionEnabled: !prev.isCodeExecutionEnabled });
        });
    }, [activeSessionId, isLoading, setCurrentChatSettings, handleStopGenerating]);

    const toggleUrlContext = useCallback(() => {
        if (!activeSessionId) return;
        if (isLoading) handleStopGenerating();
        setCurrentChatSettings(prev => {
            if (isCustomModeActive(prev)) return prev;
            return applyBuiltinMode({ ...prev, isUrlContextEnabled: !prev.isUrlContextEnabled });
        });
    }, [activeSessionId, isLoading, setCurrentChatSettings, handleStopGenerating]);

    const toggleDeepSearch = useCallback(() => {
        if (!activeSessionId) return;
        if (isLoading) handleStopGenerating();
        setCurrentChatSettings(prev => {
            if (isCustomModeActive(prev)) return prev;
            return applyBuiltinMode({ ...prev, isDeepSearchEnabled: !prev.isDeepSearchEnabled });
        });
    }, [activeSessionId, isLoading, setCurrentChatSettings, handleStopGenerating]);

    return {
        handleClearCurrentChat,
        handleTogglePinCurrentSession,
        selectToolMode,
        toggleMcpServer,
        toggleGoogleSearch,
        toggleCodeExecution,
        toggleUrlContext,
        toggleDeepSearch
    };
};
