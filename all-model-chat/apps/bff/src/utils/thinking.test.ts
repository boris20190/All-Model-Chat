import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSafeThinkingConfigForTask,
  normalizeModelIdForComparison,
  normalizeThinkingLevelForModel,
} from './thinking.js';

test('normalizeModelIdForComparison handles models/ prefix equivalently', () => {
  assert.equal(normalizeModelIdForComparison('models/gemini-3.1-pro-preview'), 'gemini-3.1-pro-preview');
  assert.equal(normalizeModelIdForComparison('gemini-3.1-pro-preview'), 'gemini-3.1-pro-preview');
});

test('normalizeThinkingLevelForModel downgrades MINIMAL for Gemini 3.1 Pro variants', () => {
  assert.equal(normalizeThinkingLevelForModel('gemini-3.1-pro-preview', 'MINIMAL'), 'LOW');
  assert.equal(
    normalizeThinkingLevelForModel('models/gemini-3.1-pro-preview-customtools', 'MINIMAL'),
    'LOW'
  );
});

test('normalizeThinkingLevelForModel keeps MINIMAL for Gemini 3 Flash models', () => {
  assert.equal(normalizeThinkingLevelForModel('gemini-3-flash-preview', 'MINIMAL'), 'MINIMAL');
  assert.equal(normalizeThinkingLevelForModel('models/gemini-3-flash-preview', 'MINIMAL'), 'MINIMAL');
});

test('getSafeThinkingConfigForTask returns compatible config for transcribe task', () => {
  assert.deepEqual(
    getSafeThinkingConfigForTask({
      modelId: 'gemini-3.1-pro-preview',
      taskType: 'transcribe',
      requestedLevel: 'MINIMAL',
      includeThoughts: false,
    }),
    {
      includeThoughts: false,
      thinkingLevel: 'LOW',
    }
  );
});
