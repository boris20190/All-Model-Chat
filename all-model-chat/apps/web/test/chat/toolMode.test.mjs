import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWebGroundingRequest,
  hasBuiltinToolsEnabled,
  hasMcpToolsSelected,
  resolveToolMode,
  toggleServerSelection,
} from '../../utils/toolMode.js';

test('resolveToolMode returns builtin when any built-in tool is enabled', () => {
  const mode = resolveToolMode({
    toolMode: 'none',
    isGoogleSearchEnabled: true,
    isCodeExecutionEnabled: false,
    isUrlContextEnabled: false,
    isDeepSearchEnabled: false,
    enabledMcpServerIds: [],
  });

  assert.equal(mode, 'builtin');
});

test('resolveToolMode returns custom when MCP servers are selected', () => {
  const mode = resolveToolMode({
    toolMode: 'none',
    isGoogleSearchEnabled: false,
    isCodeExecutionEnabled: false,
    isUrlContextEnabled: false,
    isDeepSearchEnabled: false,
    enabledMcpServerIds: ['fs'],
  });

  assert.equal(mode, 'custom');
});

test('resolveToolMode keeps explicit custom mode without selected MCP servers', () => {
  const mode = resolveToolMode({
    toolMode: 'custom',
    isGoogleSearchEnabled: false,
    isCodeExecutionEnabled: false,
    isUrlContextEnabled: false,
    isDeepSearchEnabled: false,
    enabledMcpServerIds: [],
  });

  assert.equal(mode, 'custom');
});

test('toggleServerSelection adds and removes server ids deterministically', () => {
  const first = toggleServerSelection([], 'filesystem');
  assert.deepEqual(first, ['filesystem']);

  const second = toggleServerSelection(first, 'filesystem');
  assert.deepEqual(second, []);
});

test('helper booleans detect built-ins and MCP selections', () => {
  assert.equal(hasBuiltinToolsEnabled({ isCodeExecutionEnabled: true }), true);
  assert.equal(hasBuiltinToolsEnabled({}), false);

  assert.equal(hasMcpToolsSelected({ enabledMcpServerIds: ['a', ''] }), true);
  assert.equal(hasMcpToolsSelected({ enabledMcpServerIds: [] }), false);
});

test('buildWebGroundingRequest requires grounding only for builtin search mode', () => {
  const builtinSearch = buildWebGroundingRequest({
    toolMode: 'builtin',
    isGoogleSearchEnabled: true,
    isDeepSearchEnabled: false,
  });
  assert.deepEqual(builtinSearch, { required: true, policy: 'warn' });

  const customMode = buildWebGroundingRequest({
    toolMode: 'custom',
    isGoogleSearchEnabled: true,
    isDeepSearchEnabled: true,
  });
  assert.equal(customMode, undefined);
});
