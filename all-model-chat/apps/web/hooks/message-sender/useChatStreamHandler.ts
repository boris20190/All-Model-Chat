
import React, { useCallback } from 'react';
import { AppSettings, SavedChatSession, ChatMessage, ChatSettings as IndividualChatSettings } from '../../types';
import { Part, UsageMetadata } from '@google/genai';
import type { ChatStreamCompleteDiagnostics } from '@all-model-chat/shared-api';
import { useApiErrorHandler } from './useApiErrorHandler';
import { logService, showNotification, calculateTokenStats, playCompletionSound, createMessage } from '../../utils/appUtils';
import { APP_LOGO_SVG_DATA_URI } from '../../constants/appConstants';
import { finalizeMessages, updateMessagesWithBatch } from '../chat-stream/processors';
import { streamingStore } from '../../services/streamingStore';

type SessionsUpdater = (updater: (prev: SavedChatSession[]) => SavedChatSession[], options?: { persist?: boolean }) => void;

interface ChatStreamHandlerProps {
    appSettings: AppSettings;
    updateAndPersistSessions: SessionsUpdater;
    setSessionLoading: (sessionId: string, isLoading: boolean) => void;
    activeJobs: React.MutableRefObject<Map<string, AbortController>>;
}

const extractBlockedSafetyCategories = (ratings: unknown[] | undefined): string[] => {
    if (!Array.isArray(ratings)) return [];
    const categories: string[] = [];

    for (const rating of ratings) {
        if (typeof rating !== 'object' || rating === null) continue;
        const data = rating as Record<string, unknown>;
        if (data.blocked !== true) continue;

        const category = typeof data.category === 'string' ? data.category : 'UNKNOWN_CATEGORY';
        const probability = typeof data.probability === 'string' ? data.probability : null;
        categories.push(probability ? `${category} (${probability})` : category);
    }

    return categories;
};

