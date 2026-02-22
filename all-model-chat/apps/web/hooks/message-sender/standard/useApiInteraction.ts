
import React, { useCallback } from 'react';
import { AppSettings, ChatMessage, ChatSettings as IndividualChatSettings, UploadedFile, ProjectContext } from '../../../types';
import {
    createChatHistoryForApi,
    getFastThinkingLevelForModel,
    isGemini3Model,
    logService
} from '../../../utils/appUtils';
import { buildGenerationConfig } from '../../../services/api/baseApi';
import { geminiServiceInstance } from '../../../services/geminiService';
import { isLikelyHtml } from '../../../utils/codeUtils';
import { GetStreamHandlers } from '../types';
import { ContentPart } from '../../../types/chat';
import { generateProjectContextSystemPrompt } from '../../useFolderToolExecutor';
import { readProjectFile } from '../../../utils/folderImportUtils';
import type { ChatStreamCompleteDiagnostics } from '@all-model-chat/shared-api';
import {
    appendToolRoundToHistory,
    createRollingHistory,
    extractThoughtSignature,
    MAX_TOOL_ROUNDS
} from './toolCallHistory.js';

interface UseApiInteractionProps {
    appSettings: AppSettings;
    messages: ChatMessage[];
    getStreamHandlers: GetStreamHandlers;
    handleGenerateCanvas: (sourceMessageId: string, content: string) => Promise<void>;
    setSessionLoading: (sessionId: string, isLoading: boolean) => void;
    activeJobs: React.MutableRefObject<Map<string, AbortController>>;
    /** Active project context for agentic folder access */
    projectContext?: ProjectContext | null;
    onAutoContinue?: (params: { generationId: string; activeModelId: string; effectiveEditingId: string | null }) => void;
}

