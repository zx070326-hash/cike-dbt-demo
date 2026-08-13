import rawKnowledge from "../data/knowledge/knowledge-v2.json";

export type SourceQuality = {
  score: number;
  issues: string[];
  contentType: "handout" | "worksheet" | "trainer-note" | "front-matter" | "source-page";
  groundingEligible: boolean;
};

export type KnowledgeChunk = {
  id: string;
  pageId: string;
  sourceId: string;
  sourceFile: string;
  book: string;
  /** Raw OCR-derived heading retained for audit. */
  section: string;
  /** Derived, user-readable title. Never changes the source-exact text. */
  displaySection: string;
  displaySectionSource: "detected-structure" | "ocr-heading" | "generated-location-label";
  pdfPage: number;
  printedPage: number | null;
  charStart: number;
  charEnd: number;
  ordinal: number;
  text: string;
  ocrScore: number | null;
  sourceQuality: SourceQuality;
  skillCardIds: string[];
  parentBlockId: string;
};

export type WikiEvidenceLink = {
  chunkId: string;
  matchedAliases: string[];
  retrievalWeight: number;
  evidenceStatus: "candidate-unverified" | "professionally-verified";
};

export type SkillCardClaim<T extends string | string[] = string | string[]> = {
  text: T;
  evidenceIds: string[];
  verificationStatus: "candidate-unverified" | "professionally-verified";
};

/**
 * Skill cards are an evidence-linked editorial contract, not source truth.
 * Unless professionally reviewed, their prose is navigation-only and must not
 * be surfaced as an authoritative DBT claim.
 */
export type WikiNode = {
  id: string;
  label: string;
  module: string;
  aliases: string[];
  related: string[];
  reviewStatus: "source-linked-unreviewed" | "professionally-reviewed";
  contentAuthority: "navigation-only" | "reviewed-content";
  linkedChunkCount: number;
  evidence: WikiEvidenceLink[];
  definition: SkillCardClaim<string>;
  applicableWhen: SkillCardClaim<string[]>;
  notApplicableWhen: SkillCardClaim<string[]>;
  firstStep: SkillCardClaim<string>;
  retrievalHints: string[];
};

export type ParentBlock = {
  id: string;
  sourceId: string;
  book: string;
  title: string;
  primaryPageId: string;
  startPdfPage: number;
  endPdfPage: number;
  chunkIds: string[];
  skillCardIds: string[];
  sourceExact: true;
};

export type KnowledgeV2 = {
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
    parentBlockCount: number;
  };
  chunks: KnowledgeChunk[];
  wikiNodes: WikiNode[];
  parentBlocks: ParentBlock[];
};

export const knowledgeV2 = rawKnowledge as KnowledgeV2;

const chunksById = new Map(knowledgeV2.chunks.map((chunk) => [chunk.id, chunk]));
const parentBlocksById = new Map(knowledgeV2.parentBlocks.map((block) => [block.id, block]));
const nodesById = new Map(knowledgeV2.wikiNodes.map((node) => [node.id, node]));

export function normalizeKnowledgeText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function directNodeMatchScore(query: string, node: WikiNode) {
  const normalizedQuery = normalizeKnowledgeText(query);
  let score = 0;
  for (const phrase of [node.label, ...node.aliases]) {
    const normalized = normalizeKnowledgeText(phrase);
    if (normalized && normalizedQuery.includes(normalized)) score += 10 + Math.min(normalized.length, 12);
  }
  for (const phrase of node.retrievalHints) {
    const normalized = normalizeKnowledgeText(phrase);
    if (normalized && normalizedQuery.includes(normalized)) score += 8 + Math.min(normalized.length, 10);
  }
  return score;
}

export function matchingWikiNodes(query: string): WikiNode[] {
  return knowledgeV2.wikiNodes
    .map((node) => ({ node, score: directNodeMatchScore(query, node) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id))
    .map(({ node }) => node);
}

export function wikiExpansionTerms(query: string): string[] {
  const matched = matchingWikiNodes(query).slice(0, 3);
  const relatedIds = new Set(matched.flatMap((node) => node.related));
  const related = knowledgeV2.wikiNodes.filter((node) => relatedIds.has(node.id));
  return [...new Set(
    [...matched, ...related].flatMap((node) => [node.label, ...node.aliases]),
  )];
}

export function wikiEvidenceBoosts(query: string): Map<string, number> {
  const boosts = new Map<string, number>();
  const matched = matchingWikiNodes(query).slice(0, 3);
  const relatedIds = new Set(matched.flatMap((node) => node.related));
  for (const node of knowledgeV2.wikiNodes) {
    const direct = matched.some((matchedNode) => matchedNode.id === node.id);
    const related = relatedIds.has(node.id);
    if (!direct && !related) continue;
    for (const evidence of node.evidence) {
      const base = direct ? 22 : 4;
      boosts.set(
        evidence.chunkId,
        Math.max(boosts.get(evidence.chunkId) ?? 0, base + evidence.retrievalWeight * (direct ? 1 : 0.2)),
      );
    }
  }
  return boosts;
}

export function resolveKnowledgeChunk(chunkId: string) {
  return chunksById.get(chunkId);
}

export function resolveParentBlock(parentBlockId: string) {
  return parentBlocksById.get(parentBlockId);
}

export function resolveSkillCard(cardId: string) {
  return nodesById.get(cardId);
}

export function parentContextChunks(chunkId: string, limit = 6): KnowledgeChunk[] {
  const chunk = chunksById.get(chunkId);
  if (!chunk) return [];
  const parent = parentBlocksById.get(chunk.parentBlockId);
  if (!parent) return [];
  return parent.chunkIds
    .map((id) => chunksById.get(id))
    .filter((value): value is KnowledgeChunk => Boolean(value))
    .sort((left, right) => {
      const leftDistance = Math.abs(left.pdfPage - chunk.pdfPage);
      const rightDistance = Math.abs(right.pdfPage - chunk.pdfPage);
      return leftDistance - rightDistance || left.ordinal - right.ordinal;
    })
    .slice(0, limit);
}

export function reviewedSkillCardContent(cardId: string): WikiNode | null {
  const node = nodesById.get(cardId);
  if (!node || node.reviewStatus !== "professionally-reviewed" || node.contentAuthority !== "reviewed-content") {
    return null;
  }
  return node;
}
