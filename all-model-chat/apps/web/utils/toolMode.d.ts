import type { ChatToolMode } from '@all-model-chat/shared-api';
import type { ChatSettings } from '../types';

export declare const normalizeToolMode: (value: unknown) => ChatToolMode;
export declare const hasBuiltinToolsEnabled: (settings: Partial<ChatSettings> | null | undefined) => boolean;
export declare const hasMcpToolsSelected: (settings: Partial<ChatSettings> | null | undefined) => boolean;
export declare const resolveToolMode: (settings: Partial<ChatSettings> | null | undefined) => ChatToolMode;
export declare const isBuiltinModeActive: (settings: Partial<ChatSettings> | null | undefined) => boolean;
export declare const isCustomModeActive: (settings: Partial<ChatSettings> | null | undefined) => boolean;
export declare const shouldRequireWebGrounding: (settings: Partial<ChatSettings> | null | undefined) => boolean;
export declare const buildWebGroundingRequest: (
  settings: Partial<ChatSettings> | null | undefined,
  policy?: 'off' | 'warn'
) => { required: true; policy: 'off' | 'warn' } | undefined;
export declare const toggleServerSelection: (currentServerIds: string[] | undefined, targetServerId: string) => string[];
