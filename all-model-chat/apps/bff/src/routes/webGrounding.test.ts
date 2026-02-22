import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWebGroundingDiagnostics,
  collectWebGroundingEvidence,
  resolveWebGroundingRequirement,
} from './webGrounding.js';

test('googleSearch enabled with webSearchQueries evidence is satisfied', () => {
  const requirement = resolveWebGroundingRequirement({
    payload: {
      model: 'gemini-3.1-pro-preview',
      history: [],
      parts: [{ text: 'hi' }],
      role: 'user',
    },
    finalToolMode: 'builtin',
    normalizedTools: [{ googleSearch: {} }],
  });

  assert.equal(requirement.required, true);
  assert.equal(requirement.policy, 'warn');

  const evidence = collectWebGroundingEvidence({
    groundingMetadata: {
      webSearchQueries: [{ searchQuery: 'latest gemini news' }],
    },
    urlContextMetadata: undefined,
  });

  const diagnostics = buildWebGroundingDiagnostics({
    required: requirement.required,
    policy: requirement.policy,
    evidence,
  });

  assert.equal(diagnostics.satisfied, true);
  assert.equal(diagnostics.reason, 'search_evidence_found');
});

test('only url context evidence is not treated as web search evidence', () => {
  const evidence = collectWebGroundingEvidence({
    groundingMetadata: undefined,
    urlContextMetadata: {
      urlMetadata: [{ retrievedUrl: 'https://example.com' }],
    },
  });

  const diagnostics = buildWebGroundingDiagnostics({
    required: true,
    policy: 'warn',
    evidence,
  });

  assert.equal(diagnostics.satisfied, false);
  assert.equal(diagnostics.reason, 'search_evidence_missing');
  assert.equal(diagnostics.evidence?.urlContextUrls, 1);
});

test('groundingChunks web entries satisfy evidence', () => {
  const evidence = collectWebGroundingEvidence({
    groundingMetadata: {
      groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
    },
    urlContextMetadata: undefined,
  });

  const diagnostics = buildWebGroundingDiagnostics({
    required: true,
    policy: 'warn',
    evidence,
  });

  assert.equal(diagnostics.satisfied, true);
  assert.equal(diagnostics.reason, 'search_evidence_found');
});

test('required=false always reports reason=not_required', () => {
  const evidence = collectWebGroundingEvidence({
    groundingMetadata: undefined,
    urlContextMetadata: undefined,
  });

  const diagnostics = buildWebGroundingDiagnostics({
    required: false,
    policy: 'warn',
    evidence,
  });

  assert.equal(diagnostics.reason, 'not_required');
});
