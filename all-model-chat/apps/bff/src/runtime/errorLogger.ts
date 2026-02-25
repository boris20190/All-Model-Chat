import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

export const DEFAULT_RUNTIME_ERROR_LOG_PATH = path.join(PROJECT_ROOT_PATH, 'logs', 'runtime-errors.log');
export const DEFAULT_RUNTIME_ERROR_LOG_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_RUNTIME_ERROR_LOG_MAX_FILES = 5;

interface RuntimeErrorLoggerConfig {
  enabled: boolean;
  logPath?: string;
  maxBytes?: number;
  maxFiles?: number;
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const SENSITIVE_KEY_PATTERN = /(api[_-]?key|authorization|token|secret|password)/i;

const sanitizeContext = (value: unknown, depth: number = 0): unknown => {
  if (depth > 6) return '[truncated]';
  if (Array.isArray(value)) return value.map((entry) => sanitizeContext(entry, depth + 1));
  if (!isObject(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      result[key] = '[redacted]';
      continue;
    }
    result[key] = sanitizeContext(rawValue, depth + 1);
  }
  return result;
};

const normalizeError = (error: unknown): { message: string; stack?: string } => {
  if (error instanceof Error) {
    return {
      message: error.message || error.name || 'Unknown Error',
      stack: error.stack,
    };
  }

  if (typeof error === 'string') {
    return { message: error };
  }

  return {
    message: String(error),
  };
};

export class RuntimeErrorLogger {
  private enabled: boolean;
  private readonly logPath: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(config: RuntimeErrorLoggerConfig) {
    this.enabled = config.enabled;
    this.logPath = config.logPath || DEFAULT_RUNTIME_ERROR_LOG_PATH;
    this.maxBytes = config.maxBytes || DEFAULT_RUNTIME_ERROR_LOG_MAX_BYTES;
    this.maxFiles = config.maxFiles || DEFAULT_RUNTIME_ERROR_LOG_MAX_FILES;
  }

  getConfig(): {
    enabled: boolean;
    logPath: string;
    maxBytes: number;
    maxFiles: number;
  } {
    return {
      enabled: this.enabled,
      logPath: this.logPath,
      maxBytes: this.maxBytes,
      maxFiles: this.maxFiles,
    };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  async logError(source: string, error: unknown, context?: unknown): Promise<void> {
    if (!this.enabled) return;

    const normalizedError = normalizeError(error);
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      source,
      error: normalizedError.message,
      stack: normalizedError.stack,
      context: sanitizeContext(context),
    });

    const payload = `${line}\n`;
    this.queue = this.queue
      .then(async () => {
        await mkdir(path.dirname(this.logPath), { recursive: true });
        await this.rotateIfNeeded(Buffer.byteLength(payload, 'utf8'));
        await appendFile(this.logPath, payload, 'utf8');
      })
      .catch(() => undefined);

    await this.queue;
  }

  private async rotateIfNeeded(incomingBytes: number): Promise<void> {
    let currentSize = 0;
    try {
      const info = await stat(this.logPath);
      currentSize = info.size;
    } catch {
      return;
    }

    if (currentSize + incomingBytes <= this.maxBytes) return;

    const highest = this.maxFiles - 1;
    const oldestPath = `${this.logPath}.${this.maxFiles}`;
    await rm(oldestPath, { force: true }).catch(() => undefined);

    for (let index = highest; index >= 1; index -= 1) {
      const from = `${this.logPath}.${index}`;
      const to = `${this.logPath}.${index + 1}`;
      await rename(from, to).catch(() => undefined);
    }

    await rename(this.logPath, `${this.logPath}.1`).catch(() => undefined);
  }
}
