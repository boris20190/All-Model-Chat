import test from 'node:test';
import assert from 'node:assert/strict';

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { visit } from 'unist-util-visit';

import { remarkGroundingCitations } from '../../utils/remarkGroundingCitations.ts';
import {
  __resetGroundingCitationLogCacheForTests,
  reportGroundingCitationDiagnostics,
} from '../../utils/groundingCitationLogging.ts';

const toByteEndIndex = (text, marker) => {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error(`Marker not found in text: ${marker}`);
  }

  const endCharIndex = markerIndex + marker.length;
  return new TextEncoder().encode(text.slice(0, endCharIndex)).length;
};

const createMetadata = (text, marker, chunkIndices = [0]) => {
  return {
    groundingSupports: [
      {
        segment: {
          endIndex: toByteEndIndex(text, marker),
        },
        groundingChunkIndices: chunkIndices,
      },
    ],
    groundingChunks: [{ web: { uri: 'https://example.com/a', title: 'example.com' } }],
    citations: [{ uri: 'https://example.com/b', title: 'backup.example.com' }],
  };
};

const applyPlugin = (text, metadata) => {
  const tree = unified().use(remarkParse).parse(text);
  let diagnostics = null;

  const transformer = remarkGroundingCitations({
    rawText: text,
    groundingMetadata: metadata,
    onDiagnostics: (payload) => {
      diagnostics = payload;
    },
  });

  transformer(tree);
  return { tree, diagnostics };
};

const collectCitationLinks = (tree) => {
  const links = [];
  visit(tree, 'link', (node) => {
    const className = node?.data?.hProperties?.className;
    if (!Array.isArray(className) || !className.includes('citation-ref')) return;
    links.push(node);
  });
  return links;
};

test('inserts citation link into plain paragraph text', () => {
  const text = 'Install zed-cn-bin with paru.';
  const metadata = createMetadata(text, 'zed-cn-bin');
  const { tree, diagnostics } = applyPlugin(text, metadata);
  const links = collectCitationLinks(tree);

  assert.equal(links.length, 1);
  assert.equal(links[0].url, 'https://example.com/a');
  assert.equal(links[0].children[0].value, '[1]');
  assert.equal(diagnostics.insertedCount, 1);
  assert.equal(diagnostics.skippedCount, 0);
});

test('does not insert citations inside triple-backtick fenced code blocks', () => {
  const text = ['```bash', 'paru -S zed-cn-bin', '```'].join('\n');
  const metadata = createMetadata(text, 'zed-cn-bin');
  const { tree, diagnostics } = applyPlugin(text, metadata);
  const links = collectCitationLinks(tree);

  assert.equal(links.length, 0);
  assert.equal(diagnostics.insertedCount, 0);
  assert.equal(diagnostics.reasonCounts.disallowed_context, 1);
});

test('does not insert citations inside tilde fenced code blocks', () => {
  const text = ['~~~yaml', 'import_tables:', '  - cn_dicts/8105', '~~~'].join('\n');
  const metadata = createMetadata(text, 'cn_dicts/8105');
  const { tree, diagnostics } = applyPlugin(text, metadata);
  const links = collectCitationLinks(tree);

  assert.equal(links.length, 0);
  assert.equal(diagnostics.insertedCount, 0);
  assert.equal(diagnostics.reasonCounts.disallowed_context, 1);
});

test('does not insert citations inside inline code and link nodes', () => {
  const inlineCodeText = 'Run `npm run build` before deploy.';
  const inlineCodeMetadata = createMetadata(inlineCodeText, 'run build');
  const inlineResult = applyPlugin(inlineCodeText, inlineCodeMetadata);
  assert.equal(collectCitationLinks(inlineResult.tree).length, 0);
  assert.equal(inlineResult.diagnostics.reasonCounts.disallowed_context, 1);

  const linkText = '[Zed docs](https://zed.dev) are here.';
  const linkMetadata = createMetadata(linkText, 'Zed docs');
  const linkResult = applyPlugin(linkText, linkMetadata);
  assert.equal(collectCitationLinks(linkResult.tree).length, 0);
  assert.equal(linkResult.diagnostics.reasonCounts.disallowed_context, 1);
});

test('does not insert citation on closing fence boundary (prevents ```<a...>)', () => {
  const text = ['Example', '```bash', 'paru -S zed-cn-bin', '```', 'Done'].join('\n');
  const closingFenceIndex = text.lastIndexOf('```');
  const byteEndIndex = new TextEncoder().encode(text.slice(0, closingFenceIndex + 3)).length;

  const metadata = {
    groundingSupports: [{ segment: { endIndex: byteEndIndex }, groundingChunkIndices: [0] }],
    groundingChunks: [{ web: { uri: 'https://example.com/a', title: 'example.com' } }],
    citations: [],
  };

  const { tree, diagnostics } = applyPlugin(text, metadata);
  assert.equal(collectCitationLinks(tree).length, 0);
  assert.equal(diagnostics.reasonCounts.disallowed_context, 1);
});

test('records unmapped offset diagnostics when segment end is out of range', () => {
  const text = 'Short text.';
  const metadata = {
    groundingSupports: [{ segment: { endIndex: 99999 }, groundingChunkIndices: [0] }],
    groundingChunks: [{ web: { uri: 'https://example.com/a', title: 'example.com' } }],
    citations: [],
  };

  const { diagnostics } = applyPlugin(text, metadata);
  assert.equal(diagnostics.insertedCount, 0);
  assert.equal(diagnostics.reasonCounts.unmapped_offset, 1);
});

test('dedupes repeated final diagnostics logging by message and reason signature', () => {
  __resetGroundingCitationLogCacheForTests();

  const captured = [];
  const fakeLogger = {
    warn: (message, options) => {
      captured.push({ message, options });
    },
  };

  const payload = {
    messageId: 'msg-1',
    isFinalChunk: true,
    insertedCount: 2,
    skippedCount: 1,
    skipReasons: ['unmapped_offset'],
    reasonCounts: { unmapped_offset: 1 },
  };

  reportGroundingCitationDiagnostics(payload, fakeLogger);
  reportGroundingCitationDiagnostics(payload, fakeLogger);
  reportGroundingCitationDiagnostics(
    {
      ...payload,
      reasonCounts: { disallowed_context: 1 },
      skipReasons: ['disallowed_context'],
    },
    fakeLogger
  );

  assert.equal(captured.length, 2);
});
