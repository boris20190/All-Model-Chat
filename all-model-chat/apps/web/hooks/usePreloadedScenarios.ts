
import { useState, useEffect, useMemo, Dispatch, SetStateAction, MutableRefObject } from 'react';
import { ChatMessage, SavedScenario, SavedChatSession, AppSettings, UploadedFile } from '../types';
import { generateUniqueId, generateSessionTitle, logService, createNewSession } from '../utils/appUtils';
import { DEFAULT_CHAT_SETTINGS, DEFAULT_SYSTEM_INSTRUCTION } from '../constants/appConstants';
import { dbService } from '../utils/db';
import { 
    fopScenario, 
    unrestrictedScenario, 
    pyriteScenario, 
    annaScenario, 
    voxelScenario, 
    cyberpunkAdventureScenario,
    reasonerScenario, 
    succinctScenario, 
    socraticScenario, 
    formalScenario,
    SYSTEM_SCENARIO_IDS 
} from '../constants/defaultScenarios';

type SessionsUpdater = (updater: (prev: SavedChatSession[]) => SavedChatSession[], options?: { persist?: boolean }) => Promise<void>;

interface PreloadedScenariosProps {
    appSettings: AppSettings;
    updateAndPersistSessions: SessionsUpdater;
    setActiveMessages: Dispatch<SetStateAction<ChatMessage[]>>;
    setActiveSessionId: Dispatch<SetStateAction<string | null>>;
    activeChat: SavedChatSession | undefined;
    activeSessionId: string | null;
    selectedFiles: UploadedFile[];
    setSelectedFiles: Dispatch<SetStateAction<UploadedFile[]>>;
    setEditingMessageId: Dispatch<SetStateAction<string | null>>;
    fileDraftsRef: MutableRefObject<Record<string, UploadedFile[]>>;
    userScrolledUp: MutableRefObject<boolean>;
}

export const usePreloadedScenarios = ({
    appSettings,
    updateAndPersistSessions,
    setActiveMessages,
    setActiveSessionId,
    activeChat,
    activeSessionId,
    selectedFiles,
    setSelectedFiles,
    setEditingMessageId,
    fileDraftsRef,
    userScrolledUp
}: PreloadedScenariosProps) => {
    const [userSavedScenarios, setUserSavedScenarios] = useState<SavedScenario[]>([]);

    useEffect(() => {
        const loadScenarios = async () => {
            try {
                const storedScenarios = await dbService.getAllScenarios();
                let scenariosToSet = storedScenarios;

                // Keep seeded user scenarios resilient: if any required seed is missing, re-add it.
                const seedUserScenarios = [fopScenario, unrestrictedScenario, pyriteScenario, annaScenario];
                const missingSeedScenarios = seedUserScenarios.filter(seed => !scenariosToSet.some(s => s.id === seed.id));
                if (missingSeedScenarios.length > 0) {
                    scenariosToSet = [...scenariosToSet, ...missingSeedScenarios];
                }

                // Save if any changes were made
                if (missingSeedScenarios.length > 0) {
                    await dbService.setAllScenarios(scenariosToSet);
                }
                // Preserve legacy seed markers for backward compatibility.
                localStorage.setItem('hasSeededJailbreaks_v1', 'true');
                localStorage.setItem('hasSeededAnna_v1', 'true');

                setUserSavedScenarios(scenariosToSet);
            } catch (error) {
                logService.error("Error loading preloaded scenarios:", { error });
            }
        };
        loadScenarios();
    }, []);
    
    const savedScenarios = useMemo(() => {
        // Ensure user-saved scenarios don't conflict with the default IDs
        const filteredUserScenarios = userSavedScenarios.filter(s => !SYSTEM_SCENARIO_IDS.includes(s.id));
        return [
            // FOP, Unrestricted, Pyrite, Anna are now in filteredUserScenarios
            voxelScenario,
            cyberpunkAdventureScenario,
            reasonerScenario,
            succinctScenario, 
            socraticScenario, 
            formalScenario, 
            ...filteredUserScenarios
        ];
    }, [userSavedScenarios]);

    const handleSaveAllScenarios = (updatedScenarios: SavedScenario[]) => { 
        // Filter out the default scenarios so they are not saved to the user's database
        const scenariosToSave = updatedScenarios.filter(s => !SYSTEM_SCENARIO_IDS.includes(s.id));
        setUserSavedScenarios(scenariosToSave); 
        dbService.setAllScenarios(scenariosToSave).catch(error => {
            logService.error("Failed to save scenarios to DB", { error });
        });
    };
    
    const handleLoadPreloadedScenario = (scenarioToLoad: SavedScenario) => {
        const messages: ChatMessage[] = scenarioToLoad.messages.map(pm => ({
            ...pm,
            id: generateUniqueId(),
            timestamp: new Date()
        }));

        // Save current files to draft before switching.
        if (activeSessionId) {
            fileDraftsRef.current[activeSessionId] = selectedFiles;
        }
        userScrolledUp.current = false;

        const systemInstruction = scenarioToLoad.systemInstruction ?? DEFAULT_SYSTEM_INSTRUCTION;

        // Create a new session from scratch with the scenario's data
        const sessionSettings = {
            ...DEFAULT_CHAT_SETTINGS, // Start with defaults
            ...appSettings,          // Layer on current app settings
            systemInstruction,       // Override with scenario's system instruction
        };
        if (activeChat) {
            sessionSettings.modelId = activeChat.settings.modelId;
            sessionSettings.thinkingBudget = activeChat.settings.thinkingBudget;
            sessionSettings.thinkingLevel = activeChat.settings.thinkingLevel;
            sessionSettings.isGoogleSearchEnabled = activeChat.settings.isGoogleSearchEnabled;
            sessionSettings.isCodeExecutionEnabled = activeChat.settings.isCodeExecutionEnabled;
            sessionSettings.isUrlContextEnabled = activeChat.settings.isUrlContextEnabled;
            sessionSettings.isDeepSearchEnabled = activeChat.settings.isDeepSearchEnabled;
        }

        const title = scenarioToLoad.title || generateSessionTitle(messages) || 'New Chat';
        
        const isBlankChat = activeChat
            && activeChat.messages.length === 0
            && activeChat.settings.systemInstruction === appSettings.systemInstruction;

        if (isBlankChat) {
            // Reuse the current empty session instead of creating a new one
            setActiveMessages(messages);
            updateAndPersistSessions(prev => prev.map(s =>
                s.id === activeSessionId
                    ? { ...s, messages, title, settings: sessionSettings, timestamp: Date.now() }
                    : s
            ));
        } else {
            const newSession = createNewSession(sessionSettings, messages, title);
            setActiveMessages(messages);
            setActiveSessionId(newSession.id);
            updateAndPersistSessions(prev => [newSession, ...prev]);
        }

        setSelectedFiles([]);
        setEditingMessageId(null);
        setTimeout(() => {
            document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Chat message input"]')?.focus();
        }, 0);
    };

    return {
        savedScenarios,
        handleSaveAllScenarios,
        handleLoadPreloadedScenario,
    };
};