const buildDetailedEmptyResponseMessage = (
    language: 'en' | 'zh',
    diagnostics?: ChatStreamCompleteDiagnostics
): string | undefined => {
    if (!diagnostics) {
        return language === 'zh'
            ? '模型未返回可显示内容。未收到上游诊断字段（complete.diagnostics）。请检查浏览器 Network 中 /api/chat/stream 的 complete 事件。'
            : 'Model returned no displayable content. No upstream diagnostics were received (complete.diagnostics). Check /api/chat/stream complete event in browser Network.';
    }

    const lines: string[] = [];
    const promptFeedback = diagnostics.promptFeedback;

    if (promptFeedback?.blockReason) {
        lines.push(language === 'zh'
            ? `Prompt 被拦截，原因: ${promptFeedback.blockReason}`
            : `Prompt was blocked: ${promptFeedback.blockReason}`);
    }

    if (promptFeedback?.blockReasonMessage) {
        lines.push(language === 'zh'
            ? `拦截说明: ${promptFeedback.blockReasonMessage}`
            : `Block message: ${promptFeedback.blockReasonMessage}`);
    }

    if (diagnostics.finishReason) {
        lines.push(language === 'zh'
            ? `模型结束原因: ${diagnostics.finishReason}`
            : `Model finish reason: ${diagnostics.finishReason}`);
    }

    if (diagnostics.finishMessage) {
        lines.push(language === 'zh'
            ? `结束说明: ${diagnostics.finishMessage}`
            : `Finish message: ${diagnostics.finishMessage}`);
    }

    if (diagnostics.streamError?.code) {
        lines.push(language === 'zh'
            ? `上游错误码: ${diagnostics.streamError.code}`
            : `Upstream error code: ${diagnostics.streamError.code}`);
    }

    if (typeof diagnostics.streamError?.status === 'number') {
        lines.push(language === 'zh'
            ? `上游 HTTP 状态: ${diagnostics.streamError.status}`
            : `Upstream HTTP status: ${diagnostics.streamError.status}`);
    }

    if (diagnostics.streamError?.providerStatus) {
        lines.push(language === 'zh'
            ? `上游状态标识: ${diagnostics.streamError.providerStatus}`
            : `Upstream status flag: ${diagnostics.streamError.providerStatus}`);
    }

    if (diagnostics.streamError?.providerReason) {
        lines.push(language === 'zh'
            ? `上游错误原因: ${diagnostics.streamError.providerReason}`
            : `Upstream error reason: ${diagnostics.streamError.providerReason}`);
    }

    if (diagnostics.streamError?.providerMessage) {
        lines.push(language === 'zh'
            ? `上游错误消息: ${diagnostics.streamError.providerMessage}`
            : `Upstream error message: ${diagnostics.streamError.providerMessage}`);
    }

    if (
        diagnostics.streamError?.message &&
        diagnostics.streamError.message !== diagnostics.streamError.providerMessage
    ) {
        lines.push(language === 'zh'
            ? `代理错误消息: ${diagnostics.streamError.message}`
            : `Proxy error message: ${diagnostics.streamError.message}`);
    }

    if (diagnostics.streamMeta?.provider) {
        lines.push(language === 'zh'
            ? `流式来源: ${diagnostics.streamMeta.provider}`
            : `Stream provider: ${diagnostics.streamMeta.provider}`);
    }

    if (diagnostics.streamMeta?.keyId) {
        lines.push(language === 'zh'
            ? `流式 keyId: ${diagnostics.streamMeta.keyId}`
            : `Stream keyId: ${diagnostics.streamMeta.keyId}`);
    }

    if (diagnostics.mcp?.requestedServerIds?.length) {
        lines.push(language === 'zh'
            ? `MCP 请求服务器: ${diagnostics.mcp.requestedServerIds.join(', ')}`
            : `MCP requested servers: ${diagnostics.mcp.requestedServerIds.join(', ')}`);
    }

    if (diagnostics.mcp?.attachedServerIds?.length) {
        lines.push(language === 'zh'
            ? `MCP 已附加服务器: ${diagnostics.mcp.attachedServerIds.join(', ')}`
            : `MCP attached servers: ${diagnostics.mcp.attachedServerIds.join(', ')}`);
    }

    if (diagnostics.mcp?.attachMeta?.length) {
        const attachSummary = diagnostics.mcp.attachMeta
            .slice(0, 5)
            .map((entry) =>
                `${entry.serverId}[${entry.transport}${entry.protocolVersion ? `/${entry.protocolVersion}` : ''}${typeof entry.toolCount === 'number' ? `,tools=${entry.toolCount}` : ''}${typeof entry.latencyMs === 'number' ? `,${entry.latencyMs}ms` : ''}]`
            )
            .join(' | ');
        lines.push(language === 'zh'
            ? `MCP 附加元数据: ${attachSummary}`
            : `MCP attach metadata: ${attachSummary}`);
    }

    if (diagnostics.mcp?.degraded) {
        lines.push(language === 'zh'
            ? 'MCP 已降级：请求了 MCP 但未附加任何服务器。'
            : 'MCP degraded: MCP was requested but no server was attached.');
    }

    if (diagnostics.mcp?.skipped?.length) {
        const skippedSummary = diagnostics.mcp.skipped
            .slice(0, 5)
            .map((entry) => `${entry.id}${entry.code ? `(${entry.code})` : ''}: ${entry.reason}`)
            .join(' | ');
        lines.push(language === 'zh'
            ? `MCP 跳过详情: ${skippedSummary}`
            : `MCP skipped details: ${skippedSummary}`);
    }

    if (diagnostics.mcp?.invokedTools?.length) {
        const invokedSummary = diagnostics.mcp.invokedTools
            .slice(0, 8)
            .map((entry) => `${entry.serverId}.${entry.toolName}`)
            .join(', ');
        lines.push(language === 'zh'
            ? `MCP 实际调用: ${invokedSummary}`
            : `MCP invoked tools: ${invokedSummary}`);
    }

    const promptBlockedCategories = extractBlockedSafetyCategories(promptFeedback?.safetyRatings);
    if (promptBlockedCategories.length > 0) {
        lines.push(language === 'zh'
            ? `Prompt 安全拦截类别: ${promptBlockedCategories.join(', ')}`
            : `Prompt safety-blocked categories: ${promptBlockedCategories.join(', ')}`);
    }

    const candidateBlockedCategories = extractBlockedSafetyCategories(diagnostics.candidateSafetyRatings);
    if (candidateBlockedCategories.length > 0) {
        lines.push(language === 'zh'
            ? `响应安全拦截类别: ${candidateBlockedCategories.join(', ')}`
            : `Response safety-blocked categories: ${candidateBlockedCategories.join(', ')}`);
    }

    if (diagnostics.hadCandidate === false) {
        lines.push(language === 'zh'
            ? '服务端未返回 candidate。'
            : 'No candidate was returned by upstream.');
    }

    if (diagnostics.hadCandidate === true && diagnostics.hadCandidateParts === false) {
        lines.push(language === 'zh'
            ? 'candidate 存在，但没有可渲染 parts。'
            : 'Candidate exists, but contains no renderable parts.');
    }

    if (diagnostics.responseId) {
        lines.push(language === 'zh'
            ? `Response ID: ${diagnostics.responseId}`
            : `Response ID: ${diagnostics.responseId}`);
    }

    if (diagnostics.modelVersion) {
        lines.push(language === 'zh'
            ? `模型版本: ${diagnostics.modelVersion}`
            : `Model version: ${diagnostics.modelVersion}`);
    }

    if (
        diagnostics.hadCandidate !== undefined ||
        diagnostics.hadCandidateParts !== undefined ||
        diagnostics.hadThoughtChunk !== undefined
    ) {
        lines.push(
            language === 'zh'
                ? `候选状态: hadCandidate=${String(diagnostics.hadCandidate)}, hadCandidateParts=${String(diagnostics.hadCandidateParts)}, hadThoughtChunk=${String(diagnostics.hadThoughtChunk)}`
                : `Candidate status: hadCandidate=${String(diagnostics.hadCandidate)}, hadCandidateParts=${String(diagnostics.hadCandidateParts)}, hadThoughtChunk=${String(diagnostics.hadThoughtChunk)}`
        );
    }

    if (lines.length === 0) {
        const rawDiagnostics = JSON.stringify(diagnostics);
        lines.push(
            language === 'zh'
                ? `诊断对象未包含可识别字段。raw=${rawDiagnostics}`
                : `Diagnostics object had no recognized fields. raw=${rawDiagnostics}`
        );
    }

    const header = language === 'zh'
        ? '模型未返回可显示内容。诊断信息:'
        : 'Model returned no displayable content. Diagnostics:';

    return `${header}\n${lines.map((line, index) => `${index + 1}. ${line}`).join('\n')}`;
};

