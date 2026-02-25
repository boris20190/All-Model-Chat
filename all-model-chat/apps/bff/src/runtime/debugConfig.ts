import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_RUNTIME_DEBUG_CONFIG_PATH = '~/apps/all-model-chat-runtime/runtime.debug.json';

interface RuntimeDebugPersistedConfig {
  enabled?: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const expandHomePath = (rawPath: string): string => {
  if (!rawPath.startsWith('~/')) return rawPath;
  return path.join(os.homedir(), rawPath.slice(2));
};

const toAbsolutePath = (rawPath: string): string => {
  const expanded = expandHomePath(rawPath.trim());
  if (path.isAbsolute(expanded)) return expanded;
  return path.resolve(expanded);
};

export const resolveRuntimeDebugConfigPath = (): string => {
  return toAbsolutePath(DEFAULT_RUNTIME_DEBUG_CONFIG_PATH);
};

const parseRuntimeDebugConfig = (rawText: string): RuntimeDebugPersistedConfig => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {};
  }

  if (!isObject(parsed)) {
    return {};
  }

  return {
    enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : undefined,
  };
};

export const loadRuntimeDebugEnabled = async (): Promise<boolean> => {
  const configPath = resolveRuntimeDebugConfigPath();

  try {
    const rawText = await readFile(configPath, 'utf8');
    const parsed = parseRuntimeDebugConfig(rawText);
    return parsed.enabled === true;
  } catch {
    return false;
  }
};

export const saveRuntimeDebugEnabled = async (enabled: boolean): Promise<void> => {
  const configPath = resolveRuntimeDebugConfigPath();
  await mkdir(path.dirname(configPath), { recursive: true });
  const content = JSON.stringify({ enabled }, null, 2);
  await writeFile(configPath, `${content}\n`, 'utf8');
};
