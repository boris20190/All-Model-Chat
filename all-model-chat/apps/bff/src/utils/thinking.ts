export type ThinkingLevel = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';

export type ThinkingTaskType = 'chat' | 'transcribe' | 'generic';

export interface SafeThinkingConfigRequest {
  modelId: string;
  taskType?: ThinkingTaskType;
  requestedLevel?: ThinkingLevel;
  requestedBudget?: number;
  includeThoughts?: boolean;
}

export interface SafeThinkingConfig {
  includeThoughts?: boolean;
  thinkingLevel?: ThinkingLevel;
  thinkingBudget?: number;
}

export const normalizeModelIdForComparison = (modelId: string | undefined | null): string => {
  if (!modelId) return '';
  const normalized = modelId.trim().toLowerCase();
  return normalized.startsWith('models/') ? normalized.slice('models/'.length) : normalized;
};

export const isGemini3Model = (modelId: string): boolean => {
  const normalizedModelId = normalizeModelIdForComparison(modelId);
  return normalizedModelId.includes('gemini-3');
};

export const isGemini31ProModel = (modelId: string): boolean => {
  const normalizedModelId = normalizeModelIdForComparison(modelId);
  return (
    normalizedModelId.includes('gemini-3.1-pro-preview') ||
    normalizedModelId.includes('gemini-3.1-pro-preview-customtools')
  );
};

export const isGemini3FlashModel = (modelId: string): boolean => {
  const normalizedModelId = normalizeModelIdForComparison(modelId);
  return normalizedModelId.includes('gemini-3') && normalizedModelId.includes('flash');
};

export const normalizeThinkingLevelForModel = (
  modelId: string,
  thinkingLevel: ThinkingLevel | undefined
): ThinkingLevel | undefined => {
  if (!thinkingLevel) return thinkingLevel;

  if (thinkingLevel === 'MINIMAL') {
    if (isGemini31ProModel(modelId)) return 'LOW';
    if (isGemini3Model(modelId) && !isGemini3FlashModel(modelId)) return 'LOW';
    if (!isGemini3Model(modelId)) return 'LOW';
  }

  return thinkingLevel;
};

export const getSafeThinkingConfigForTask = (
  request: SafeThinkingConfigRequest
): SafeThinkingConfig | undefined => {
  const config: SafeThinkingConfig = {};

  if (typeof request.includeThoughts === 'boolean') {
    config.includeThoughts = request.includeThoughts;
  }

  const normalizedLevel = normalizeThinkingLevelForModel(request.modelId, request.requestedLevel);
  if (normalizedLevel) {
    config.thinkingLevel = normalizedLevel;
  }

  if (typeof request.requestedBudget === 'number' && !config.thinkingLevel) {
    config.thinkingBudget = request.requestedBudget;
  }

  if (request.taskType === 'transcribe' && isGemini3Model(request.modelId) && !config.thinkingLevel) {
    // Gemini 3 transcription should prefer thinking levels over budget for compatibility.
    config.thinkingLevel = 'LOW';
  }

  return Object.keys(config).length > 0 ? config : undefined;
};
