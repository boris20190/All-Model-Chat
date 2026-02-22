import type { Part, UsageMetadata } from '@google/genai';
import type { AppLanguage, ChatRole } from '@all-model-chat/shared-types';

export interface ApiErrorPayload {
  code: string;
  message: string;
  status: number;
  retryable: boolean;
  providerStatus?: string;
  providerReason?: string;
  providerMessage?: string;
}

export interface BffErrorPayload {
  code?: string;
  message?: string;
  status?: number;
  retryable?: boolean;
  providerStatus?: string;
  providerReason?: string;
  providerMessage?: string;
}

export interface ChatHistoryTurn {
  role: ChatRole;
  parts: Part[];
}

export interface ChatStreamRequestPayload {
  model: string;
  history: ChatHistoryTurn[];
  parts: Part[];
  config?: unknown;
  role: ChatRole;
  apiKeyOverride?: string;
}

export interface ChatStreamMetaEventPayload {
  provider: 'gemini';
  keyId: string;
}

export interface ChatStreamPartEventPayload {
  part: Part;
}

export interface ChatStreamThoughtEventPayload {
  chunk: string;
}

export interface ChatStreamCompleteDiagnostics {
  finishReason?: string;
  finishMessage?: string;
  candidateSafetyRatings?: unknown[];
  promptFeedback?: {
    blockReason?: string;
    blockReasonMessage?: string;
    safetyRatings?: unknown[];
  };
  responseId?: string;
  modelVersion?: string;
  hadCandidate?: boolean;
  hadCandidateParts?: boolean;
  hadThoughtChunk?: boolean;
  streamMeta?: {
    provider?: string;
    keyId?: string;
  };
  streamError?: {
    code?: string;
    status?: number;
    retryable?: boolean;
    message?: string;
    providerStatus?: string;
    providerReason?: string;
    providerMessage?: string;
  };
}

export interface ChatStreamCompleteEventPayload {
  usageMetadata?: UsageMetadata;
  groundingMetadata?: unknown;
  urlContextMetadata?: unknown;
  functionCallPart?: Part;
  diagnostics?: ChatStreamCompleteDiagnostics;
}

export interface ChatStreamErrorEventPayload {
  error: ApiErrorPayload;
}

export interface ImageGenerationRequest {
  model: string;
  prompt: string;
  aspectRatio: string;
  imageSize?: string;
}

export interface ImageGenerationResponse {
  images: string[];
}

export interface SpeechGenerationRequest {
  model: string;
  text: string;
  voice: string;
}

export interface SpeechGenerationResponse {
  audioData: string;
}

export interface TranscribeAudioRequest {
  model: string;
  mimeType: string;
  audioBase64: string;
}

export interface TranscribeAudioResponse {
  text: string;
}

export interface TranslateRequest {
  text: string;
  targetLanguage?: string;
}

export interface TranslateResponse {
  text: string;
}

export interface TitleRequest {
  userContent: string;
  modelContent: string;
  language: AppLanguage;
}

export interface TitleResponse {
  title: string;
}

export interface SuggestionsRequest {
  userContent: string;
  modelContent: string;
  language: AppLanguage;
}

export interface SuggestionsResponse {
  suggestions: string[];
}

export interface CountTokensRequest {
  model: string;
  parts: Part[];
}

export interface CountTokensResponse {
  totalTokens: number;
}

export interface EditImageRequest {
  model: string;
  history: ChatHistoryTurn[];
  parts: Part[];
  aspectRatio?: string;
  imageSize?: string;
}

export interface EditImageResponse {
  parts: Part[];
}

export interface FileUploadResponse<TFile = unknown> {
  file: TFile;
}

export interface FileMetadataResponse<TFile = unknown> {
  file: TFile | null;
}

export interface FileListResponse<TFile = unknown> {
  files: TFile[];
  nextPageToken?: string;
}

export interface FileDeleteResponse {
  ok: boolean;
  name: string;
}
