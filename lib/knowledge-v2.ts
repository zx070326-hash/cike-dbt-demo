import rawKnowledge from "../data/knowledge/knowledge-v2.json";

export type KnowledgeChunk = {
  id: string;
  pageId: string;
  sourceId: string;
  sourceFile: string;
  book: string;
  section: string;
  pdfPage: number;
  printedPage: number | null;
  charStart: number;
  charEnd: number;
  ordinal: number;
  text: string;
  ocrScore: number | null;
};

export type WikiEvidenceLink = {
  chunkId: string;
  matchedAliases: string[];
  retrievalWeight: number;
};

export type WikiNode = {
  id: string;
  label: string;
  module: string;
  aliases: string[];
  related: string[];
  reviewStatus: "source-linked-unreviewed" | "professionally-reviewed";
  linkedChunkCount: number;
  evidence: WikiEvidenceLink[];
};

type KnowledgeV2 = {
  schemaVersion: string;
  builtAt: string;
  mode: string;
  coverage: {
    indexedPageCount: number;
    searchablePageCount: number;
    blankPageCount: number;
    sourceCharacterCount: number;
    coveredCharacterCount: number;
    characterCoverage: number;
    chunkCount: number;
    orphanNonEmptyPageCount: number;
    unresolvedWikiLinkCount: number;
    wikiNodeCount: number;
  };
  chunks: KnowledgeChunk[];
  wikiNodes: WikiNode[];
};

export const knowledgeV2 = rawKnowledge as KnowledgeV2;

function normalize(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function matchingWikiNodes(query: string): WikiNode[] {
  const normalizedQuery = normalize(query);
  return knowledgeV2.wikiNodes.filter((node) =>
    [node.label, ...node.aliases].some((value) => normalizedQuery.includes(normalize(value))),
  );
}

export function wikiExpansionTerms(query: string): string[] {
  const matched = matchingWikiNodes(query);
  const relatedIds = new Set(matched.flatMap((node) => node.related));
  const related = knowledgeV2.wikiNodes.filter((node) => relatedIds.has(node.id));
  return [...new Set(
    [...matched, ...related].flatMap((node) => [node.label, ...node.aliases]),
  )];
}

export function wikiEvidenceBoosts(query: string): Map<string, number> {
  const boosts = new Map<string, number>();
  for (const node of matchingWikiNodes(query)) {
    for (const evidence of node.evidence) {
      boosts.set(
        evidence.chunkId,
        Math.max(boosts.get(evidence.chunkId) ?? 0, 18 + evidence.retrievalWeight),
      );
    }
  }
  return boosts;
}
