import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTranscribeConfig } from './generation.js';

test('buildTranscribeConfig does not use MINIMAL for Gemini 3.1 Pro Preview', () => {
  const config = buildTranscribeConfig('gemini-3.1-pro-preview');
  const thinkingConfig = (config.thinkingConfig || {}) as Record<string, unknown>;

  assert.equal(thinkingConfig.thinkingLevel, 'LOW');
  assert.notEqual(thinkingConfig.thinkingLevel, 'MINIMAL');
});

test('buildTranscribeConfig keeps MINIMAL for Gemini 3 Flash transcription', () => {
  const config = buildTranscribeConfig('models/gemini-3-flash-preview');
  const thinkingConfig = (config.thinkingConfig || {}) as Record<string, unknown>;

  assert.equal(thinkingConfig.thinkingLevel, 'MINIMAL');
});

test('buildTranscribeConfig treats models/ and bare IDs consistently for Gemini 2.5 Pro', () => {
  const bareConfig = buildTranscribeConfig('gemini-2.5-pro');
  const prefixedConfig = buildTranscribeConfig('models/gemini-2.5-pro');

  const bareThinkingConfig = (bareConfig.thinkingConfig || {}) as Record<string, unknown>;
  const prefixedThinkingConfig = (prefixedConfig.thinkingConfig || {}) as Record<string, unknown>;

  assert.equal(bareThinkingConfig.thinkingBudget, 128);
  assert.equal(prefixedThinkingConfig.thinkingBudget, 128);
});
