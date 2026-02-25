import type { ChatSettings } from '../types';

export declare const hasMcpToolsSelected: (
  settings: Partial<ChatSettings> | null | undefined
) => boolean;
export declare const toggleServerSelection: (
  currentServerIds: string[] | undefined,
  targetServerId: string
) => string[];
