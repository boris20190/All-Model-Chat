import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal, Check, Calculator, PlugZap, Wrench } from 'lucide-react';
import type { McpServerStatus } from '@all-model-chat/shared-api';
import { translations } from '../../../utils/appUtils';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { IconYoutube } from '../../icons/CustomIcons';
import { CHAT_INPUT_BUTTON_CLASS } from '../../../constants/appConstants';
import { useWindowContext } from '../../../contexts/WindowContext';

interface ToolsMenuProps {
  enabledMcpServerIds?: string[];
  onToggleMcpServer?: (serverId: string) => void;
  mcpServers?: McpServerStatus[];
  isMcpEnabled?: boolean;
  isMcpStatusLoading?: boolean;
  mcpStatusError?: string | null;
  onAddYouTubeVideo: () => void;
  onCountTokens: () => void;
  disabled: boolean;
  t: (key: keyof typeof translations) => string;
  isNativeAudioModel?: boolean;
}

const ActiveToolBadge: React.FC<{
  label: string;
}> = ({ label }) => {
  return (
    <>
      <div className="h-4 w-px bg-[var(--theme-border-secondary)] mx-1.5" />
      <div className="text-xs px-2 py-1 rounded-full bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-secondary)] border border-[var(--theme-border-secondary)]">
        {label}
      </div>
    </>
  );
};

export const ToolsMenu: React.FC<ToolsMenuProps> = ({
  enabledMcpServerIds,
  onToggleMcpServer,
  mcpServers,
  isMcpEnabled,
  isMcpStatusLoading,
  mcpStatusError,
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

  const selectedServerIds = Array.isArray(enabledMcpServerIds) ? enabledMcpServerIds : [];
  const visibleMcpServers = Array.isArray(mcpServers) ? mcpServers : [];

  const actionItems = [
    {
      key: 'attachMenu_addByUrl',
      label: t('attachMenu_addByUrl' as any),
      icon: <IconYoutube size={18} strokeWidth={2} />,
      onClick: () => {
        onAddYouTubeVideo();
        setIsOpen(false);
      },
    },
    {
      key: 'tools_token_count_label',
      label: t('tools_token_count_label' as any),
      icon: <Calculator size={18} strokeWidth={2} />,
      onClick: () => {
        onCountTokens();
        setIsOpen(false);
      },
    },
  ];

  const filteredItems = actionItems.filter(() => !isNativeAudioModel);

  return (
    <div className="flex items-center">
      <div className="relative" ref={containerRef}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          disabled={disabled}
          className={`${CHAT_INPUT_BUTTON_CLASS} text-[var(--theme-icon-attach)] ${
            isOpen
              ? 'bg-[var(--theme-bg-tertiary)] text-[var(--theme-text-primary)]'
              : 'bg-transparent hover:bg-[var(--theme-bg-tertiary)]'
          }`}
          aria-label={t('tools_button')}
          title={t('tools_button')}
          aria-haspopup="true"
          aria-expanded={isOpen}
        >
          <SlidersHorizontal size={20} strokeWidth={2} />
        </button>

        {isOpen &&
          targetWindow &&
          createPortal(
            <div
              ref={menuRef}
              className="fixed w-80 bg-[var(--theme-bg-primary)] border border-[var(--theme-border-secondary)] rounded-xl shadow-premium py-2 animate-in fade-in zoom-in-95 duration-100 custom-scrollbar"
              style={menuPosition}
              role="menu"
            >
              <div className="px-4 py-2 border-b border-[var(--theme-border-secondary)]">
                <div className="text-xs uppercase tracking-wide text-[var(--theme-text-tertiary)] mb-1.5">
                  Utilities
                </div>
                <div className="space-y-1">
                  {filteredItems.map((item) => (
                    <button
                      key={item.key}
                      onClick={item.onClick}
                      disabled={disabled}
                      className="w-full text-left px-2 py-2 text-sm rounded-md flex items-center justify-between transition-colors text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-tertiary)] disabled:opacity-40"
                      role="menuitem"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-[var(--theme-text-secondary)]">{item.icon}</span>
                        <span className="font-medium">{item.label}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-4 pt-2 pb-1">
                <div className="text-xs uppercase tracking-wide text-[var(--theme-text-tertiary)] mb-1.5 flex items-center gap-1.5">
                  <PlugZap size={12} />
                  MCP Servers
                </div>

                {!isMcpEnabled && (
                  <div className="text-xs text-[var(--theme-text-tertiary)] py-1">
                    MCP is disabled on backend.
                  </div>
                )}

                {isMcpStatusLoading && (
                  <div className="text-xs text-[var(--theme-text-tertiary)] py-1">
                    Checking MCP status...
                  </div>
                )}

                {mcpStatusError && (
                  <div className="text-xs text-[var(--theme-text-danger)] py-1">{mcpStatusError}</div>
                )}

                {isMcpEnabled &&
                  !isMcpStatusLoading &&
                  visibleMcpServers.length === 0 &&
                  !mcpStatusError && (
                    <div className="text-xs text-[var(--theme-text-tertiary)] py-1">
                      No MCP servers configured.
                    </div>
                  )}

                {visibleMcpServers.length > 0 && (
                  <div className="space-y-1 max-h-40 overflow-auto custom-scrollbar pr-1">
                    {visibleMcpServers.map((server) => {
                      const selected = selectedServerIds.includes(server.id);
                      const attachable = server.attachable ?? server.available;
                      const blocked = disabled || !attachable;
                      return (
                        <button
                          key={server.id}
                          type="button"
                          onClick={() => onToggleMcpServer?.(server.id)}
                          disabled={blocked}
                          className={`w-full text-left px-2 py-2 rounded-md border transition-colors text-[var(--theme-text-primary)] ${
                            selected
                              ? 'border-[var(--theme-border-focus)] bg-[var(--theme-bg-tertiary)]'
                              : 'border-[var(--theme-border-secondary)]'
                          } disabled:opacity-40`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <Wrench size={14} className="text-[var(--theme-text-secondary)]" />
                              <span className="text-sm font-medium truncate">{server.name}</span>
                            </div>
                            {selected && (
                              <Check size={14} className="text-[var(--theme-text-link)]" />
                            )}
                          </div>
                          <div className="mt-1 text-[11px] text-[var(--theme-text-tertiary)] truncate">
                            {`${server.statusMessage || server.id}${server.protocolVersion ? ` • protocol=${server.protocolVersion}` : ''}${typeof server.toolCount === 'number' ? ` • tools=${server.toolCount}` : ''}`}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>,
            targetWindow.document.body
          )}
      </div>

      {selectedServerIds.length > 0 && <ActiveToolBadge label={`MCP ${selectedServerIds.length}`} />}
    </div>
  );
};
