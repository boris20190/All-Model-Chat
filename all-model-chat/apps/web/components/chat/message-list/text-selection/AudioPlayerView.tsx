
import React from 'react';
import { GripVertical, X, Loader2 } from 'lucide-react';

interface AudioPlayerViewProps {
    audioUrl: string | null;
    isLoading: boolean;
    playbackError?: string | null;
    audioRef: React.RefObject<HTMLAudioElement>;
    onDragStart: (e: React.MouseEvent) => void;
    onClose: (e: React.MouseEvent) => void;
    onAudioError?: () => void;
    onAudioPlay?: () => void;
    onAudioPause?: () => void;
}

export const AudioPlayerView: React.FC<AudioPlayerViewProps> = ({ 
    audioUrl, 
    isLoading, 
    playbackError,
    audioRef, 
    onDragStart, 
    onClose,
    onAudioError,
    onAudioPlay,
    onAudioPause,
}) => {
    if (isLoading) {
        return (
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-[var(--theme-text-primary)]">
                <Loader2 size={14} className="animate-spin text-[var(--theme-text-link)]" />
                <span>Generating Audio...</span>
            </div>
        );
    }

    if (!audioUrl) return null;

    return (
        <div className="flex items-center gap-1 pl-1 pr-2 py-1">
            <div 
                onMouseDown={onDragStart}
                className="cursor-grab active:cursor-grabbing p-1 text-[var(--theme-text-tertiary)] hover:text-[var(--theme-text-primary)] transition-colors touch-none"
                title="Drag to move"
            >
                <GripVertical size={14} />
            </div>
            
            <audio 
                ref={audioRef} 
                src={audioUrl} 
                controls 
                autoPlay 
                onError={onAudioError}
                onPlay={onAudioPlay}
                onPause={onAudioPause}
                className="h-8 w-80 rounded-full focus:outline-none"
            />
            <button 
                onClick={onClose}
                className="p-1.5 rounded-full text-[var(--theme-text-tertiary)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)] ml-1"
            >
                <X size={16} />
            </button>
            {playbackError && (
                <span className="ml-1 text-[11px] text-red-400 whitespace-nowrap">{playbackError}</span>
            )}
        </div>
    );
};
