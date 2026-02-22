const isObjectRecord = (value) => typeof value === 'object' && value !== null;

const toNonNegativeInt = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return value >= 0 ? Math.trunc(value) : undefined;
};

const REASONS = new Set([
    'not_required',
    'policy_off',
    'search_evidence_found',
    'search_evidence_missing',
]);

export const normalizeWebGroundingDiagnostics = (value) => {
    if (!isObjectRecord(value)) return undefined;

    const required = typeof value.required === 'boolean' ? value.required : undefined;
    const policy = value.policy === 'off' || value.policy === 'warn' ? value.policy : undefined;
    const satisfied = typeof value.satisfied === 'boolean' ? value.satisfied : undefined;
    const reason = typeof value.reason === 'string' && REASONS.has(value.reason) ? value.reason : undefined;

    const evidenceSource = isObjectRecord(value.evidence) ? value.evidence : undefined;
    const evidence = evidenceSource
        ? {
            webSearchQueries: toNonNegativeInt(evidenceSource.webSearchQueries),
            webGroundingChunks: toNonNegativeInt(evidenceSource.webGroundingChunks),
            citations: toNonNegativeInt(evidenceSource.citations),
            urlContextUrls: toNonNegativeInt(evidenceSource.urlContextUrls),
        }
        : undefined;

    const hasEvidence = evidence
        && Object.values(evidence).some((entry) => typeof entry === 'number');

    const normalized = {
        required,
        policy,
        satisfied,
        reason,
        evidence: hasEvidence ? evidence : undefined,
    };

    const hasAnyField = Object.values(normalized).some((entry) => entry !== undefined);
    return hasAnyField ? normalized : undefined;
};
