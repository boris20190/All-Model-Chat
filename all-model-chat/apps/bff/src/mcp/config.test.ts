import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { BffConfig } from '../config/env.js';
import { importManagedMcpConfig, loadMcpRuntimeConfig, saveManagedMcpConfig } from './config.js';

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
  mcpRuntimeMode: 'sdk',
  mcpSdkModulePath: undefined,
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
    assert.deepEqual(runtime.servers[0].headers, {});
    assert.equal(runtime.servers[0].sseFallback, true);
    assert.equal(runtime.servers[0].connectTimeoutMs, 20000);
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

test('saveManagedMcpConfig writes standard servers file and separate runtime enabled state', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mcp-config-test-'));
  const configPath = path.join(tempDir, 'mcp.servers.json');
  const statePath = path.join(tempDir, 'mcp.runtime.json');

  try {
    const saved = await saveManagedMcpConfig(
      createBaseConfig({
        mcpEnabled: true,
        mcpConfigPath: configPath,
      }),
      {
        enabled: false,
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
      }
    );

    assert.equal(saved.enabled, false);
    assert.equal(saved.servers.length, 1);
    assert.equal(saved.servers[0].id, 'filesystem');

    const savedConfigRaw = await readFile(configPath, 'utf8');
    const savedConfig = JSON.parse(savedConfigRaw) as Record<string, unknown>;
    assert.deepEqual(Object.keys(savedConfig), ['servers']);
    assert.equal(Array.isArray(savedConfig.servers), true);

    const savedStateRaw = await readFile(statePath, 'utf8');
    const savedState = JSON.parse(savedStateRaw) as Record<string, unknown>;
    assert.equal(savedState.enabled, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('importManagedMcpConfig supports mcpServers format and merges by id', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mcp-config-test-'));
  const configPath = path.join(tempDir, 'mcp.servers.json');

  try {
    const config = createBaseConfig({
      mcpEnabled: true,
      mcpConfigPath: configPath,
    });

    await saveManagedMcpConfig(config, {
      enabled: true,
      servers: [
        {
          id: 'existing',
          name: 'Existing Server',
          transport: 'stdio',
          command: 'node',
          args: ['existing.js'],
          enabled: true,
        },
        {
          id: 'keep',
          name: 'Keep Server',
          transport: 'stdio',
          command: 'node',
          args: ['keep.js'],
          enabled: true,
        },
      ],
    });

    const imported = await importManagedMcpConfig(config, {
      enabled: false,
      mcpServers: {
        existing: {
          command: 'python',
          args: ['updated.py'],
          name: 'Updated Existing',
          enabled: true,
        },
        created: {
          command: 'node',
          args: ['created.js'],
          name: 'Created Server',
        },
      },
    });

    assert.deepEqual(imported.summary.updated, ['existing']);
    assert.deepEqual(imported.summary.created, ['created']);

    const byId = new Map(imported.config.servers.map((server) => [server.id, server]));
    assert.equal(byId.has('keep'), true);
    assert.equal(byId.get('existing')?.command, 'python');
    assert.equal(byId.get('existing')?.transport, 'stdio');
    assert.equal(byId.get('created')?.command, 'node');
    assert.equal(imported.config.enabled, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
