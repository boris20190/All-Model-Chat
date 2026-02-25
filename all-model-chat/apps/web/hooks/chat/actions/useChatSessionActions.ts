import { useCallback } from 'react';
import { ChatSettings as IndividualChatSettings, SavedChatSession, UploadedFile } from '../../../types';
import type { McpServerStatus } from '@all-model-chat/shared-api';
import { cleanupFilePreviewUrls } from '../../../utils/appUtils';
import { toggleServerSelection } from '../../../utils/toolMode.js';

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

    const toggleMcpServer = useCallback((serverId: string) => {
        if (!activeSessionId) return;
        if (isLoading) handleStopGenerating();

        const status = mcpServerStatuses.find((entry) => entry.id === serverId);
        if (!(status?.attachable ?? status?.available)) return;

        setCurrentChatSettings((prev) => {
            const nextServerIds = toggleServerSelection(prev.enabledMcpServerIds, serverId);

            return {
                ...prev,
                enabledMcpServerIds: nextServerIds,
            };
        });
    }, [activeSessionId, isLoading, setCurrentChatSettings, handleStopGenerating, mcpServerStatuses]);

    return {
        handleClearCurrentChat,
        handleTogglePinCurrentSession,
        toggleMcpServer
    };
};
