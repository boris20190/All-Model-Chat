import test from 'node:test';
import assert from 'node:assert/strict';

import {
  consumeSseStream,
  parseSseEventBlock,
  splitSseBuffer,
} from '../../services/api/sseStream.ts';

const createResponse = (rawText) => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(rawText));
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
    },
  });
};

test('parseSseEventBlock parses JSON payload and event name', () => {
  const parsed = parseSseEventBlock('event: meta\ndata: {"provider":"gemini"}\n');
  assert.equal(parsed?.eventName, 'meta');
  assert.deepEqual(parsed?.payload, { provider: 'gemini' });
});

test('splitSseBuffer supports CRLF separators', () => {
  const split = splitSseBuffer('event: meta\r\ndata: {"ok":true}\r\n\r\nrest');
  assert.ok(split);
  assert.equal(split?.rawBlock, 'event: meta\r\ndata: {"ok":true}');
  assert.equal(split?.rest, 'rest');
});

test('consumeSseStream parses CRLF-delimited SSE events', async () => {
  const response = createResponse(
    [
      'event: ready',
      'data: {"ok":true}',
      '',
      'event: meta',
      'data: {"provider":"gemini","keyId":"test"}',
      '',
      'event: complete',
      'data: {"diagnostics":{"hadCandidate":true}}',
      '',
    ].join('\r\n')
  );

  const events = [];
  const summary = await consumeSseStream(response, new AbortController().signal, (event) => {
    events.push(event);
  });

  assert.equal(summary.eventCount, 3);
  assert.equal(events[0].eventName, 'ready');
  assert.equal(events[1].eventName, 'meta');
  assert.equal(events[2].eventName, 'complete');
});

test('consumeSseStream returns trailing sample for non-SSE payload', async () => {
  const response = createResponse('<html><body>upstream gateway page</body></html>');
  const events = [];
  const summary = await consumeSseStream(response, new AbortController().signal, (event) => {
    events.push(event);
  });

  assert.equal(summary.eventCount, 0);
  assert.equal(events.length, 0);
  assert.match(summary.trailingTextSample || '', /gateway page/);
});
