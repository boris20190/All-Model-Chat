import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendToolRoundToHistory,
  createRollingHistory,
  extractThoughtSignature,
  MAX_TOOL_ROUNDS,
} from '../../hooks/message-sender/standard/toolCallHistory.js';

test('createRollingHistory appends the current turn onto base history', () => {
  const baseHistory = [{ role: 'user', parts: [{ text: 'hello' }] }];
  const rollingHistory = createRollingHistory(baseHistory, 'model', [{ text: 'prefill' }]);

  assert.equal(rollingHistory.length, 2);
  assert.deepEqual(rollingHistory[0], baseHistory[0]);
  assert.deepEqual(rollingHistory[1], { role: 'model', parts: [{ text: 'prefill' }] });
});

test('appendToolRoundToHistory keeps function call and response ordering', () => {
  const rollingHistory = createRollingHistory([], 'user', [{ text: 'start' }]);
  const functionCallPart = {
    functionCall: { name: 'read_file', args: { filepath: 'src/main.ts' } },
    thoughtSignature: 'sig-1',
  };

  appendToolRoundToHistory(rollingHistory, functionCallPart, 'read_file', 'file content');

  assert.equal(rollingHistory.length, 3);
  assert.equal(rollingHistory[1].role, 'model');
  assert.equal(rollingHistory[2].role, 'user');
  assert.deepEqual(rollingHistory[1].parts[0], functionCallPart);
  assert.equal(rollingHistory[2].parts[0].functionResponse.name, 'read_file');
  assert.equal(rollingHistory[2].parts[0].functionResponse.response.content, 'file content');
});

test('appendToolRoundToHistory supports multi-round accumulation', () => {
  const rollingHistory = createRollingHistory([], 'user', [{ text: 'start' }]);

  appendToolRoundToHistory(
    rollingHistory,
    { functionCall: { name: 'read_file', args: { filepath: 'a.ts' } }, thoughtSignature: 'sig-a' },
    'read_file',
    'content-a'
  );
  appendToolRoundToHistory(
    rollingHistory,
    { functionCall: { name: 'read_file', args: { filepath: 'b.ts' } }, thoughtSignature: 'sig-b' },
    'read_file',
    'content-b'
  );

  assert.equal(rollingHistory.length, 5);
  assert.equal(rollingHistory[1].role, 'model');
  assert.equal(rollingHistory[2].role, 'user');
  assert.equal(rollingHistory[3].role, 'model');
  assert.equal(rollingHistory[4].role, 'user');
  assert.equal(rollingHistory[4].parts[0].functionResponse.response.content, 'content-b');
});

test('extractThoughtSignature supports camelCase and snake_case fields', () => {
  assert.equal(
    extractThoughtSignature({ thoughtSignature: 'camel' }),
    'camel'
  );
  assert.equal(
    extractThoughtSignature({ thought_signature: 'snake' }),
    'snake'
  );
  assert.equal(
    extractThoughtSignature({ functionCall: { thought_signature: 'nested' } }),
    'nested'
  );
});

test('MAX_TOOL_ROUNDS is locked to 8', () => {
  assert.equal(MAX_TOOL_ROUNDS, 8);
});
