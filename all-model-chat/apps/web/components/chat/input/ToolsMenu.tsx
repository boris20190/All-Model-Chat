import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
    SlidersHorizontal,
    Globe,
    Check,
    Terminal,
    Link,
    X,
    Telescope,
    Calculator,
    Wrench,
    PlugZap,
    CircleDot,
    Lock,
} from 'lucide-react';
import type { ChatToolMode, McpServerStatus } from '@all-model-chat/shared-api';
import { translations } from '../../../utils/appUtils';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { IconYoutube } from '../../icons/CustomIcons';
import { CHAT_INPUT_BUTTON_CLASS } from '../../../constants/appConstants';
import { useWindowContext } from '../../../contexts/WindowContext';
import { hasBuiltinToolsEnabled, hasMcpToolsSelected, resolveToolMode, normalizeToolMode } from '../../../utils/toolMode.js';

interface ToolsMenuProps {
    toolMode?: ChatToolMode;
    onSelectToolMode?: (mode: ChatToolMode) => void;
    enabledMcpServerIds?: string[];
    onToggleMcpServer?: (serverId: string) => void;
    mcpSelectionLocked?: boolean;
    mcpServers?: McpServerStatus[];
    isMcpEnabled?: boolean;
    isMcpStatusLoading?: boolean;
    mcpStatusError?: string | null;
    isGoogleSearchEnabled: boolean;
    onToggleGoogleSearch: () => void;
    isCodeExecutionEnabled: boolean;
    onToggleCodeExecution: () => void;
    isUrlContextEnabled: boolean;
    onToggleUrlContext: () => void;
    isDeepSearchEnabled: boolean;
    onToggleDeepSearch: () => void;
    onAddYouTubeVideo: () => void;
    onCountTokens: () => void;
    disabled: boolean;
    t: (key: keyof typeof translations) => string;
    isNativeAudioModel?: boolean;
}

const ActiveToolBadge: React.FC<{
    label: string;
    onRemove: () => void;
    removeAriaLabel: string;
    icon: React.ReactNode;
}> = ({ label, onRemove, removeAriaLabel, icon }) => (
    <>
        <div className="h-4 w-px bg-[var(--theme-border-secondary)] mx-1.5"></div>
        <div
            className="group flex items-center gap-1.5 bg-blue-500/10 text-[var(--theme-text-link)] text-sm px-2.5 py-1 rounded-full transition-all select-none hover:bg-[var(--theme-bg-tertiary)] hover:text-[var(--theme-text-primary)] cursor-pointer"
            style={{ animation: `fadeInUp 0.3s ease-out both` }}
            onClick={onRemove}
            role="button"
            aria-label={removeAriaLabel}
        >
            <div className="relative flex items-center justify-center w-3.5 h-3.5">
                <span className="absolute inset-0 flex items-center justify-center transition-all duration-200 opacity-100 scale-100 group-hover:opacity-0 group-hover:scale-75 rotate-0 group-hover:-rotate-90">
                    {icon}
                </span>
                <span className="absolute inset-0 flex items-center justify-center transition-all duration-200 opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 rotate-90 group-hover:rotate-0 text-[var(--theme-icon-error)]">
                    <X size={14} strokeWidth={2.5} />
                </span>
            </div>
            <span className="font-medium">{label}</span>
        </div>
    </>
);

const ModeTag: React.FC<{ mode: ChatToolMode }> = ({ mode }) => {
    const modeText = mode === 'builtin' ? 'Built-in' : mode === 'custom' ? 'Custom' : 'None';
    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-secondary)] border border-[var(--theme-border-secondary)]">
            <CircleDot size={11} />
            {modeText}
        </span>
    );
};

