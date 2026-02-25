import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMcpServerStatusesForMode } from './status.js';
import type { McpRuntimeConfig } from './types.js';

const buildRuntime = (): McpRuntimeConfig => ({
  enabled: true,
  configPath: '/tmp/mcp.servers.json',
  warnings: [],
  servers: [
    {
      id: 'local-stdio',
      name: 'Local Stdio',
      transport: 'stdio',
      enabled: true,
      command: 'bash',
      args: ['-lc', 'echo ok'],
      env: {},
      headers: {},
      sseFallback: true,
      connectTimeoutMs: 20000,
      timeoutMs: 15000,
    },
    {
      id: 'remote-http',
      name: 'Remote HTTP',
      transport: 'http',
      enabled: true,
      args: [],
      env: {},
      url: 'https://example.com/mcp',
      headers: {
        Authorization: 'Bearer test',
      },
      sseFallback: true,
      connectTimeoutMs: 20000,
      timeoutMs: 15000,
    },
  ],
});

test('buildMcpServerStatusesForMode marks remote transport as non-attachable in legacy mode', async () => {
  const statuses = await buildMcpServerStatusesForMode(buildRuntime(), 'legacy');
  const byId = new Map(statuses.map((status) => [status.id, status]));

  assert.equal(byId.get('local-stdio')?.available, true);
  assert.equal(byId.get('local-stdio')?.attachable, true);

  assert.equal(byId.get('remote-http')?.available, true);
  assert.equal(byId.get('remote-http')?.attachable, false);
  assert.equal(
    byId.get('remote-http')?.statusMessage?.includes('legacy runtime cannot attach remote transports'),
    true
  );
});
