import type { LogCategory } from '../services/logService';
import type { GroundingCitationDiagnostics } from './remarkGroundingCitations';

interface WarnLogger {
  warn: (message: string, options?: { category?: LogCategory; data?: unknown } | unknown) => void;
}

export interface GroundingCitationLogPayload extends GroundingCitationDiagnostics {
  messageId?: string;
  isFinalChunk?: boolean;
}

const MAX_DIAGNOSTIC_CACHE_KEYS = 2000;
const diagnosticCacheQueue: string[] = [];
const diagnosticCacheSet = new Set<string>();

const pushDiagnosticCacheKey = (key: string): void => {
  if (diagnosticCacheSet.has(key)) return;

  diagnosticCacheSet.add(key);
  diagnosticCacheQueue.push(key);

  if (diagnosticCacheQueue.length <= MAX_DIAGNOSTIC_CACHE_KEYS) return;

  const evicted = diagnosticCacheQueue.shift();
  if (!evicted) return;
  diagnosticCacheSet.delete(evicted);
};

const buildReasonSignature = (reasonCounts: Record<string, number>): string => {
  return Object.keys(reasonCounts)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${key}:${String(reasonCounts[key])}`)
    .join('|');
};

const normalizeReasonCounts = (raw: Record<string, number> | undefined): Record<string, number> => {
  if (!raw || typeof raw !== 'object') return {};
  const normalized: Record<string, number> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (!key || !Number.isFinite(value) || value <= 0) continue;
    normalized[key] = Math.floor(value);
  }

  return normalized;
};

export const reportGroundingCitationDiagnostics = (
  payload: GroundingCitationLogPayload,
  logger?: WarnLogger
): void => {
  if (!payload?.isFinalChunk) return;
  if (!Number.isFinite(payload.skippedCount) || payload.skippedCount <= 0) return;

  const messageId = typeof payload.messageId === 'string' ? payload.messageId : 'unknown-message';
  const insertedCount = Number.isFinite(payload.insertedCount) ? Math.floor(payload.insertedCount) : 0;
  const skippedCount = Math.floor(payload.skippedCount);
  const reasonCounts = normalizeReasonCounts(payload.reasonCounts);
  const reasonSignature = buildReasonSignature(reasonCounts);

  const dedupeKey = `${messageId}|inserted=${String(insertedCount)}|skipped=${String(
    skippedCount
  )}|reasons=${reasonSignature}`;

  if (diagnosticCacheSet.has(dedupeKey)) return;
  pushDiagnosticCacheKey(dedupeKey);

  const data = {
    messageId,
    insertedCount,
    skippedCount,
    reasonCounts,
    skipReasons: Array.isArray(payload.skipReasons) ? payload.skipReasons.slice(0, 5) : [],
  };

  logger?.warn('Grounding citation AST insertion skipped some supports.', {
    category: 'MODEL',
    data,
  });

  console.warn('[GroundingCitation] AST insertion skipped some supports.', data);
};

export const __resetGroundingCitationLogCacheForTests = (): void => {
  diagnosticCacheQueue.length = 0;
  diagnosticCacheSet.clear();
};
