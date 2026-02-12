import { useRef, useState, useCallback, useEffect } from 'react';
import { VirtuosoHandle } from 'react-virtuoso';
import { ChatMessage } from '../../../../types';

interface UseMessageListScrollProps {
    messages: ChatMessage[];
    setScrollContainerRef: (node: HTMLDivElement | null) => void;
    activeSessionId: string | null;
}

export const useMessageListScroll = ({ messages, setScrollContainerRef, activeSessionId }: UseMessageListScrollProps) => {
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const [atBottom, setAtBottom] = useState(true);
    const [scrollerRef, setInternalScrollerRef] = useState<HTMLElement | null>(null);
    const [visibleRange, setVisibleRange] = useState({ startIndex: 0, endIndex: 0 });

    const scrollSaveTimeoutRef = useRef<number | null>(null);
    const lastRestoredSessionIdRef = useRef<string | null>(null);
    const lastScrollTarget = useRef<number | null>(null);
    const prevMsgCount = useRef(messages.length);
    const prevSessionIdForAnchor = useRef(activeSessionId);

    useEffect(() => {
        if (scrollerRef) {
            setScrollContainerRef(scrollerRef as HTMLDivElement);
        }
    }, [scrollerRef, setScrollContainerRef]);

    const onRangeChanged = useCallback(({ startIndex, endIndex }: { startIndex: number; endIndex: number }) => {
        setVisibleRange({ startIndex, endIndex });
    }, []);

    // Keep response anchored on the newly added model message unless a session restore is pending.
    useEffect(() => {
        const sessionChanged = prevSessionIdForAnchor.current !== activeSessionId;
        const restorationPending = lastRestoredSessionIdRef.current !== activeSessionId;

        if (sessionChanged || restorationPending) {
            prevSessionIdForAnchor.current = activeSessionId;
            prevMsgCount.current = messages.length;
            return;
        }

        if (messages.length > prevMsgCount.current) {
            let targetIndex = -1;
            for (let i = messages.length - 1; i >= Math.max(0, prevMsgCount.current - 1); i--) {
                if (messages[i].role === 'model') {
                    targetIndex = i;
                    break;
                }
            }

            if (targetIndex !== -1) {
                window.setTimeout(() => {
                    virtuosoRef.current?.scrollToIndex({
                        index: targetIndex,
                        align: 'start',
                        behavior: 'smooth'
                    });
                    lastScrollTarget.current = targetIndex;
                }, 50);
            }
        }

        prevMsgCount.current = messages.length;
    }, [messages, activeSessionId]);

    const scrollToPrevTurn = useCallback(() => {
        let targetIndex = -1;

        for (let i = Math.max(0, visibleRange.startIndex - 1); i >= 0; i--) {
            if (messages[i].role === 'user') {
                targetIndex = i;
                break;
            }
        }

        if (targetIndex !== -1) {
            lastScrollTarget.current = targetIndex;
            virtuosoRef.current?.scrollToIndex({ index: targetIndex, align: 'start', behavior: 'smooth' });
            return;
        }

        virtuosoRef.current?.scrollToIndex({ index: 0, align: 'start', behavior: 'smooth' });
    }, [messages, visibleRange.startIndex]);

    const scrollToNextTurn = useCallback(() => {
        let targetIndex = -1;
        let startSearchIndex = visibleRange.startIndex + 1;

        if (lastScrollTarget.current !== null && Math.abs(visibleRange.startIndex - lastScrollTarget.current) <= 1) {
            startSearchIndex = Math.max(startSearchIndex, lastScrollTarget.current + 1);
        }

        for (let i = startSearchIndex; i < messages.length; i++) {
            if (messages[i].role === 'user') {
                targetIndex = i;
                break;
            }
        }

        if (targetIndex !== -1) {
            lastScrollTarget.current = targetIndex;
            virtuosoRef.current?.scrollToIndex({ index: targetIndex, align: 'start', behavior: 'smooth' });
            return;
        }

        const lastIndex = Math.max(0, messages.length - 1);
        lastScrollTarget.current = lastIndex;
        virtuosoRef.current?.scrollToIndex({ index: lastIndex, align: 'end', behavior: 'smooth' });
    }, [messages, visibleRange.startIndex]);

    const handleScroll = useCallback(() => {
        if (document.hidden) return;

        const container = scrollerRef;
        if (!container) return;

        const { scrollTop, scrollHeight, clientHeight } = container;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;

        if (isAtBottom !== atBottom) {
            setAtBottom(isAtBottom);
        }

        if (activeSessionId && lastRestoredSessionIdRef.current === activeSessionId && messages.length > 0) {
            if (scrollSaveTimeoutRef.current) {
                clearTimeout(scrollSaveTimeoutRef.current);
            }
            scrollSaveTimeoutRef.current = window.setTimeout(() => {
                localStorage.setItem(`chat_scroll_pos_${activeSessionId}`, scrollTop.toString());
            }, 300);
        }
    }, [scrollerRef, atBottom, activeSessionId, messages.length]);

    useEffect(() => {
        if (!activeSessionId) return;
        if (lastRestoredSessionIdRef.current === activeSessionId) return;
        if (messages.length === 0) return;

        const savedPos = localStorage.getItem(`chat_scroll_pos_${activeSessionId}`);

        window.setTimeout(() => {
            if (savedPos !== null) {
                const top = parseInt(savedPos, 10);
                virtuosoRef.current?.scrollTo({ top });
            } else {
                virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, align: 'end' });
            }
            lastRestoredSessionIdRef.current = activeSessionId;
        }, 50);
    }, [activeSessionId, messages.length]);

    useEffect(() => {
        const container = scrollerRef;
        if (!container) return;

        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => container.removeEventListener('scroll', handleScroll);
    }, [scrollerRef, handleScroll]);

    const showScrollDown = !atBottom;
    const showScrollUp = messages.length > 2 && visibleRange.startIndex > 0;

    return {
        virtuosoRef,
        setInternalScrollerRef,
        setAtBottom,
        onRangeChanged,
        scrollToPrevTurn,
        scrollToNextTurn,
        showScrollDown,
        showScrollUp,
        scrollerRef,
    };
};
