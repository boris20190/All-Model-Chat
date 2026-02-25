import { createServer } from 'node:http';
import { loadBffConfig } from './config/env.js';
import { createHealthPayload } from './routes/health.js';
import { ProviderKeyPool } from './providers/keyPool.js';
import { GeminiProviderClient } from './providers/geminiClient.js';
import { handleChatStreamRoute } from './routes/chatStream.js';
import { handleFilesRoute } from './routes/files.js';
import { handleGenerationRoute } from './routes/generation.js';
import { handleModelsRoute } from './routes/models.js';
import {
  handleMcpConfigRoute,
  handleMcpImportRoute,
  handleMcpServersRoute,
} from './routes/mcp.js';
import { RuntimeErrorLogger } from './runtime/errorLogger.js';
import { loadRuntimeDebugEnabled } from './runtime/debugConfig.js';
import { handleRuntimeDebugRoute } from './routes/runtimeDebug.js';
import { getMcpConnectionPool } from './mcp/pool/connectionPool.js';

const config = loadBffConfig();
const keyPool = new ProviderKeyPool(config.providerApiKeys, {
  failureCooldownMs: config.providerKeyFailureCooldownMs,
});
const geminiProviderClient = new GeminiProviderClient(keyPool, {
  useVertexAi: config.providerUseVertexAi,
  baseUrl: config.providerBaseUrl,
  apiVersion: config.providerApiVersion,
});
const runtimeDebugEnabled = await loadRuntimeDebugEnabled().catch(() => false);
const errorLogger = new RuntimeErrorLogger({
  enabled: runtimeDebugEnabled,
});
const mcpConnectionPool = getMcpConnectionPool();

const logRouteFailure = async (
  source: string,
  error: unknown,
  context?: Record<string, unknown>
): Promise<void> => {
  await errorLogger.logError(source, error, context);
};

const server = createServer((request, response) => {
  if (!request.url) {
    response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Invalid request URL' }));
    return;
  }

  const method = request.method || 'GET';
  const path = request.url.split('?')[0];

  if (method === 'GET' && path === '/health') {
    const payload = createHealthPayload(
      config,
      geminiProviderClient.getKeyPoolSnapshot(),
      geminiProviderClient.getProviderConfigSnapshot()
    );
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(payload));
    return;
  }

  if (path === '/api/chat/stream') {
    if (method !== 'POST') {
      response.writeHead(405, {
        'content-type': 'application/json; charset=utf-8',
        allow: 'POST',
      });
      response.end(JSON.stringify({ error: 'Method Not Allowed' }));
      return;
    }

    handleChatStreamRoute(request, response, geminiProviderClient, config, logRouteFailure).catch(
      async (error) => {
      await logRouteFailure('route.chat_stream', error, { path, method });
      if (response.writableEnded) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unexpected stream proxy failure.';
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(
        JSON.stringify({
          error: {
            code: 'internal_error',
            message,
            status: 500,
          },
        })
      );
      }
    );
    return;
  }

  if (path === '/api/mcp/servers') {
    handleMcpServersRoute(request, response, config).catch(async (error) => {
      if (response.writableEnded) return;
      await logRouteFailure('route.mcp_servers', error, { path, method });
      const message = error instanceof Error ? error.message : 'Unexpected MCP route failure.';
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(
        JSON.stringify({
          error: {
            code: 'internal_error',
            message,
            status: 500,
          },
        })
      );
    });
    return;
  }

  if (path === '/api/mcp/config') {
    handleMcpConfigRoute(request, response, config).catch(async (error) => {
      if (response.writableEnded) return;
      await logRouteFailure('route.mcp_config', error, { path, method });
      const message = error instanceof Error ? error.message : 'Unexpected MCP config route failure.';
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(
        JSON.stringify({
          error: {
            code: 'internal_error',
            message,
            status: 500,
          },
        })
      );
    });
    return;
  }

  if (path === '/api/mcp/config/import') {
    handleMcpImportRoute(request, response, config).catch(async (error) => {
      if (response.writableEnded) return;
      await logRouteFailure('route.mcp_import', error, { path, method });
      const message = error instanceof Error ? error.message : 'Unexpected MCP import route failure.';
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(
        JSON.stringify({
          error: {
            code: 'internal_error',
            message,
            status: 500,
          },
        })
      );
    });
    return;
  }

  if (path === '/api/runtime/debug') {
    handleRuntimeDebugRoute(request, response, errorLogger).catch(async (error) => {
      if (response.writableEnded) return;
      await logRouteFailure('route.runtime_debug', error, { path, method });
      const message =
        error instanceof Error ? error.message : 'Unexpected runtime debug route failure.';
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(
        JSON.stringify({
          error: {
            code: 'internal_error',
            message,
            status: 500,
          },
        })
      );
    });
    return;
  }

  if (path.startsWith('/api/files/')) {
    handleFilesRoute(request, response, geminiProviderClient).catch(async (error) => {
      if (response.writableEnded) return;
      await logRouteFailure('route.files', error, { path, method });
      const message = error instanceof Error ? error.message : 'Unexpected files route failure.';
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(
        JSON.stringify({
          error: {
            code: 'internal_error',
            message,
            status: 500,
          },
        })
      );
    });
    return;
  }

  if (path === '/api/models') {
    handleModelsRoute(request, response, geminiProviderClient).catch(async (error) => {
      if (response.writableEnded) return;
      await logRouteFailure('route.models', error, { path, method });
      const message = error instanceof Error ? error.message : 'Unexpected models route failure.';
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(
        JSON.stringify({
          error: {
            code: 'internal_error',
            message,
            status: 500,
          },
        })
      );
    });
    return;
  }

  if (path.startsWith('/api/generation/')) {
    handleGenerationRoute(request, response, geminiProviderClient).catch(async (error) => {
      if (response.writableEnded) return;
      await logRouteFailure('route.generation', error, { path, method });
      const message = error instanceof Error ? error.message : 'Unexpected generation route failure.';
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(
        JSON.stringify({
          error: {
            code: 'internal_error',
            message,
            status: 500,
          },
        })
      );
    });
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ error: 'Not Found' }));
});

process.on('unhandledRejection', async (reason) => {
  await errorLogger.logError('process.unhandledRejection', reason);
});

process.on('uncaughtException', async (error) => {
  await errorLogger.logError('process.uncaughtException', error);
});

process.on('SIGINT', () => {
  void mcpConnectionPool.closeAll();
});

process.on('SIGTERM', () => {
  void mcpConnectionPool.closeAll();
});

server.listen(config.port, config.host, () => {
  console.log(`[BFF] ${config.serviceName} listening on http://${config.host}:${config.port}`);
  console.log(`[BFF] Provider key pool initialized with ${config.providerApiKeys.length} key(s).`);
  console.log(
    `[BFF] Provider mode: ${config.providerUseVertexAi ? 'vertexai' : 'gemini-api'} (baseUrl=${
      config.providerBaseUrl || 'default'
    }, apiVersion=${config.providerApiVersion || 'default'})`
  );
  console.log(
    `[BFF] MCP integration: ${config.mcpEnabled ? 'enabled' : 'disabled'} (configPath=${
      config.mcpConfigPath || '~/apps/all-model-chat-runtime/mcp.servers.json'
    }, mode=${config.mcpRuntimeMode}, sdkPath=${config.mcpSdkModulePath || 'auto'})`
  );
  const debugConfig = errorLogger.getConfig();
  console.log(
    `[BFF] Runtime debug logging: ${debugConfig.enabled ? 'enabled' : 'disabled'} (logPath=${
      debugConfig.logPath
    })`
  );
});
