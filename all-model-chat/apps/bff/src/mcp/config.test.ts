import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { BffConfig } from '../config/env.js';
import { loadMcpRuntimeConfig } from './config.js';

const createBaseConfig = (overrides: Partial<BffConfig>): BffConfig => ({
  host: '127.0.0.1',
  port: 8787,
  nodeEnv: 'test',
  serviceName: 'bff-test',
  providerApiKeys: ['test-key'],
  providerKeyFailureCooldownMs: 30000,
  providerUseVertexAi: false,
  providerBaseUrl: undefined,
  providerApiVersion: undefined,
  mcpEnabled: false,
  mcpConfigPath: undefined,
  ...overrides,
});

test('loadMcpRuntimeConfig parses valid stdio server config', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mcp-config-test-'));
  const configPath = path.join(tempDir, 'mcp.servers.json');

  try {
    await writeFile(
      configPath,
      JSON.stringify(
        {
          servers: [
            {
              id: 'filesystem',
              name: 'Filesystem MCP',
              transport: 'stdio',
              command: 'node',
              args: ['server.js'],
              enabled: true,
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    const runtime = await loadMcpRuntimeConfig(
      createBaseConfig({
        mcpEnabled: true,
        mcpConfigPath: configPath,
      })
    );

    assert.equal(runtime.enabled, true);
    assert.equal(runtime.servers.length, 1);
    assert.equal(runtime.servers[0].id, 'filesystem');
    assert.equal(runtime.servers[0].transport, 'stdio');
    assert.equal(runtime.warnings.length, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('loadMcpRuntimeConfig reports duplicate ids and invalid transport', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mcp-config-test-'));
  const configPath = path.join(tempDir, 'mcp.servers.json');

  try {
    await writeFile(
      configPath,
      JSON.stringify(
        {
          servers: [
            {
              id: 'dup',
              name: 'A',
              transport: 'stdio',
              command: 'node',
            },
            {
              id: 'dup',
              name: 'B',
              transport: 'stdio',
              command: 'node',
            },
            {
              id: 'invalid-transport',
              name: 'Bad',
              transport: 'grpc',
              command: 'node',
            },
          ],
        },
        null,
        2
      ),
      'utf8'
    );

    const runtime = await loadMcpRuntimeConfig(
      createBaseConfig({
        mcpEnabled: true,
        mcpConfigPath: configPath,
      })
    );

    assert.equal(runtime.servers.length, 1);
    assert.equal(runtime.servers[0].id, 'dup');
    assert.equal(runtime.warnings.some((warning) => warning.includes('duplicate id')), true);
    assert.equal(runtime.warnings.some((warning) => warning.includes('unsupported transport')), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('loadMcpRuntimeConfig returns warnings when config file is missing', async () => {
  const runtime = await loadMcpRuntimeConfig(
    createBaseConfig({
      mcpEnabled: true,
      mcpConfigPath: '/tmp/non-existent-mcp-config-for-test.json',
    })
  );

  assert.equal(runtime.enabled, true);
  assert.equal(runtime.servers.length, 0);
  assert.equal(runtime.warnings.length > 0, true);
});

test('loadMcpRuntimeConfig short-circuits when MCP is disabled', async () => {
  const runtime = await loadMcpRuntimeConfig(
    createBaseConfig({
      mcpEnabled: false,
      mcpConfigPath: '/tmp/does-not-matter.json',
    })
  );

  assert.equal(runtime.enabled, false);
  assert.deepEqual(runtime.servers, []);
  assert.deepEqual(runtime.warnings, []);
});
