export type RollingHistoryTurn = {
  role: 'user' | 'model';
  parts: any[];
};

export const MAX_TOOL_ROUNDS: number;

export const createRollingHistory: (
  historyForChat: RollingHistoryTurn[],
  finalRole: 'user' | 'model',
  finalParts: any[]
) => RollingHistoryTurn[];

export const extractThoughtSignature: (functionCallPart: unknown) => string | undefined;

export const appendToolRoundToHistory: (
  rollingHistory: RollingHistoryTurn[],
  functionCallPart: any,
  functionName: string,
  functionResponseContent: string
) => RollingHistoryTurn[];
