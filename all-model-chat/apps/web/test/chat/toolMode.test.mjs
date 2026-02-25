import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasMcpToolsSelected,
  toggleServerSelection,
} from '../../utils/toolMode.js';

test('hasMcpToolsSelected detects selected ids', () => {
  assert.equal(hasMcpToolsSelected({ enabledMcpServerIds: ['a', ''] }), true);
  assert.equal(hasMcpToolsSelected({ enabledMcpServerIds: [] }), false);
  assert.equal(hasMcpToolsSelected(undefined), false);
});

test('toggleServerSelection adds and removes server ids deterministically', () => {
  const first = toggleServerSelection([], 'filesystem');
  assert.deepEqual(first, ['filesystem']);

  const second = toggleServerSelection(first, 'filesystem');
  assert.deepEqual(second, []);
});
