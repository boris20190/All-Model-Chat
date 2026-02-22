import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeWebGroundingDiagnostics } from '../../utils/webGrounding.js';

test('normalizeWebGroundingDiagnostics parses valid diagnostics', () => {
  const parsed = normalizeWebGroundingDiagnostics({
    required: true,
    policy: 'warn',
    satisfied: false,
    reason: 'search_evidence_missing',
    evidence: {
      webSearchQueries: 0,
      webGroundingChunks: 0,
      citations: 2,
      urlContextUrls: 1,
    },
  });

  assert.deepEqual(parsed, {
    required: true,
    policy: 'warn',
    satisfied: false,
    reason: 'search_evidence_missing',
    evidence: {
      webSearchQueries: 0,
      webGroundingChunks: 0,
      citations: 2,
      urlContextUrls: 1,
    },
  });
});

test('normalizeWebGroundingDiagnostics ignores unsupported reason', () => {
  const parsed = normalizeWebGroundingDiagnostics({
    required: true,
    policy: 'warn',
    satisfied: true,
    reason: 'unknown_reason',
  });

  assert.equal(parsed?.reason, undefined);
  assert.equal(parsed?.required, true);
});

test('normalizeWebGroundingDiagnostics returns undefined for invalid input', () => {
  assert.equal(normalizeWebGroundingDiagnostics(null), undefined);
  assert.equal(normalizeWebGroundingDiagnostics('bad'), undefined);
});
