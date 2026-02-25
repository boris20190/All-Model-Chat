
import { GoogleGenAI, Modality } from "@google/genai";
import { logService } from "../logService";
import { dbService } from '../../utils/db';
import { SafetySetting, MediaResolution } from "../../types/settings";
import {
    isGemini3Model,
    normalizeModelIdForComparison,
    normalizeThinkingLevelForModel,
    sanitizeApiKey
} from "../../utils/appUtils";


const POLLING_INTERVAL_MS = 2000; // 2 seconds
const MAX_POLLING_DURATION_MS = 10 * 60 * 1000; // 10 minutes

export { POLLING_INTERVAL_MS, MAX_POLLING_DURATION_MS };

export const getClient = (apiKey: string, baseUrl?: string | null, httpOptions?: any): GoogleGenAI => {
    try {
        // Normalize key text copied from rich editors (smart quotes / zero-width chars).
        const sanitizedApiKey = sanitizeApiKey(apiKey);

        if (apiKey !== sanitizedApiKey) {
            logService.warn("API key was sanitized before request.");
        }

        const config: any = { apiKey: sanitizedApiKey };

        // Use the SDK's native baseUrl support if provided.
        // This is more robust than the network interceptor for SDK-generated requests.
        if (baseUrl && baseUrl.trim().length > 0) {
            // Remove trailing slash for consistency
            config.baseUrl = baseUrl.trim().replace(/\/$/, '');
        }

        if (httpOptions) {
            config.httpOptions = httpOptions;
        }

        return new GoogleGenAI(config);
    } catch (error) {
        logService.error("Failed to initialize GoogleGenAI client:", error);
        // Re-throw to be caught by the calling function
        throw error;
    }
};

export const getApiClient = (apiKey?: string | null, baseUrl?: string | null, httpOptions?: any): GoogleGenAI => {
    if (!apiKey) {
        const silentError = new Error("API key is not configured in settings or provided.");
        silentError.name = "SilentError";
        throw silentError;
    }
    return getClient(apiKey, baseUrl, httpOptions);
};

/**
 * Async helper to get an API client with settings (proxy, etc) loaded from DB.
 * Respects the `useApiProxy` toggle.
 */
export const getConfiguredApiClient = async (apiKey: string, httpOptions?: any): Promise<GoogleGenAI> => {
    const settings = await dbService.getAppSettings();

    // Only use the proxy URL if Custom Config AND Use Proxy are both enabled
    // Explicitly check for truthiness to handle undefined/null
    const shouldUseProxy = !!(settings?.useCustomApiConfig && settings?.useApiProxy);
    const apiProxyUrl = shouldUseProxy ? settings?.apiProxyUrl : null;

    if (settings?.useCustomApiConfig && !shouldUseProxy) {
        // Debugging aid: if user expects proxy but it's not active
        if (settings?.apiProxyUrl && !settings?.useApiProxy) {
            logService.debug("[API Config] Proxy URL present but 'Use API Proxy' toggle is OFF.");
        }
    }

    return getClient(apiKey, apiProxyUrl, httpOptions);
};

export const buildGenerationConfig = (
    modelId: string,
    systemInstruction: string,
    config: { temperature?: number; topP?: number },
    showThoughts: boolean,
    thinkingBudget: number,
    thinkingLevel?: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH',
    aspectRatio?: string,
    imageSize?: string,
    safetySettings?: SafetySetting[],
    mediaResolution?: MediaResolution,
    /** ASCII tree of project files for agentic folder access */
    projectContextTree?: string,
): any => {
    void showThoughts;
    void projectContextTree;

    if (modelId === 'gemini-2.5-flash-image-preview' || modelId === 'gemini-2.5-flash-image') {
        const imageConfig: any = {};
        if (aspectRatio && aspectRatio !== 'Auto') imageConfig.aspectRatio = aspectRatio;

        const config: any = {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        };
        if (Object.keys(imageConfig).length > 0) {
            config.imageConfig = imageConfig;
        }
        return config;
    }

    if (modelId === 'gemini-3-pro-image-preview') {
        const imageConfig: any = {
            imageSize: imageSize || '1K',
        };
        if (aspectRatio && aspectRatio !== 'Auto') {
            imageConfig.aspectRatio = aspectRatio;
        }

        const config: any = {
            responseModalities: ['IMAGE', 'TEXT'],
            imageConfig,
        };

        if (systemInstruction) config.systemInstruction = systemInstruction;

        return config;
    }

    const generationConfig: any = {
        ...config,
        systemInstruction: systemInstruction || undefined,
        safetySettings: safetySettings || undefined,
    };

    // Check if model is Gemini 3. If so, prefer per-part media resolution (handled in content construction),
    // but we can omit the global config to avoid conflict, or set it if per-part isn't used.
    // However, if we are NOT Gemini 3, we MUST use global config.
    const isGemini3 = isGemini3Model(modelId);
    // Gemma models do not support media resolution at all
    const isGemma = modelId.toLowerCase().includes('gemma');

    if (!isGemini3 && !isGemma && mediaResolution) {
        // For non-Gemini 3 models (and not Gemma), apply global resolution if specified
        generationConfig.mediaResolution = mediaResolution;
    }
    // Note: For Gemini 3, we don't set global mediaResolution here because we inject it into parts in `buildContentParts`.
    // The API documentation says per-part overrides global, but to be clean/explicit as requested ("become Per-part"), 
    // we skip global for G3.

    if (!generationConfig.systemInstruction) {
        delete generationConfig.systemInstruction;
    }

    const compatibleThinkingLevel = normalizeThinkingLevelForModel(modelId, thinkingLevel);
    if (thinkingLevel && compatibleThinkingLevel && thinkingLevel !== compatibleThinkingLevel) {
        logService.warn(
            `Adjusted incompatible thinkingLevel from ${thinkingLevel} to ${compatibleThinkingLevel} for model ${modelId}.`
        );
    }

    // Robust check for Gemini 3
    if (isGemini3) {
        generationConfig.thinkingConfig = {
            includeThoughts: true, // Always capture thoughts in data; UI toggles visibility
        };

        const normalizedModelId = normalizeModelIdForComparison(modelId);
        const isGemini31ProPreview = normalizedModelId.includes('gemini-3.1-pro-preview');

        if (isGemini31ProPreview) {
            generationConfig.thinkingConfig.thinkingLevel = compatibleThinkingLevel || 'HIGH';
        } else if (thinkingBudget > 0) {
            generationConfig.thinkingConfig.thinkingBudget = thinkingBudget;
        } else {
            generationConfig.thinkingConfig.thinkingLevel = compatibleThinkingLevel || 'HIGH';
        }
    } else {
        const modelSupportsThinking = [
            'gemini-2.5-pro',
        ].includes(modelId) || modelId.includes('gemini-2.5');

        if (modelSupportsThinking) {
            // Decouple thinking budget from showing thoughts.
            // `thinkingBudget` controls if and how much the model thinks.
            // `includeThoughts` controls if the `thought` field is returned in the stream.
            generationConfig.thinkingConfig = {
                thinkingBudget: thinkingBudget,
                includeThoughts: true, // Always capture thoughts in data; UI toggles visibility
            };
        }
    }

    return generationConfig;
};