export const useChatStreamHandler = ({
    appSettings,
    updateAndPersistSessions,
    setSessionLoading,
    activeJobs
}: ChatStreamHandlerProps) => {
    const { handleApiError } = useApiErrorHandler(updateAndPersistSessions);

    const getStreamHandlers = useCallback((
        currentSessionId: string,
        generationId: string,
        abortController: AbortController,
        generationStartTime: Date,
        currentChatSettings: IndividualChatSettings,
        options?: { onSuccess?: (generationId: string, finalContent: string) => void; onEmptyResponse?: (generationId: string) => void; suppressEmptyResponseError?: boolean }
    ) => {
        const newModelMessageIds = new Set<string>([generationId]);
        let firstContentPartTime: Date | null = null;
        let accumulatedText = "";
        let accumulatedThoughts = "";
        const onSuccess = options?.onSuccess;
        const onEmptyResponse = options?.onEmptyResponse;
        const suppressEmptyResponseError = options?.suppressEmptyResponseError ?? false;

        // Reset store for this new generation
        streamingStore.clear(generationId);

        const streamOnError = (error: Error) => {
            handleApiError(error, currentSessionId, generationId);
            setSessionLoading(currentSessionId, false);
            activeJobs.current.delete(generationId);
            streamingStore.clear(generationId);
        };

        const streamOnComplete = (
            usageMetadata?: UsageMetadata,
            groundingMetadata?: any,
            urlContextMetadata?: any,
            diagnostics?: ChatStreamCompleteDiagnostics
        ) => {
            const lang = appSettings.language === 'system' 
                ? (navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en')
                : appSettings.language;

            if (appSettings.isStreamingEnabled && !firstContentPartTime) {
                firstContentPartTime = new Date();
            }

            if (usageMetadata) {
                const { promptTokens, completionTokens } = calculateTokenStats(usageMetadata);
                logService.recordTokenUsage(
                    currentChatSettings.modelId,
                    promptTokens,
                    completionTokens
                );
            }

            const isEmptyResponse = !accumulatedText.trim() && !accumulatedThoughts.trim();
            const detailedEmptyResponseMessage = isEmptyResponse
                ? buildDetailedEmptyResponseMessage(lang, diagnostics)
                : undefined;
            if (isEmptyResponse) {
                logService.warn('Stream completed with empty response payload.', {
                    sessionId: currentSessionId,
                    generationId,
                    diagnostics,
                });
            }
            const shouldAutoContinue = !!onEmptyResponse && isEmptyResponse && !abortController.signal.aborted;
            if (shouldAutoContinue) {
                onEmptyResponse?.(generationId);
            }

            const shouldSuppressEmptyError = suppressEmptyResponseError || shouldAutoContinue;

            // Perform the Final Update to State (and DB)
            updateAndPersistSessions(prev => {
                const sessionIndex = prev.findIndex(s => s.id === currentSessionId);
                if (sessionIndex === -1) return prev;

                const newSessions = [...prev];
                const sessionToUpdate = { ...newSessions[sessionIndex] };
                
                // Construct a virtual "final" part containing the full text from the store
                // We use updateMessagesWithBatch but we manually inject the accumulated text
                // because the state messages haven't been updating with text during the stream.
                
                // 1. First, make sure the message exists and has basic structure (it was created at start)
                // 2. Update its content with accumulatedText and accumulatedThoughts
                
                let updatedMessages = sessionToUpdate.messages.map(msg => {
                    if (msg.id === generationId) {
                        return {
                            ...msg,
                            content: (msg.content || '') + accumulatedText,
                            thoughts: (msg.thoughts || '') + accumulatedThoughts
                        };
                    }
                    return msg;
                });

                const hasTargetMessage = updatedMessages.some(msg => msg.id === generationId);
                if (!hasTargetMessage) {
                    logService.warn('Stream completion target message missing; appending fallback model message.', {
                        sessionId: currentSessionId,
                        generationId,
                    });
                    updatedMessages = [
                        ...updatedMessages,
                        createMessage('model', accumulatedText, {
                            id: generationId,
                            isLoading: true,
                            generationStartTime,
                            thoughts: accumulatedThoughts || undefined,
                        }),
                    ];
                }
                
                // 3. Finalize (mark loading false, set stats)
                const finalizationResult = finalizeMessages(
                    updatedMessages,
                    generationStartTime,
                    newModelMessageIds,
                    currentChatSettings,
                    lang,
                    firstContentPartTime,
                    usageMetadata,
                    groundingMetadata,
                    urlContextMetadata,
                    diagnostics,
                    abortController.signal.aborted || shouldSuppressEmptyError,
                    detailedEmptyResponseMessage
                );

                sessionToUpdate.messages = finalizationResult.updatedMessages;
                newSessions[sessionIndex] = sessionToUpdate;

                if (finalizationResult.completedMessageForNotification) {
                    if (appSettings.isCompletionSoundEnabled) {
                        playCompletionSound();
                    }
                    if (appSettings.isCompletionNotificationEnabled && document.hidden) {
                        const msg = finalizationResult.completedMessageForNotification;
                        const notificationBody = (msg.content || "Media or tool response received").substring(0, 150) + (msg.content && msg.content.length > 150 ? '...' : '');
                        showNotification(
                            'Response Ready', 
                            {
                                body: notificationBody,
                                icon: APP_LOGO_SVG_DATA_URI,
                            }
                        );
                    }
                }

                return newSessions;
            }, { persist: true });

            setSessionLoading(currentSessionId, false);
            activeJobs.current.delete(generationId);
            streamingStore.clear(generationId);

            if (onSuccess && !abortController.signal.aborted) {
                setTimeout(() => onSuccess(generationId, accumulatedText), 0);
            }
        };

        const streamOnPart = (part: Part) => {
            const anyPart = part as any;
            
            if (anyPart.thought) {
                // Should be routed through onThoughtChunk, but fallback here just in case
                accumulatedThoughts += (anyPart.text || '');
                streamingStore.updateThoughts(generationId, anyPart.text || '');
                return;
            }

            // 1. Accumulate plain text
            let chunkText = "";
            if (anyPart.text) {
                chunkText = anyPart.text;
                accumulatedText += chunkText;
                streamingStore.updateContent(generationId, chunkText);
            }

            // 2. Handle Tools / Code (Convert to text representation for the store)
            if (anyPart.executableCode) {
                const codePart = anyPart.executableCode as { language: string, code: string };
                const toolContent = `\`\`\`${codePart.language.toLowerCase() || 'python'}\n${codePart.code}\n\`\`\``;
                accumulatedText += toolContent;
                streamingStore.updateContent(generationId, toolContent);
            } else if (anyPart.codeExecutionResult) {
                const resultPart = anyPart.codeExecutionResult as { outcome: string, output?: string };
                const escapeHtml = (unsafe: string) => {
                    if (typeof unsafe !== 'string') return '';
                    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
                };
                let toolContent = `<div class="tool-result outcome-${resultPart.outcome.toLowerCase()}"><strong>Execution Result (${resultPart.outcome}):</strong>`;
                if (resultPart.output) {
                    toolContent += `<pre><code class="language-text">${escapeHtml(resultPart.output)}</code></pre>`;
                }
                toolContent += '</div>';
                accumulatedText += toolContent;
                streamingStore.updateContent(generationId, toolContent);
            } else if (anyPart.inlineData) {
                // For files, we still MUST update the session state because they are objects, not just text string.
                // We use a simplified update that ONLY targets the file array for this message.
                // This will trigger a React update, but it's infrequent (once per image generation usually).
                updateAndPersistSessions(prev => {
                     const sessionIndex = prev.findIndex(s => s.id === currentSessionId);
                     if (sessionIndex === -1) return prev;
                     const newSessions = [...prev];
                     const sessionToUpdate = { ...newSessions[sessionIndex] };
                     // Only apply parts to messages, assume no thought here
                     sessionToUpdate.messages = updateMessagesWithBatch(
                         sessionToUpdate.messages,
                         [part], 
                         "", 
                         generationStartTime, 
                         newModelMessageIds, 
                         firstContentPartTime
                     );
                     newSessions[sessionIndex] = sessionToUpdate;
                     return newSessions;
                }, { persist: false });
            }

            const hasMeaningfulContent = 
                (anyPart.text && anyPart.text.trim().length > 0) || 
                anyPart.executableCode || 
                anyPart.codeExecutionResult || 
                anyPart.inlineData;

            if (appSettings.isStreamingEnabled && !firstContentPartTime && hasMeaningfulContent) {
                firstContentPartTime = new Date();
            }
        };
        
        const onThoughtChunk = (thoughtChunk: string) => {
            accumulatedThoughts += thoughtChunk;
            streamingStore.updateThoughts(generationId, thoughtChunk);
        };
        
        return { streamOnError, streamOnComplete, streamOnPart, onThoughtChunk };

    }, [appSettings.isStreamingEnabled, appSettings.isCompletionNotificationEnabled, appSettings.isCompletionSoundEnabled, appSettings.language, updateAndPersistSessions, handleApiError, setSessionLoading, activeJobs]);
    
    return { getStreamHandlers };
};
