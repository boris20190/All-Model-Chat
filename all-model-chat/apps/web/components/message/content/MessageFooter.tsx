
import React, { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ChatMessage } from '../../../types';
import { translations } from '../../../utils/appUtils';
import { PerformanceMetrics } from '../PerformanceMetrics';
import { AudioPlayer } from '../../shared/AudioPlayer';

interface MessageFooterProps {
    message: ChatMessage;
    t: (key: keyof typeof translations) => string;
    onSuggestionClick?: (suggestion: string) => void;
}

export const MessageFooter: React.FC<MessageFooterProps> = ({ message, t, onSuggestionClick }) => {
    const [isInvokedDetailsExpanded, setIsInvokedDetailsExpanded] = useState(false);
    const { audioSrc, audioAutoplay, suggestions, isGeneratingSuggestions, role, generationStartTime } = message;
    const mcpAttachedServerIds = message.mcpDiagnostics?.attachedServerIds || [];
    const mcpRequestedServerIds = message.mcpDiagnostics?.requestedServerIds || [];
    const mcpInvokedTools = message.mcpDiagnostics?.invokedTools || [];
    const hasInvokedTools = mcpInvokedTools.length > 0;
    const hasMcpDiagnostics =
        mcpAttachedServerIds.length > 0 ||
        mcpRequestedServerIds.length > 0 ||
        message.mcpDiagnostics?.degraded;

    const formatServerIds = (serverIds: string[]): string => {
        const MAX_DISPLAY_COUNT = 4;
        if (serverIds.length <= MAX_DISPLAY_COUNT) {
            return serverIds.join(', ');
        }
        const head = serverIds.slice(0, MAX_DISPLAY_COUNT).join(', ');
        return `${head} +${serverIds.length - MAX_DISPLAY_COUNT}`;
    };

    const mcpStatusText = mcpAttachedServerIds.length > 0
        ? `${t('message_mcp_attached')}: ${formatServerIds(mcpAttachedServerIds)}`
        : `${t('message_mcp_requested')}: ${formatServerIds(mcpRequestedServerIds)}`;
    const invokedDetailsText = useMemo(
        () => mcpInvokedTools.map((entry) => `${entry.serverId}.${entry.toolName}`).join(', '),
        [mcpInvokedTools]
    );

    return (
        <>
            {audioSrc && (
                <div className="mt-2 animate-in fade-in slide-in-from-bottom-1 duration-300">
                    <AudioPlayer src={audioSrc} autoPlay={audioAutoplay ?? false} />
                </div>
            )}
            
            {(role === 'model' || (role === 'error' && generationStartTime)) && (
                <PerformanceMetrics 
                    message={message} 
                    t={t} 
                    hideTimer={message.isLoading}
                />
            )}

            {hasMcpDiagnostics && (
                <div className="mt-1 flex justify-end">
                    <div className="text-[10px] sm:text-[11px] text-[var(--theme-text-tertiary)] font-mono bg-[var(--theme-bg-tertiary)]/25 border border-[var(--theme-border-secondary)]/30 rounded-md px-2 py-0.5 max-w-full">
                        <div className="flex flex-wrap items-center gap-x-1">
                            <span>{mcpStatusText}</span>
                            {message.mcpDiagnostics?.degraded && <span>{` · ${t('message_mcp_degraded')}`}</span>}
                            {hasInvokedTools && (
                                <>
                                    <span>{` · ${t('message_mcp_called_count').replace('{count}', String(mcpInvokedTools.length))}`}</span>
                                    <button
                                        type="button"
                                        onClick={() => setIsInvokedDetailsExpanded((prev) => !prev)}
                                        className="underline decoration-dotted text-[var(--theme-text-link)] hover:opacity-90"
                                    >
                                        {isInvokedDetailsExpanded ? t('message_mcp_hide_details') : t('message_mcp_show_details')}
                                    </button>
                                </>
                            )}
                        </div>
                        {hasInvokedTools && isInvokedDetailsExpanded && (
                            <div className="mt-1 break-words whitespace-pre-wrap text-[10px] sm:text-[11px]">
                                {invokedDetailsText}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {(suggestions && suggestions.length > 0) && (
                <div className="mt-3 flex flex-wrap gap-2 animate-in fade-in slide-in-from-bottom-1 duration-300">
                    {suggestions.map((suggestion, index) => (
                        <button
                            key={index}
                            onClick={() => onSuggestionClick && onSuggestionClick(suggestion)}
                            className="
                                group relative
                                text-xs sm:text-sm font-medium
                                px-3 py-2 sm:px-3.5 sm:py-2 rounded-xl
                                border border-[var(--theme-border-secondary)]
                                bg-[var(--theme-bg-tertiary)]/20 
                                hover:bg-[var(--theme-bg-tertiary)]
                                hover:border-[var(--theme-border-focus)]
                                text-[var(--theme-text-secondary)] hover:text-[var(--theme-text-link)]
                                transition-all duration-200 ease-out
                                text-left shadow-sm hover:shadow-md
                                active:scale-95
                            "
                        >
                            <span className="line-clamp-2">{suggestion}</span>
                        </button>
                    ))}
                </div>
            )}
            
            {isGeneratingSuggestions && (
                <div className="mt-3 flex items-center gap-2 text-xs text-[var(--theme-text-tertiary)] animate-pulse opacity-70 px-1">
                    <Loader2 size={12} className="animate-spin" strokeWidth={1.5} />
                    <span>Generating suggestions...</span>
                </div>
            )}
        </>
    );
};
