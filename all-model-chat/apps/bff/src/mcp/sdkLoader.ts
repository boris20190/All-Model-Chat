import { readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

interface SdkCandidateSet {
  client: string;
  stdio: string;
  streamableHttp: string;
  sse: string;
}

export interface LoadedMcpSdk {
  Client: new (clientInfo: { name: string; version: string }, options?: Record<string, unknown>) => any;
  StdioClientTransport: new (params: Record<string, unknown>) => any;
  StreamableHTTPClientTransport: new (url: URL, options?: Record<string, unknown>) => any;
  SSEClientTransport: new (url: URL, options?: Record<string, unknown>) => any;
}

const dynamicImport = new Function(
  'specifier',
  'return import(specifier);'
) as (specifier: string) => Promise<Record<string, unknown>>;

let cachedSdkPromise: Promise<LoadedMcpSdk> | null = null;

const fromPackageSpecifier = (packageRoot: string): SdkCandidateSet => {
  const normalized = packageRoot.endsWith('/') ? packageRoot.slice(0, -1) : packageRoot;
  return {
    client: `${normalized}/client/index.js`,
    stdio: `${normalized}/client/stdio.js`,
    streamableHttp: `${normalized}/client/streamableHttp.js`,
    sse: `${normalized}/client/sse.js`,
  };
};

const fromPackageDirectory = (directoryPath: string): SdkCandidateSet => {
  return {
    client: pathToFileURL(path.join(directoryPath, 'dist/esm/client/index.js')).href,
    stdio: pathToFileURL(path.join(directoryPath, 'dist/esm/client/stdio.js')).href,
    streamableHttp: pathToFileURL(path.join(directoryPath, 'dist/esm/client/streamableHttp.js')).href,
    sse: pathToFileURL(path.join(directoryPath, 'dist/esm/client/sse.js')).href,
  };
};

const listFnmSdkCandidates = async (): Promise<string[]> => {
  const baseDir = path.join(os.homedir(), '.local/share/fnm/node-versions');
  try {
    const versionDirs = await readdir(baseDir, { withFileTypes: true });
    return versionDirs
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        path.join(
          baseDir,
          entry.name,
          'installation/lib/node_modules/@google/gemini-cli/node_modules/@modelcontextprotocol/sdk'
        )
      );
  } catch {
    return [];
  }
};

const buildCandidateSets = async (): Promise<SdkCandidateSet[]> => {
  const sets: SdkCandidateSet[] = [];
  const envOverride = process.env.BFF_MCP_SDK_MODULE_PATH?.trim();

  if (envOverride) {
    if (path.isAbsolute(envOverride)) {
      sets.push(fromPackageDirectory(envOverride));
    } else {
      sets.push(fromPackageSpecifier(envOverride));
    }
  }

  sets.push(fromPackageSpecifier('@modelcontextprotocol/sdk'));

  const knownLocalPaths = new Set<string>([
    path.join(os.homedir(), '.cherrystudio/install/global/node_modules/@modelcontextprotocol/sdk'),
    ...(await listFnmSdkCandidates()),
  ]);

  for (const localPath of knownLocalPaths) {
    sets.push(fromPackageDirectory(localPath));
  }

  return sets;
};

const isLoadedMcpSdk = (value: unknown): value is LoadedMcpSdk => {
  if (!isObject(value)) return false;
  return (
    typeof value.Client === 'function' &&
    typeof value.StdioClientTransport === 'function' &&
    typeof value.StreamableHTTPClientTransport === 'function' &&
    typeof value.SSEClientTransport === 'function'
  );
};

export const loadMcpSdk = async (): Promise<LoadedMcpSdk> => {
  if (cachedSdkPromise) return cachedSdkPromise;

  cachedSdkPromise = (async () => {
    const attempts: string[] = [];
    const candidates = await buildCandidateSets();

    for (const candidate of candidates) {
      try {
        const [clientModule, stdioModule, streamableHttpModule, sseModule] = await Promise.all([
          dynamicImport(candidate.client),
          dynamicImport(candidate.stdio),
          dynamicImport(candidate.streamableHttp),
          dynamicImport(candidate.sse),
        ]);

        const loaded = {
          Client: clientModule.Client,
          StdioClientTransport: stdioModule.StdioClientTransport,
          StreamableHTTPClientTransport: streamableHttpModule.StreamableHTTPClientTransport,
          SSEClientTransport: sseModule.SSEClientTransport,
        } as Record<string, unknown>;

        if (isLoadedMcpSdk(loaded)) {
          return loaded;
        }

        attempts.push(`${candidate.client} (invalid exports)`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push(`${candidate.client} (${message})`);
      }
    }

    throw new Error(
      `Failed to load @modelcontextprotocol/sdk. Attempted candidates: ${attempts.join(' | ')}`
    );
  })();

  return cachedSdkPromise;
};
const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};
