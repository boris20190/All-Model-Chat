export interface ParsedSseEvent {
  eventName: string;
  payload: unknown;
}

export interface ConsumedSseSummary {
  eventCount: number;
  trailingTextSample?: string;
}

interface SplitSseBufferResult {
  rawBlock: string;
  rest: string;
}

const findSseSeparator = (buffer: string): { index: number; length: number } | null => {
  const lfIndex = buffer.indexOf('\n\n');
  const crlfIndex = buffer.indexOf('\r\n\r\n');

  if (lfIndex < 0 && crlfIndex < 0) return null;
  if (lfIndex < 0) return { index: crlfIndex, length: 4 };
  if (crlfIndex < 0) return { index: lfIndex, length: 2 };

  return lfIndex < crlfIndex
    ? { index: lfIndex, length: 2 }
    : { index: crlfIndex, length: 4 };
};

export const splitSseBuffer = (buffer: string): SplitSseBufferResult | null => {
  const separator = findSseSeparator(buffer);
  if (!separator) return null;

  return {
    rawBlock: buffer.slice(0, separator.index),
    rest: buffer.slice(separator.index + separator.length),
  };
};

export const parseSseEventBlock = (rawBlock: string): ParsedSseEvent | null => {
  const normalized = rawBlock.replace(/\r\n/g, '\n').trim();
  if (!normalized) return null;

  let eventName = 'message';
  const dataLines: string[] = [];

  for (const line of normalized.split('\n')) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) return null;

  const rawPayload = dataLines.join('\n');
  try {
    return {
      eventName,
      payload: JSON.parse(rawPayload),
    };
  } catch {
    return {
      eventName,
      payload: rawPayload,
    };
  }
};

export const consumeSseStream = async (
  response: Response,
  abortSignal: AbortSignal,
  onEvent: (event: ParsedSseEvent) => void
): Promise<ConsumedSseSummary> => {
  if (!response.body) {
    throw new Error('BFF stream response body is empty.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventCount = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (abortSignal.aborted) break;

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const split = splitSseBuffer(buffer);
      if (!split) break;

      buffer = split.rest;
      const parsed = parseSseEventBlock(split.rawBlock);
      if (parsed) {
        eventCount += 1;
        onEvent(parsed);
      }
    }
  }

  let trailingTextSample: string | undefined;
  if (buffer.trim().length > 0) {
    const parsed = parseSseEventBlock(buffer);
    if (parsed) {
      eventCount += 1;
      onEvent(parsed);
    } else {
      trailingTextSample = buffer.trim().slice(0, 400);
    }
  }

  return {
    eventCount,
    trailingTextSample,
  };
};
