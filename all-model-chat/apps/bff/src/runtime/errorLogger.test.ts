import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RuntimeErrorLogger } from './errorLogger.js';

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

test('RuntimeErrorLogger writes only when enabled and redacts sensitive keys', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'runtime-error-logger-test-'));
  const logPath = path.join(tempDir, 'runtime-errors.log');

  try {
    const logger = new RuntimeErrorLogger({
      enabled: false,
      logPath,
      maxBytes: 1024,
      maxFiles: 5,
    });

    await logger.logError('test.disabled', new Error('disabled write'), {
      apiKey: 'secret',
    });
    assert.equal(await fileExists(logPath), false);

    logger.setEnabled(true);
    await logger.logError('test.enabled', new Error('enabled write'), {
      apiKey: 'secret-key',
      nested: {
        authorization: 'Bearer token',
        regular: 'ok',
      },
    });

    assert.equal(await fileExists(logPath), true);
    const content = await readFile(logPath, 'utf8');
    assert.equal(content.includes('enabled write'), true);
    assert.equal(content.includes('[redacted]'), true);
    assert.equal(content.includes('secret-key'), false);
    assert.equal(content.includes('Bearer token'), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('RuntimeErrorLogger rotates files by size', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'runtime-error-logger-test-'));
  const logPath = path.join(tempDir, 'runtime-errors.log');

  try {
    const logger = new RuntimeErrorLogger({
      enabled: true,
      logPath,
      maxBytes: 220,
      maxFiles: 2,
    });

    for (let index = 0; index < 10; index += 1) {
      await logger.logError('test.rotation', new Error(`rotation-${index}`), {
        requestId: `r-${index}`,
      });
    }

    assert.equal(await fileExists(logPath), true);
    assert.equal(await fileExists(`${logPath}.1`), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
