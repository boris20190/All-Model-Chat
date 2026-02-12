
import { useState, useRef, useEffect, useCallback } from 'react';

export const useSelectionAudio = () => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [playbackError, setPlaybackError] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        return () => {
            if (audioUrl) URL.revokeObjectURL(audioUrl);
        };
    }, [audioUrl]);

    useEffect(() => {
        if (!audioUrl || !isPlaying || !audioRef.current) return;

        const audioEl = audioRef.current;
        const rafId = window.requestAnimationFrame(() => {
            const playPromise = audioEl.play();
            if (playPromise !== undefined) {
                playPromise.catch((error) => {
                    console.warn('Selection TTS autoplay failed:', error);
                    setPlaybackError('Audio is ready. Press play to start.');
                    setIsPlaying(false);
                });
            }
        });

        return () => window.cancelAnimationFrame(rafId);
    }, [audioUrl, isPlaying]);

    const clearPlaybackError = useCallback(() => {
        setPlaybackError(null);
    }, []);

    const handleAudioPlaybackError = useCallback(() => {
        setPlaybackError('Unable to decode audio in the browser.');
        setIsPlaying(false);
    }, []);

    const play = (url: string) => {
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        setPlaybackError(null);
        setAudioUrl(url);
        setIsPlaying(true);
    };

    const stop = () => {
        setIsPlaying(false);
        setAudioUrl(null);
        setPlaybackError(null);
    };

    return {
        isPlaying,
        isLoading,
        audioUrl,
        playbackError,
        setIsLoading,
        play,
        stop,
        audioRef,
        clearPlaybackError,
        handleAudioPlaybackError,
    };
};
