import { visit } from 'unist-util-visit';
import { visitParents } from 'unist-util-visit-parents';

const DISALLOWED_ANCESTOR_TYPES = new Set([
  'code',
  'inlineCode',
  'html',
  'link',
  'linkReference',
  'definition',
]);

type ReasonCode =
  | 'invalid_segment_end'
  | 'empty_chunk_indices'
  | 'invalid_chunk_index'
  | 'missing_source_uri'
  | 'disallowed_context'
  | 'unmapped_offset';

interface CitationSource {
  uri: string;
  title: string;
}

interface SupportRecord {
  charEndIndex: number;
  chunkIndices: unknown[];
}

interface NodeRange {
  start: number;
  end: number;
}

interface TextNodeReference {
  node: any;
  parent: any;
  index: number;
  start: number;
  end: number;
  disallowed: boolean;
}

export interface GroundingCitationDiagnostics {
  insertedCount: number;
  skippedCount: number;
  skipReasons: string[];
  reasonCounts: Record<string, number>;
}

interface RemarkGroundingCitationsOptions {
  rawText: string;
  groundingMetadata?: unknown;
  onDiagnostics?: (diagnostics: GroundingCitationDiagnostics) => void;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const toArray = (value: unknown): unknown[] => {
  return Array.isArray(value) ? value : [];
};

const toOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const toOptionalNumber = (value: unknown): number | undefined => {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const addReasonCount = (
  reasonCounts: Record<string, number>,
  reasonSamples: string[],
  reason: ReasonCode
): void => {
  reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  if (reasonSamples.length < 5) {
    reasonSamples.push(reason);
  }
};

const buildSources = (metadata: unknown): Array<CitationSource | null> => {
  if (!isObjectRecord(metadata)) return [];

  const groundingChunks = toArray(metadata.groundingChunks ?? metadata.grounding_chunks);
  const citations = toArray(metadata.citations);

  const chunkSources = groundingChunks.map((chunk) => {
    if (!isObjectRecord(chunk) || !isObjectRecord(chunk.web)) return null;
    const uri = toOptionalString(chunk.web.uri);
    if (!uri) return null;
    const title = toOptionalString(chunk.web.title) || uri;
    return { uri, title };
  });

  const citationSources = citations.map((citation) => {
    if (!isObjectRecord(citation)) return null;
    const uri = toOptionalString(citation.uri);
    if (!uri) return null;
    const title = toOptionalString(citation.title) || uri;
    return { uri, title };
  });

  return [...chunkSources, ...citationSources];
};

const resolveSupports = (
  metadata: unknown,
  rawText: string,
  reasonCounts: Record<string, number>,
  reasonSamples: string[]
): SupportRecord[] => {
  if (!isObjectRecord(metadata)) return [];

  const supports = toArray(metadata.groundingSupports ?? metadata.grounding_supports);
  const encodedText = new TextEncoder().encode(rawText);
  const decoder = new TextDecoder();

  const toCharIndex = (byteIndex: number): number | null => {
    if (!Number.isInteger(byteIndex) || byteIndex < 0 || byteIndex > encodedText.length) return null;
    return decoder.decode(encodedText.slice(0, byteIndex)).length;
  };

  const records: SupportRecord[] = [];

  for (const support of supports) {
    if (!isObjectRecord(support) || !isObjectRecord(support.segment)) {
      addReasonCount(reasonCounts, reasonSamples, 'invalid_segment_end');
      continue;
    }

    const endByteIndex = toOptionalNumber(support.segment.endIndex ?? support.segment.end_index);
    if (endByteIndex === undefined) {
      addReasonCount(reasonCounts, reasonSamples, 'invalid_segment_end');
      continue;
    }

    const charEndIndex = toCharIndex(endByteIndex);
    if (charEndIndex === null) {
      addReasonCount(reasonCounts, reasonSamples, 'unmapped_offset');
      continue;
    }

    const chunkIndices = toArray(
      support.groundingChunkIndices ?? support.grounding_chunk_indices
    );

    if (chunkIndices.length === 0) {
      addReasonCount(reasonCounts, reasonSamples, 'empty_chunk_indices');
      continue;
    }

    records.push({
      charEndIndex,
      chunkIndices,
    });
  }

  records.sort((left, right) => right.charEndIndex - left.charEndIndex);
  return records;
};

const buildProtectedRanges = (tree: any): NodeRange[] => {
  const ranges: NodeRange[] = [];

  visit(tree, (node: any) => {
    if (!node || typeof node.type !== 'string') return;
    if (!DISALLOWED_ANCESTOR_TYPES.has(node.type)) return;

    const start = toOptionalNumber(node.position?.start?.offset);
    const end = toOptionalNumber(node.position?.end?.offset);
    if (start === undefined || end === undefined || end < start) return;
    ranges.push({ start, end });
  });

  return ranges;
};

const buildTextNodeReferences = (tree: any): TextNodeReference[] => {
  const references: TextNodeReference[] = [];

  visitParents(tree, 'text', (node: any, ancestors: any[]) => {
    const parent = ancestors[ancestors.length - 1];
    if (!parent || !Array.isArray(parent.children)) return;
    const index = parent.children.indexOf(node);
    if (index < 0) return;

    const start = toOptionalNumber(node.position?.start?.offset);
    const end = toOptionalNumber(node.position?.end?.offset);
    if (start === undefined || end === undefined || end < start) return;

    const disallowed = ancestors.some(
      (ancestor) => ancestor && typeof ancestor.type === 'string' && DISALLOWED_ANCESTOR_TYPES.has(ancestor.type)
    );

    references.push({
      node,
      parent,
      index,
      start,
      end,
      disallowed,
    });
  });

  return references;
};

const createCitationNode = (source: CitationSource, labelIndex: number): any => {
  return {
    type: 'link',
    url: source.uri,
    title: `Source: ${source.title}`,
    children: [{ type: 'text', value: `[${labelIndex}]` }],
    data: {
      hProperties: {
        className: ['citation-ref'],
      },
    },
  };
};

const resolveValidCitationNodes = (
  chunkIndices: unknown[],
  sources: Array<CitationSource | null>,
  reasonCounts: Record<string, number>,
  reasonSamples: string[]
): any[] => {
  const citationNodes: any[] = [];

  for (const rawIndex of chunkIndices) {
    if (!Number.isInteger(rawIndex)) {
      addReasonCount(reasonCounts, reasonSamples, 'invalid_chunk_index');
      continue;
    }

    const chunkIndex = Number(rawIndex);
    if (chunkIndex < 0 || chunkIndex >= sources.length) {
      addReasonCount(reasonCounts, reasonSamples, 'invalid_chunk_index');
      continue;
    }

    const source = sources[chunkIndex];
    if (!source || !source.uri) {
      addReasonCount(reasonCounts, reasonSamples, 'missing_source_uri');
      continue;
    }

    citationNodes.push(createCitationNode(source, chunkIndex + 1));
  }

  return citationNodes;
};

const findInsertionReference = (
  tree: any,
  charEndIndex: number
): { reference?: TextNodeReference; reason?: ReasonCode } => {
  const references = buildTextNodeReferences(tree);

  const allowedCandidates = references.filter(
    (entry) => !entry.disallowed && charEndIndex >= entry.start && charEndIndex <= entry.end
  );

  if (allowedCandidates.length > 0) {
    allowedCandidates.sort((left, right) => {
      if (left.start !== right.start) return right.start - left.start;
      return (left.end - left.start) - (right.end - right.start);
    });
    return { reference: allowedCandidates[0] };
  }

  const protectedRanges = buildProtectedRanges(tree);
  const inProtectedRange = protectedRanges.some(
    (range) => charEndIndex >= range.start && charEndIndex <= range.end
  );

  if (inProtectedRange) {
    return { reason: 'disallowed_context' };
  }

  const inDisallowedText = references.some(
    (entry) => entry.disallowed && charEndIndex >= entry.start && charEndIndex <= entry.end
  );

  if (inDisallowedText) {
    return { reason: 'disallowed_context' };
  }

  return { reason: 'unmapped_offset' };
};

const insertCitationsAtReference = (
  reference: TextNodeReference,
  charEndIndex: number,
  citationNodes: any[]
): void => {
  const sourceValue = typeof reference.node?.value === 'string' ? reference.node.value : '';
  const localOffset = Math.max(0, charEndIndex - reference.start);

  if (localOffset <= 0) {
    reference.parent.children.splice(reference.index, 0, ...citationNodes);
    return;
  }

  if (localOffset >= sourceValue.length) {
    reference.parent.children.splice(reference.index + 1, 0, ...citationNodes);
    return;
  }

  const left = sourceValue.slice(0, localOffset);
  const right = sourceValue.slice(localOffset);
  const replacementNodes = [];

  if (left.length > 0) {
    replacementNodes.push({ ...reference.node, value: left });
  }

  replacementNodes.push(...citationNodes);

  if (right.length > 0) {
    replacementNodes.push({ ...reference.node, value: right });
  }

  reference.parent.children.splice(reference.index, 1, ...replacementNodes);
};

export const remarkGroundingCitations = (options: RemarkGroundingCitationsOptions) => {
  return (tree: any) => {
    const reasonCounts: Record<string, number> = {};
    const reasonSamples: string[] = [];
    const rawText = typeof options?.rawText === 'string' ? options.rawText : '';
    const sources = buildSources(options?.groundingMetadata);
    const supports = resolveSupports(options?.groundingMetadata, rawText, reasonCounts, reasonSamples);
    let insertedCount = 0;

    if (sources.length > 0 && supports.length > 0) {
      for (const support of supports) {
        const citationNodes = resolveValidCitationNodes(
          support.chunkIndices,
          sources,
          reasonCounts,
          reasonSamples
        );
        if (citationNodes.length === 0) continue;

        const insertion = findInsertionReference(tree, support.charEndIndex);
        if (!insertion.reference) {
          addReasonCount(reasonCounts, reasonSamples, insertion.reason || 'unmapped_offset');
          continue;
        }

        insertCitationsAtReference(insertion.reference, support.charEndIndex, citationNodes);
        insertedCount += citationNodes.length;
      }
    }

    const skippedCount = Object.values(reasonCounts).reduce((sum, count) => sum + count, 0);
    const diagnostics: GroundingCitationDiagnostics = {
      insertedCount,
      skippedCount,
      skipReasons: reasonSamples,
      reasonCounts,
    };

    options?.onDiagnostics?.(diagnostics);
  };
};
