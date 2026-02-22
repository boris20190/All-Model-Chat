
import React from 'react';
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
    const { audioSrc, audioAutoplay, suggestions, isGeneratingSuggestions, role, generationStartTime } = message;
    const webGrounding = message.webGrounding;
    const showWebGroundingStatus = role === 'model' && !message.isLoading && webGrounding?.required === true;
    const countsTemplate = t('web_grounding_counts');
    const webEvidenceCounts = countsTemplate
        .replace('{queries}', String(webGrounding?.evidence?.webSearchQueries ?? 0))
        .replace('{chunks}', String(webGrounding?.evidence?.webGroundingChunks ?? 0))
        .replace('{citations}', String(webGrounding?.evidence?.citations ?? 0))
        .replace('{urls}', String(webGrounding?.evidence?.urlContextUrls ?? 0));
    const webGroundingIsSatisfied = webGrounding?.satisfied === true;

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

            {showWebGroundingStatus && (
                <div
                    className={`mt-2 inline-flex items-center gap-2 text-[10px] sm:text-[11px] px-2 py-1 rounded-md border ${
                        webGroundingIsSatisfied
                            ? 'text-green-700 bg-green-500/10 border-green-500/20'
                            : 'text-amber-700 bg-amber-500/10 border-amber-500/20'
                    }`}
                    title={webGrounding?.reason || undefined}
                >
                    <span className="font-semibold">
                        {webGroundingIsSatisfied ? t('web_grounding_verified') : t('web_grounding_missing')}
                    </span>
                    <span className="opacity-80 font-mono">{webEvidenceCounts}</span>
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
