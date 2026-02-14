import test from 'node:test';
import assert from 'node:assert/strict';

import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkCjkFriendlyGfmStrikethrough from 'remark-cjk-friendly-gfm-strikethrough';
import { remarkPlugins } from '../../utils/markdownConfig.ts';

test('remark plugin chain includes cjk plugins and keeps required order', () => {
  const gfmIndex = remarkPlugins.indexOf(remarkGfm);
  const cjkIndex = remarkPlugins.indexOf(remarkCjkFriendly);
  const cjkStrikeIndex = remarkPlugins.indexOf(remarkCjkFriendlyGfmStrikethrough);

  assert.ok(gfmIndex >= 0, 'remark-gfm must be registered');
  assert.ok(cjkIndex >= 0, 'remark-cjk-friendly must be registered');
  assert.ok(cjkStrikeIndex >= 0, 'remark-cjk-friendly-gfm-strikethrough must be registered');

  assert.ok(gfmIndex < cjkIndex, 'remark-cjk-friendly should run after remark-gfm');
  assert.ok(
    gfmIndex < cjkStrikeIndex,
    'remark-cjk-friendly-gfm-strikethrough must run after remark-gfm'
  );
});
