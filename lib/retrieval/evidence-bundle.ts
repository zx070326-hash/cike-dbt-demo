import type { KnowledgeV2, SkillCardClaim, WikiNode } from "../knowledge-v2";
import type { EngineRetrievalHit } from "./engine";

export type EvidenceRecord = {
  evidenceId: string;
  chunkId: string;
  role: "primary" | "parent-context";
  sourceId: string;
  book: string;
  section: string;
  pdfPage: number;
  printedPage: number | null;
  charStart: number;
  charEnd: number;
  text: string;
  sourceExact: true;
  qualityScore: number;
  qualityIssues: string[];
};

export type ClaimBinding = {
  claimId: string;
  skillCardId: string;
  claimType: "definition" | "applicable-when" | "not-applicable-when" | "first-step";
  /** Editorial draft only until a professional review changes the status. */
  draftText: string | string[];
  allowedEvidenceIds: string[];
  verificationStatus: "candidate-unverified" | "professionally-verified";
  publishableAsStableClaim: boolean;
};

export type EvidenceBundle = {
  schemaVersion: "1.0";
  query: string;
  skillCards: Array<{
    id: string;
    label: string;
    module: string;
    reviewStatus: WikiNode["reviewStatus"];
    contentAuthority: WikiNode["contentAuthority"];
  }>;
  evidence: EvidenceRecord[];
  claimBindings: ClaimBinding[];
  citationPolicy: {
    unit: "claim";
    requireEvidenceFor: Array<"definition" | "applicability" | "procedure" | "source-attributed-fact">;
    unreviewedSkillCardProseMayBeQuotedAsAuthority: false;
    evidenceIdsMustResolveInsideBundle: true;
  };
  diagnostics: {
    primaryEvidenceCount: number;
    parentContextCount: number;
    lowQualityPrimaryCount: number;
    professionallyReviewedSkillCardCount: number;
  };
};

function claimBinding(
  card: WikiNode,
  claimType: ClaimBinding["claimType"],
  claim: SkillCardClaim,
  evidenceIdByChunk: Map<string, string>,
): ClaimBinding {
  return {
    claimId: `${card.id}:${claimType}`,
    skillCardId: card.id,
    claimType,
    draftText: claim.text,
    allowedEvidenceIds: claim.evidenceIds
      .map((chunkId) => evidenceIdByChunk.get(chunkId))
      .filter((value): value is string => Boolean(value)),
    verificationStatus: claim.verificationStatus,
    publishableAsStableClaim:
      card.reviewStatus === "professionally-reviewed" &&
      card.contentAuthority === "reviewed-content" &&
      claim.verificationStatus === "professionally-verified",
  };
}

export function createEvidenceBundle(
  knowledge: KnowledgeV2,
  query: string,
  hits: EngineRetrievalHit[],
  maxParentContext = 8,
): EvidenceBundle {
  const chunkById = new Map(knowledge.chunks.map((chunk) => [chunk.id, chunk]));
  const cardById = new Map(knowledge.wikiNodes.map((card) => [card.id, card]));
  const primaryIds = new Set(hits.map((hit) => hit.chunk.id));
  const records: EvidenceRecord[] = [];
  const evidenceIdByChunk = new Map<string, string>();

  const addRecord = (chunkId: string, role: EvidenceRecord["role"]) => {
    if (evidenceIdByChunk.has(chunkId)) return;
    const chunk = chunkById.get(chunkId);
    if (!chunk || !chunk.sourceQuality.groundingEligible) return;
    const evidenceId = `E${records.length + 1}`;
    evidenceIdByChunk.set(chunkId, evidenceId);
    records.push({
      evidenceId,
      chunkId,
      role,
      sourceId: chunk.sourceId,
      book: chunk.book,
      section: chunk.displaySection,
      pdfPage: chunk.pdfPage,
      printedPage: chunk.printedPage,
      charStart: chunk.charStart,
      charEnd: chunk.charEnd,
      text: chunk.text,
      sourceExact: true,
      qualityScore: chunk.sourceQuality.score,
      qualityIssues: chunk.sourceQuality.issues,
    });
  };

  for (const hit of hits) addRecord(hit.chunk.id, "primary");
  let parentContextCount = 0;
  for (const hit of hits) {
    if (parentContextCount >= maxParentContext) break;
    for (const chunkId of hit.parentBlock?.chunkIds ?? []) {
      if (primaryIds.has(chunkId) || evidenceIdByChunk.has(chunkId)) continue;
      addRecord(chunkId, "parent-context");
      parentContextCount += 1;
      if (parentContextCount >= maxParentContext) break;
    }
  }

  const selectedCardIds = new Set(hits.flatMap((hit) => hit.matchedSkillCardIds));
  // Ensure candidate claim evidence can resolve in the bundle. This does not
  // make an unreviewed draft publishable; it only gives a reviewer/model an
  // auditable allow-list for each possible claim.
  for (const cardId of selectedCardIds) {
    const card = cardById.get(cardId);
    if (!card) continue;
    for (const chunkId of [
      ...card.definition.evidenceIds,
      ...card.applicableWhen.evidenceIds,
      ...card.notApplicableWhen.evidenceIds,
      ...card.firstStep.evidenceIds,
    ]) addRecord(chunkId, "parent-context");
  }

  const cards = [...selectedCardIds]
    .map((id) => cardById.get(id))
    .filter((value): value is WikiNode => Boolean(value));
  const claimBindings = cards.flatMap((card) => [
    claimBinding(card, "definition", card.definition, evidenceIdByChunk),
    claimBinding(card, "applicable-when", card.applicableWhen, evidenceIdByChunk),
    claimBinding(card, "not-applicable-when", card.notApplicableWhen, evidenceIdByChunk),
    claimBinding(card, "first-step", card.firstStep, evidenceIdByChunk),
  ]);

  return {
    schemaVersion: "1.0",
    query,
    skillCards: cards.map((card) => ({
      id: card.id,
      label: card.label,
      module: card.module,
      reviewStatus: card.reviewStatus,
      contentAuthority: card.contentAuthority,
    })),
    evidence: records,
    claimBindings,
    citationPolicy: {
      unit: "claim",
      requireEvidenceFor: ["definition", "applicability", "procedure", "source-attributed-fact"],
      unreviewedSkillCardProseMayBeQuotedAsAuthority: false,
      evidenceIdsMustResolveInsideBundle: true,
    },
    diagnostics: {
      primaryEvidenceCount: hits.length,
      parentContextCount: records.filter((record) => record.role === "parent-context").length,
      lowQualityPrimaryCount: hits.filter((hit) => hit.qualityScore < 0.65).length,
      professionallyReviewedSkillCardCount: cards.filter(
        (card) => card.reviewStatus === "professionally-reviewed",
      ).length,
    },
  };
}