export const ToolsMenu: React.FC<ToolsMenuProps> = ({
    toolMode,
    onSelectToolMode,
    enabledMcpServerIds,
    onToggleMcpServer,
    mcpSelectionLocked,
    mcpServers,
    isMcpEnabled,
    isMcpStatusLoading,
    mcpStatusError,
    isGoogleSearchEnabled,
    onToggleGoogleSearch,
    isCodeExecutionEnabled,
    onToggleCodeExecution,
    isUrlContextEnabled,
    onToggleUrlContext,
    isDeepSearchEnabled,
    onToggleDeepSearch,
    onAddYouTubeVideo,
    onCountTokens,
    disabled,
    t,
    isNativeAudioModel,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [menuPosition, setMenuPosition] = useState<React.CSSProperties>({});
    const containerRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const { window: targetWindow } = useWindowContext();

    useClickOutside(containerRef, () => setIsOpen(false), isOpen);

    useEffect(() => {
        if (!isOpen || !menuRef.current) return;

        const stopProp = (event: Event) => event.stopPropagation();
        const menuEl = menuRef.current;

        menuEl.addEventListener('mousedown', stopProp);
        menuEl.addEventListener('touchstart', stopProp);

        return () => {
            menuEl.removeEventListener('mousedown', stopProp);
            menuEl.removeEventListener('touchstart', stopProp);
        };
    }, [isOpen]);

    useLayoutEffect(() => {
        if (isOpen && buttonRef.current && targetWindow) {
            const buttonRect = buttonRef.current.getBoundingClientRect();
            const viewportWidth = targetWindow.innerWidth;
            const viewportHeight = targetWindow.innerHeight;

            const MENU_WIDTH = 320;
            const BUTTON_MARGIN = 10;
            const GAP = 8;

            const nextStyle: React.CSSProperties = {
                position: 'fixed',
                zIndex: 9999,
            };

            if (buttonRect.left + MENU_WIDTH > viewportWidth - BUTTON_MARGIN) {
                nextStyle.left = buttonRect.right - MENU_WIDTH;
                nextStyle.transformOrigin = 'bottom right';
            } else {
                nextStyle.left = buttonRect.left;
                nextStyle.transformOrigin = 'bottom left';
            }

            nextStyle.bottom = viewportHeight - buttonRect.top + GAP;
            setMenuPosition(nextStyle);
        }
    }, [isOpen, targetWindow]);

    const mcpServerIds = Array.isArray(enabledMcpServerIds) ? enabledMcpServerIds : [];
    const mcpSelected = hasMcpToolsSelected({ enabledMcpServerIds: mcpServerIds });
    const builtinSelected = hasBuiltinToolsEnabled({
        isGoogleSearchEnabled,
        isCodeExecutionEnabled,
        isUrlContextEnabled,
        isDeepSearchEnabled,
    });

    const effectiveMode = resolveToolMode({
        toolMode: normalizeToolMode(toolMode),
        enabledMcpServerIds: mcpServerIds,
        isGoogleSearchEnabled,
        isCodeExecutionEnabled,
        isUrlContextEnabled,
        isDeepSearchEnabled,
    });

    const customControlsDisabled = effectiveMode === 'builtin' && builtinSelected;
    const builtinControlsDisabled = effectiveMode === 'custom';
    const modeSwitchLocked = !!mcpSelectionLocked && mcpSelected;

    const handleSelectMode = (mode: ChatToolMode) => {
        if (!onSelectToolMode) return;
        onSelectToolMode(mode);
        setIsOpen(false);
    };

    const handleToggle = (toggleFn: () => void, blocked: boolean) => {
        if (blocked || disabled) return;
        toggleFn();
        setIsOpen(false);
    };

    const handleToggleServer = (serverId: string) => {
        if (!onToggleMcpServer || disabled || customControlsDisabled || mcpSelectionLocked) return;
        onToggleMcpServer(serverId);
    };

    const menuIconSize = 20;

    const menuItems = [
        {
            key: 'deep_search_label',
            label: t('deep_search_label' as any),
            icon: <Telescope size={18} strokeWidth={2} />,
            enabled: isDeepSearchEnabled,
            onClick: () => handleToggle(onToggleDeepSearch, builtinControlsDisabled),
            disabled: builtinControlsDisabled,
        },
        {
            key: 'web_search_label',
            label: t('web_search_label' as any),
            icon: <Globe size={18} strokeWidth={2} />,
            enabled: isGoogleSearchEnabled,
            onClick: () => handleToggle(onToggleGoogleSearch, builtinControlsDisabled),
            disabled: builtinControlsDisabled,
        },
        {
            key: 'code_execution_label',
            label: t('code_execution_label' as any),
            icon: <Terminal size={18} strokeWidth={2} />,
            enabled: isCodeExecutionEnabled,
            onClick: () => handleToggle(onToggleCodeExecution, builtinControlsDisabled),
            disabled: builtinControlsDisabled,
        },
        {
            key: 'url_context_label',
            label: t('url_context_label' as any),
            icon: <Link size={18} strokeWidth={2} />,
            enabled: isUrlContextEnabled,
            onClick: () => handleToggle(onToggleUrlContext, builtinControlsDisabled),
            disabled: builtinControlsDisabled,
        },
        {
            key: 'attachMenu_addByUrl',
            label: t('attachMenu_addByUrl' as any),
            icon: <IconYoutube size={18} strokeWidth={2} />,
            enabled: false,
            onClick: () => {
                onAddYouTubeVideo();
                setIsOpen(false);
            },
            disabled: false,
        },
        {
            key: 'tools_token_count_label',
            label: t('tools_token_count_label' as any),
            icon: <Calculator size={18} strokeWidth={2} />,
            enabled: false,
            onClick: () => {
                onCountTokens();
                setIsOpen(false);
            },
            disabled: false,
        },
    ];

    const filteredItems = menuItems.filter(() => !isNativeAudioModel);
    const visibleMcpServers = Array.isArray(mcpServers) ? mcpServers : [];

    return (
        <div className="flex items-center">
            <div className="relative" ref={containerRef}>
                <button
                    ref={buttonRef}
                    type="button"
                    onClick={() => setIsOpen((prev) => !prev)}
                    disabled={disabled}
                    className={`${CHAT_INPUT_BUTTON_CLASS} text-[var(--theme-icon-attach)] ${isOpen ? 'bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-primary)]' : 'bg-transparent hover:bg-[var(--theme-bg-tertiary)]'}`}
                    aria-label={t('tools_button')}
                    title={t('tools_button')}
                    aria-haspopup="true"
                    aria-expanded={isOpen}
                >
                    <SlidersHorizontal size={menuIconSize} strokeWidth={2} />
                </button>

                {isOpen && targetWindow && createPortal(
                    <div
                        ref={menuRef}
                        className="fixed w-80 bg-[var(--theme-bg-primary)] border border-[var(--theme-border-secondary)] rounded-xl shadow-premium py-2 animate-in fade-in zoom-in-95 duration-100 custom-scrollbar"
                        style={menuPosition}
                        role="menu"
                    >
                        <div className="px-4 pb-2 border-b border-[var(--theme-border-secondary)]">
                            <div className="flex items-center justify-between gap-2">
                                <div className="text-xs uppercase tracking-wide text-[var(--theme-text-tertiary)]">Tool Mode</div>
                                <ModeTag mode={effectiveMode} />
                            </div>
                            <div className="mt-2 grid grid-cols-3 gap-2">
                                <button
                                    type="button"
                                    onClick={() => handleSelectMode('builtin')}
                                    disabled={disabled || builtinControlsDisabled || modeSwitchLocked}
                                    className={`px-2 py-1.5 text-xs rounded-md border transition-colors ${effectiveMode === 'builtin' ? 'border-[var(--theme-border-focus)] text-[var(--theme-text-link)] bg-[var(--theme-bg-tertiary)]' : 'border-[var(--theme-border-secondary)] text-[var(--theme-text-secondary)]'} disabled:opacity-40`}
                                >
                                    Built-in
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleSelectMode('custom')}
                                    disabled={disabled || customControlsDisabled || (modeSwitchLocked && effectiveMode !== 'custom')}
                                    className={`px-2 py-1.5 text-xs rounded-md border transition-colors ${effectiveMode === 'custom' ? 'border-[var(--theme-border-focus)] text-[var(--theme-text-link)] bg-[var(--theme-bg-tertiary)]' : 'border-[var(--theme-border-secondary)] text-[var(--theme-text-secondary)]'} disabled:opacity-40`}
                                >
                                    Custom
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleSelectMode('none')}
                                    disabled={disabled || modeSwitchLocked}
                                    className={`px-2 py-1.5 text-xs rounded-md border transition-colors ${effectiveMode === 'none' ? 'border-[var(--theme-border-focus)] text-[var(--theme-text-link)] bg-[var(--theme-bg-tertiary)]' : 'border-[var(--theme-border-secondary)] text-[var(--theme-text-secondary)]'} disabled:opacity-40`}
                                >
                                    None
                                </button>
                            </div>
                            {mcpSelectionLocked && (
                                <div className="mt-2 text-[11px] text-[var(--theme-text-tertiary)] flex items-center gap-1.5">
                                    <Lock size={12} />
                                    MCP selection is locked after the first message.
                                </div>
                            )}
                        </div>

                        <div className="px-4 py-2 border-b border-[var(--theme-border-secondary)]">
                            <div className="text-xs uppercase tracking-wide text-[var(--theme-text-tertiary)] mb-1.5">Built-in Tools</div>
                            <div className="space-y-1">
                                {filteredItems.map((item) => (
                                    <button
                                        key={item.key}
                                        onClick={item.onClick}
                                        disabled={disabled || item.disabled}
                                        className={`w-full text-left px-2 py-2 text-sm rounded-md flex items-center justify-between transition-colors ${item.enabled ? 'text-[var(--theme-text-link)] bg-blue-500/5' : 'text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)]'} disabled:opacity-40`}
                                        role="menuitem"
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className={item.enabled ? 'text-[var(--theme-text-link)]' : 'text-[var(--theme-text-secondary)]'}>{item.icon}</span>
                                            <span className="font-medium">{item.label}</span>
                                        </div>
                                        {item.enabled && <Check size={15} className="text-[var(--theme-text-link)]" strokeWidth={2} />}
                                    </button>
                                ))}
                            </div>
                            {builtinControlsDisabled && (
                                <div className="mt-2 text-[11px] text-[var(--theme-text-tertiary)]">
                                    Built-in tools are disabled while custom tools are active.
                                </div>
                            )}
                        </div>

                        <div className="px-4 pt-2 pb-1">
                            <div className="text-xs uppercase tracking-wide text-[var(--theme-text-tertiary)] mb-1.5 flex items-center gap-1.5">
                                <PlugZap size={12} />
                                MCP Servers
                            </div>

                            {!isMcpEnabled && (
                                <div className="text-xs text-[var(--theme-text-tertiary)] py-1">MCP is disabled on backend.</div>
                            )}

                            {isMcpStatusLoading && (
                                <div className="text-xs text-[var(--theme-text-tertiary)] py-1">Checking MCP status...</div>
                            )}

                            {mcpStatusError && (
                                <div className="text-xs text-[var(--theme-text-danger)] py-1">{mcpStatusError}</div>
                            )}

                            {isMcpEnabled && !isMcpStatusLoading && visibleMcpServers.length === 0 && !mcpStatusError && (
                                <div className="text-xs text-[var(--theme-text-tertiary)] py-1">No MCP servers configured.</div>
                            )}

                            {visibleMcpServers.length > 0 && (
                                <div className="space-y-1 max-h-40 overflow-auto custom-scrollbar pr-1">
                                    {visibleMcpServers.map((server) => {
                                        const selected = mcpServerIds.includes(server.id);
                                        const blocked = disabled || customControlsDisabled || !!mcpSelectionLocked || !server.available;
                                        return (
                                            <button
                                                key={server.id}
                                                type="button"
                                                onClick={() => handleToggleServer(server.id)}
                                                disabled={blocked}
                                                className={`w-full text-left px-2 py-2 rounded-md border transition-colors ${selected ? 'border-[var(--theme-border-focus)] bg-[var(--theme-bg-tertiary)]' : 'border-[var(--theme-border-secondary)]'} disabled:opacity-40`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <Wrench size={14} className="text-[var(--theme-text-secondary)]" />
                                                        <span className="text-sm font-medium truncate">{server.name}</span>
                                                    </div>
                                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${server.available ? 'text-green-600 bg-green-500/10' : 'text-amber-600 bg-amber-500/10'}`}>
                                                        {server.available ? 'available' : 'unavailable'}
                                                    </span>
                                                </div>
                                                <div className="mt-1 text-[11px] text-[var(--theme-text-tertiary)] truncate">
                                                    {server.statusMessage || server.id}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}

                            {customControlsDisabled && (
                                <div className="mt-2 text-[11px] text-[var(--theme-text-tertiary)]">
                                    Disable built-in tools first to select MCP servers.
                                </div>
                            )}
                        </div>
                    </div>,
                    targetWindow.document.body
                )}
            </div>

            {!isNativeAudioModel && effectiveMode === 'builtin' && isDeepSearchEnabled && (
                <ActiveToolBadge
                    label={t('deep_search_short')}
                    onRemove={onToggleDeepSearch}
                    removeAriaLabel="Disable Deep Search"
                    icon={<Telescope size={14} strokeWidth={2} />}
                />
            )}
            {!isNativeAudioModel && effectiveMode === 'builtin' && isGoogleSearchEnabled && (
                <ActiveToolBadge
                    label={t('web_search_short')}
                    onRemove={onToggleGoogleSearch}
                    removeAriaLabel="Disable Web Search"
                    icon={<Globe size={14} strokeWidth={2} />}
                />
            )}
            {!isNativeAudioModel && effectiveMode === 'builtin' && isCodeExecutionEnabled && (
                <ActiveToolBadge
                    label={t('code_execution_short')}
                    onRemove={onToggleCodeExecution}
                    removeAriaLabel="Disable Code Execution"
                    icon={<Terminal size={14} strokeWidth={2} />}
                />
            )}
            {!isNativeAudioModel && effectiveMode === 'builtin' && isUrlContextEnabled && (
                <ActiveToolBadge
                    label={t('url_context_short')}
                    onRemove={onToggleUrlContext}
                    removeAriaLabel="Disable URL Context"
                    icon={<Link size={14} strokeWidth={2} />}
                />
            )}
            {effectiveMode === 'custom' && mcpSelected && (
                <>
                    <div className="h-4 w-px bg-[var(--theme-border-secondary)] mx-1.5"></div>
                    <div className="text-xs px-2 py-1 rounded-full bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-secondary)] border border-[var(--theme-border-secondary)]">
                        MCP {mcpServerIds.length}
                    </div>
                </>
            )}
        </div>
    );
};
