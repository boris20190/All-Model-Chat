import type {
  ChatStreamCompleteDiagnostics,
  ChatStreamRequestPayload,
  ChatToolMode,
} from '@all-model-chat/shared-api';

type WebGroundingDiagnostics = NonNullable<ChatStreamCompleteDiagnostics['webGrounding']>;
type WebGroundingEvidence = NonNullable<WebGroundingDiagnostics['evidence']>;
type WebGroundingPolicy = NonNullable<WebGroundingDiagnostics['policy']>;
type WebGroundingReason = NonNullable<WebGroundingDiagnostics['reason']>;

interface ResolveWebGroundingRequirementParams {
  payload: ChatStreamRequestPayload;
  finalToolMode: ChatToolMode;
  normalizedTools: unknown[];
}

interface CollectWebGroundingEvidenceParams {
  groundingMetadata: unknown;
  urlContextMetadata: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const toArray = (value: unknown): unknown[] => {
  return Array.isArray(value) ? value : [];
};

const hasGoogleSearchTool = (tool: unknown): boolean => {
  if (!isObject(tool)) return false;
  return 'googleSearch' in tool || 'google_search' in tool;
};

export const resolveWebGroundingRequirement = ({
  payload,
  finalToolMode,
  normalizedTools,
}: ResolveWebGroundingRequirementParams): {
  required: boolean;
  policy: WebGroundingPolicy;
} => {
  const requested = payload.webGrounding;
  const requestedPolicy =
    requested?.policy === 'off' || requested?.policy === 'warn' ? requested.policy : undefined;

  const derivedRequired =
    finalToolMode === 'builtin' && normalizedTools.some((tool) => hasGoogleSearchTool(tool));

  const required = typeof requested?.required === 'boolean' ? requested.required : derivedRequired;
  const policy = requestedPolicy ?? 'warn';

  return {
    required,
    policy,
  };
};

export const collectWebGroundingEvidence = ({
  groundingMetadata,
  urlContextMetadata,
}: CollectWebGroundingEvidenceParams): WebGroundingEvidence => {
  const grounding = isObject(groundingMetadata) ? groundingMetadata : {};
  const urlContext = isObject(urlContextMetadata) ? urlContextMetadata : {};

  const webSearchQueries = toArray(
    grounding.webSearchQueries ?? grounding.web_search_queries
  ).length;

  const groundingChunks = toArray(grounding.groundingChunks ?? grounding.grounding_chunks);
  const webGroundingChunks = groundingChunks.reduce<number>((count, chunk) => {
    if (!isObject(chunk)) return count;
    const web = isObject(chunk.web) ? chunk.web : {};
    const uri = typeof web.uri === 'string' ? web.uri.trim() : '';
    const title = typeof web.title === 'string' ? web.title.trim() : '';
    return uri || title ? count + 1 : count;
  }, 0);

  const citations = toArray(grounding.citations).length;

  const urlMetadata = toArray(urlContext.urlMetadata ?? urlContext.url_metadata);
  const urlContextUrls = urlMetadata.reduce<number>((count, item) => {
    if (!isObject(item)) return count;
    const url =
      typeof item.retrievedUrl === 'string'
        ? item.retrievedUrl.trim()
        : typeof item.retrieved_url === 'string'
          ? item.retrieved_url.trim()
          : '';
    return url ? count + 1 : count;
  }, 0);

  return {
    webSearchQueries,
    webGroundingChunks,
    citations,
    urlContextUrls,
  };
};

export const buildWebGroundingDiagnostics = ({
  required,
  policy,
  evidence,
}: {
  required: boolean;
  policy: WebGroundingPolicy;
  evidence: WebGroundingEvidence;
}): WebGroundingDiagnostics => {
  const webSearchQueries = evidence.webSearchQueries ?? 0;
  const webGroundingChunks = evidence.webGroundingChunks ?? 0;
  const satisfied = webSearchQueries > 0 || webGroundingChunks > 0;

  let reason: WebGroundingReason;
  if (!required) {
    reason = 'not_required';
  } else if (policy === 'off') {
    reason = 'policy_off';
  } else {
    reason = satisfied ? 'search_evidence_found' : 'search_evidence_missing';
  }

  return {
    required,
    policy,
    satisfied,
    reason,
    evidence,
  };
};
