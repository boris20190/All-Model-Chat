export const MAX_TOOL_ROUNDS = 8;

export const createRollingHistory = (historyForChat, finalRole, finalParts) => {
    const rollingHistory = [...historyForChat];
    if (Array.isArray(finalParts) && finalParts.length > 0) {
        rollingHistory.push({
            role: finalRole,
            parts: [...finalParts],
        });
    }
    return rollingHistory;
};

export const extractThoughtSignature = (functionCallPart) => {
    if (!functionCallPart || typeof functionCallPart !== 'object') return undefined;
    const anyPart = functionCallPart;
    return (
        anyPart.thoughtSignature ||
        anyPart.thought_signature ||
        anyPart.functionCall?.thoughtSignature ||
        anyPart.functionCall?.thought_signature
    );
};

export const appendToolRoundToHistory = (
    rollingHistory,
    functionCallPart,
    functionName,
    functionResponseContent
) => {
    rollingHistory.push({
        role: 'model',
        parts: [functionCallPart],
    });
    rollingHistory.push({
        role: 'user',
        parts: [{
            functionResponse: {
                name: functionName,
                response: { content: functionResponseContent },
            },
        }],
    });
    return rollingHistory;
};