export const useApiInteraction = ({
    appSettings,
    messages,
    getStreamHandlers,
    handleGenerateCanvas,
    setSessionLoading,
    activeJobs,
    projectContext,
    onAutoContinue,
}: UseApiInteractionProps) => {

    const performApiCall = useCallback(async (params: {
        finalSessionId: string;
        generationId: string;
        generationStartTime: Date;
        keyToUse: string;
        activeModelId: string;
        promptParts: ContentPart[];
        effectiveEditingId: string | null;
        isContinueMode: boolean;
        isRawMode: boolean;
        sessionToUpdate: IndividualChatSettings;
        aspectRatio: string;
        imageSize: string | undefined;
        newAbortController: AbortController;
        textToUse: string;
        enrichedFiles: UploadedFile[];
    }) => {
        const {
            finalSessionId, generationId, generationStartTime, keyToUse, activeModelId,
            promptParts, effectiveEditingId, isContinueMode, isRawMode,
            sessionToUpdate, aspectRatio, imageSize, newAbortController,
            textToUse, enrichedFiles
        } = params;

        let baseMessagesForApi: ChatMessage[] = messages;

        if (effectiveEditingId) {
            const index = messages.findIndex(m => m.id === effectiveEditingId);
            if (index !== -1) {
                baseMessagesForApi = messages.slice(0, index);
            }
        }

        let finalRole: 'user' | 'model' = 'user';
        let finalParts = promptParts;

        if (isContinueMode) {
            finalRole = 'model';
            const targetMsg = messages.find(m => m.id === effectiveEditingId);
            const currentContent = targetMsg?.content || '';
            const isG3 = isGemini3Model(activeModelId);

            let prefillContent = currentContent;
            if (!prefillContent.trim()) {
                prefillContent = isG3 ? "<thinking>I have finished reasoning</thinking>" : " ";
            }
            finalParts = [{ text: prefillContent }];

        } else if (isRawMode) {
            const tempUserMsg: ChatMessage = {
                id: 'temp-raw-user',
                role: 'user',
                content: textToUse.trim(),
                files: enrichedFiles,
                timestamp: new Date()
            };
            baseMessagesForApi = [...baseMessagesForApi, tempUserMsg];

            finalRole = 'model';
            finalParts = [{ text: '<thinking>' }];

        } else if (promptParts.length === 0) {
            setSessionLoading(finalSessionId, false);
            activeJobs.current.delete(generationId);
            return;
        }

        const shouldStripThinking = sessionToUpdate.hideThinkingInContext ?? appSettings.hideThinkingInContext;
        const historyForChat = await createChatHistoryForApi(baseMessagesForApi, shouldStripThinking);
        const rollingHistory = createRollingHistory(historyForChat as any[], finalRole, finalParts as any[]);
        let toolRoundCount = 0;

        // Prepare system instruction - inject project context if available
        let effectiveSystemInstruction = sessionToUpdate.systemInstruction;
        if (projectContext) {
            const projectPromptPrefix = generateProjectContextSystemPrompt(projectContext);
            effectiveSystemInstruction = projectPromptPrefix + (effectiveSystemInstruction ? `\n\n${effectiveSystemInstruction}` : '');
        }

        const config = buildGenerationConfig(
            activeModelId,
            effectiveSystemInstruction,
            { temperature: sessionToUpdate.temperature, topP: sessionToUpdate.topP },
            sessionToUpdate.showThoughts,
            sessionToUpdate.thinkingBudget,
            !!sessionToUpdate.isGoogleSearchEnabled,
            !!sessionToUpdate.isCodeExecutionEnabled,
            !!sessionToUpdate.isUrlContextEnabled,
            sessionToUpdate.thinkingLevel,
            aspectRatio,
            sessionToUpdate.isDeepSearchEnabled,
            imageSize,
            sessionToUpdate.safetySettings,
            sessionToUpdate.mediaResolution,
            projectContext?.fileTree, // Pass file tree to enable read_file tool
        );

        const shouldAutoContinueOnEmpty =
            !isContinueMode && getFastThinkingLevelForModel(activeModelId) === 'MINIMAL';

        const { streamOnError, streamOnComplete, streamOnPart, onThoughtChunk } = getStreamHandlers(
            finalSessionId,
            generationId,
            newAbortController,
            generationStartTime,
            sessionToUpdate,
            {
                onSuccess: (msgId, content) => {
                if (!isContinueMode && appSettings.autoCanvasVisualization && content && content.length > 50 && !isLikelyHtml(content)) {
                    const trimmed = content.trim();
                    if (trimmed.startsWith('```') && trimmed.endsWith('```')) return;
                    logService.info("Auto-triggering Canvas visualization for message", { msgId });
                    handleGenerateCanvas(msgId, content);
                }
                },
                onEmptyResponse: shouldAutoContinueOnEmpty
                    ? (msgId) => onAutoContinue?.({ generationId: msgId, activeModelId, effectiveEditingId })
                    : undefined,
                suppressEmptyResponseError: shouldAutoContinueOnEmpty,
            }
        );

        setSessionLoading(finalSessionId, true);
        activeJobs.current.set(generationId, newAbortController);

        // Wrapper to handle function calls (ReAct-style loop)
        // IMPORTANT: We now receive the complete Part object which includes thoughtSignature
        const handleFunctionCallResponse = async (
            usageMetadata: any,
            groundingMetadata: any,
            urlContextMetadata: any,
            functionCallPart?: any, // Part object containing functionCall and thoughtSignature
            diagnostics?: ChatStreamCompleteDiagnostics
        ) => {
            const normalizedFunctionCallPart = (() => {
                if (!functionCallPart) return functionCallPart;
                const thoughtSignature = extractThoughtSignature(functionCallPart);

                if (!thoughtSignature) return functionCallPart;

                return {
                    ...functionCallPart,
                    thoughtSignature,
                    thought_signature: thoughtSignature,
                } as any;
            })();

            const functionCall = normalizedFunctionCallPart?.functionCall;
            if (functionCall && functionCall.name === 'read_file' && projectContext) {
                toolRoundCount += 1;
                if (toolRoundCount > MAX_TOOL_ROUNDS) {
                    logService.warn('Tool loop guard triggered; stopping recursive function-call chain.', {
                        modelId: activeModelId,
                        maxRounds: MAX_TOOL_ROUNDS,
                        functionName: functionCall.name,
                    });
                    streamOnPart({
                        text: `\n\n[Tool loop stopped after ${MAX_TOOL_ROUNDS} rounds to prevent infinite recursion.]`,
                    });
                    streamOnComplete(usageMetadata, groundingMetadata, urlContextMetadata, diagnostics);
                    return;
                }

                const hasThoughtSignature = !!extractThoughtSignature(normalizedFunctionCallPart);
                if (!hasThoughtSignature) {
                    logService.warn('Function call part is missing thought signature; continuing with best effort.', {
                        modelId: activeModelId,
                        round: toolRoundCount,
                        functionName: functionCall.name,
                    });
                }

                logService.info(`Executing function call: ${functionCall.name}`, {
                    args: functionCall.args,
                    hasThoughtSignature
                });

                try {
                    const filepath = functionCall.args?.filepath;
                    if (!filepath) {
                        throw new Error('Missing filepath argument');
                    }

                    // Read the file content
                    const fileContent = await readProjectFile(projectContext, filepath);
                    logService.info(`File read successfully: ${filepath}`, { length: fileContent.length });

                    // Preserve complete multi-round chain: append model function call + user function response.
                    appendToolRoundToHistory(
                        rollingHistory as any[],
                        normalizedFunctionCallPart,
                        functionCall.name,
                        fileContent
                    );

                    // Continue the conversation with function result
                    await geminiServiceInstance.sendMessageStream(
                        keyToUse,
                        activeModelId,
                        rollingHistory as any,
                        [], // Empty parts since context is in history
                        config, // Keep original config (thinking enabled)
                        newAbortController.signal,
                        streamOnPart,
                        onThoughtChunk,
                        streamOnError,
                        handleFunctionCallResponse, // Recursive for multi-turn
                        'model' // Continue from model
                    );
                } catch (error) {
                    logService.error('Function call execution failed:', error);
                    // Continue with error message in response
                    const errorPart = { text: `\n\n[Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}]` };
                    streamOnPart(errorPart);
                    streamOnComplete(usageMetadata, groundingMetadata, urlContextMetadata, diagnostics);
                }
            } else {
                // No function call, complete normally
                streamOnComplete(usageMetadata, groundingMetadata, urlContextMetadata, diagnostics);
            }
        };

        if (appSettings.isStreamingEnabled) {
            await geminiServiceInstance.sendMessageStream(
                keyToUse,
                activeModelId,
                historyForChat,
                finalParts,
                config,
                newAbortController.signal,
                streamOnPart,
                onThoughtChunk,
                streamOnError,
                handleFunctionCallResponse,
                finalRole
            );
        } else {
            await geminiServiceInstance.sendMessageNonStream(
                keyToUse,
                activeModelId,
                historyForChat,
                finalParts,
                config,
                newAbortController.signal,
                streamOnError,
                (parts, thoughts, usage, grounding, urlContextMetadata, diagnostics) => {
                    for (const part of parts) streamOnPart(part);
                    if (thoughts) onThoughtChunk(thoughts);
                    streamOnComplete(usage, grounding, urlContextMetadata, diagnostics);
                }
            );
        }
    }, [appSettings, messages, getStreamHandlers, handleGenerateCanvas, setSessionLoading, activeJobs, projectContext, onAutoContinue]);

    return { performApiCall };
};
