import type {
  KnowledgeChunk,
  KnowledgeV2,
  ParentBlock,
  WikiNode,
} from "../knowledge-v2";

export type EngineRetrievalHit = {
  chunk: KnowledgeChunk;
  score: number;
  matchedTerms: string[];
  matchedSkillCardIds: string[];
  qualityScore: number;
  parentBlock?: ParentBlock;
};

export type RetrievalEngine = {
  retrieve: (query: string, limit?: number) => EngineRetrievalHit[];
  matchSkillCards: (query: string) => Array<{ card: WikiNode; score: number }>;
};

const stopBigrams = new Set([
  "什么", "怎么", "如何", "哪些", "是否", "可以", "应该", "请问", "解释",
  "中的", "一个", "这个", "那个", "一下", "今天", "现在", "感觉", "觉得",
]);

export function normalizeRetrievalText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function lexicalTokens(value: string) {
  const normalized = normalizeRetrievalText(value);
  const tokens = new Set<string>();
  for (const token of value.toLowerCase().match(/[a-z][a-z0-9-]{1,}/gu) ?? []) {
    tokens.add(normalizeRetrievalText(token));
  }
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const token = normalized.slice(index, index + 2);
    if (!stopBigrams.has(token)) tokens.add(token);
  }
  return [...tokens];
}

function occurrences(haystack: string, needle: string) {
  if (!needle) return 0;
  let count = 0;
  let cursor = 0;
  while ((cursor = haystack.indexOf(needle, cursor)) !== -1) {
    count += 1;
    cursor += needle.length;
  }
  return count;
}

function phraseOverlap(queryTokens: Set<string>, phrase: string) {
  const phraseTokens = lexicalTokens(phrase);
  if (!phraseTokens.length) return 0;
  const overlap = phraseTokens.filter((token) => queryTokens.has(token)).length;
  return overlap / Math.min(Math.max(queryTokens.size, 1), phraseTokens.length);
}

function scoreCardMatch(query: string, card: WikiNode) {
  const normalizedQuery = normalizeRetrievalText(query);
  const queryTokens = new Set(lexicalTokens(query));
  let score = 0;
  for (const phrase of [card.label, ...card.aliases]) {
    const normalized = normalizeRetrievalText(phrase);
    if (normalized && normalizedQuery.includes(normalized)) {
      score += 20 + Math.min(normalized.length, 12);
    } else {
      const overlap = phraseOverlap(queryTokens, phrase);
      if (overlap >= 0.67) score += overlap * 5;
    }
  }
  for (const hint of card.retrievalHints) {
    const normalized = normalizeRetrievalText(hint);
    if (normalized && normalizedQuery.includes(normalized)) {
      score += 15 + Math.min(normalized.length, 10);
      continue;
    }
    const overlap = phraseOverlap(queryTokens, hint);
    if (overlap >= 0.42) score += overlap * 11;
  }
  return score;
}

export function createRetrievalEngine(knowledge: KnowledgeV2): RetrievalEngine {
  const parentBlocks = new Map(knowledge.parentBlocks.map((block) => [block.id, block]));
  const cardEvidenceIds = new Map(
    knowledge.wikiNodes.map((card) => [card.id, new Set(card.evidence.map((evidence) => evidence.chunkId))]),
  );
  const indexed = knowledge.chunks.map((chunk) => {
    const normalizedText = normalizeRetrievalText(chunk.text);
    const normalizedTitle = normalizeRetrievalText(chunk.displaySection);
    const terms = lexicalTokens(`${chunk.displaySection}\n${chunk.text}`);
    return {
      chunk,
      normalizedText,
      normalizedTitle,
      terms,
      documentLength: Math.max(normalizedText.length / 2, 1),
    };
  });
  const documentFrequency = new Map<string, number>();
  for (const document of indexed) {
    for (const term of document.terms) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const averageDocumentLength = indexed.reduce(
    (sum, document) => sum + document.documentLength,
    0,
  ) / Math.max(indexed.length, 1);

  function matchSkillCards(query: string) {
    return knowledge.wikiNodes
      .map((card) => ({ card, score: scoreCardMatch(query, card) }))
      .filter(({ score }) => score >= 4.5)
      .sort((left, right) => right.score - left.score || left.card.id.localeCompare(right.card.id));
  }

  function retrieve(query: string, limit = 6): EngineRetrievalHit[] {
    const normalizedQuery = normalizeRetrievalText(query);
    const originalTerms = lexicalTokens(query);
    const cardMatches = matchSkillCards(query).slice(0, 4);
    // A lexical coincidence is not enough for a mental-health answer. Runtime
    // plans inject a DBT skill anchor for guided cases; direct/clarify cases
    // need to match a skill alias or scenario hint before source retrieval.
    if (!originalTerms.length || !cardMatches.length) return [];

    const directCardIds = new Set(cardMatches.map(({ card }) => card.id));
    const relatedCardIds = new Set(cardMatches.flatMap(({ card }) => card.related));
    const namedPhrases = [...new Set(cardMatches.flatMap(({ card }) => [card.label, ...card.aliases])
      .map(normalizeRetrievalText)
      .filter((phrase) => phrase.length >= 2 && normalizedQuery.includes(phrase)))];
    const evidenceBoosts = new Map<string, number>();
    for (const { card, score: cardScore } of cardMatches) {
      for (const evidence of card.evidence) {
        evidenceBoosts.set(
          evidence.chunkId,
          Math.max(
            evidenceBoosts.get(evidence.chunkId) ?? 0,
            28 + Math.min(cardScore, 40) + evidence.retrievalWeight,
          ),
        );
      }
    }
    for (const card of knowledge.wikiNodes.filter((item) => relatedCardIds.has(item.id))) {
      for (const evidence of card.evidence.slice(0, 4)) {
        evidenceBoosts.set(
          evidence.chunkId,
          Math.max(evidenceBoosts.get(evidence.chunkId) ?? 0, 4 + evidence.retrievalWeight * 0.15),
        );
      }
    }

    const scored: EngineRetrievalHit[] = [];
    for (const document of indexed) {
      const { chunk, normalizedText, normalizedTitle, documentLength } = document;
      if (!chunk.sourceQuality.groundingEligible) continue;
      let score = evidenceBoosts.get(chunk.id) ?? 0;
      const matchedTerms: string[] = [];
      for (const term of originalTerms) {
        const textFrequency = Math.min(occurrences(normalizedText, term), 8);
        const titleFrequency = Math.min(occurrences(normalizedTitle, term), 3);
        const frequency = textFrequency + titleFrequency * 3;
        if (!frequency) continue;
        matchedTerms.push(term);
        const frequencyInCorpus = documentFrequency.get(term) ?? 0;
        const inverseDocumentFrequency = Math.log(
          1 + (indexed.length - frequencyInCorpus + 0.5) / (frequencyInCorpus + 0.5),
        );
        const lengthNormalization = 1.2 * (0.25 + 0.75 * (documentLength / averageDocumentLength));
        score += inverseDocumentFrequency * ((frequency * 2.2) / (frequency + lengthNormalization)) * 3;
      }
      // When the user names a skill or subskill, at least one source that
      // literally contains that phrase must outrank generic card evidence.
      // Skill cards navigate; they do not replace the book text.
      const exactNamedPhraseHits = namedPhrases.filter((phrase) => (
        normalizedText.includes(phrase) || normalizedTitle.includes(phrase)
      ));
      score += exactNamedPhraseHits.reduce((sum, phrase) => sum + 45 + Math.min(phrase.length * 4, 32), 0);
      if (normalizedQuery.length >= 4 && normalizedText.includes(normalizedQuery)) score += 20;

      const cardIds = new Set(chunk.skillCardIds);
      const directMatches = [...directCardIds].filter(
        (cardId) => cardIds.has(cardId) || cardEvidenceIds.get(cardId)?.has(chunk.id),
      );
      const relatedMatches = [...relatedCardIds].filter(
        (cardId) => cardIds.has(cardId) || cardEvidenceIds.get(cardId)?.has(chunk.id),
      );
      score += directMatches.length * 18 + relatedMatches.length * 2.5;
      if (chunk.sourceQuality.contentType === "handout") score += 6;
      if (chunk.sourceQuality.contentType === "trainer-note") score += 2;
      if (chunk.sourceQuality.contentType === "worksheet") score -= 1;
      if (chunk.sourceQuality.displayRole === "primary") score += 4;
      if (chunk.sourceQuality.displayRole === "index-only") score -= 10;
      score *= 0.72 + chunk.sourceQuality.score * 0.28;
      score *= 0.84 + chunk.sourceQuality.displayScore * 0.16;
      if (score < 2.2 || (!matchedTerms.length && !directMatches.length && !evidenceBoosts.has(chunk.id))) continue;

      scored.push({
        chunk,
        score: Math.round(score * 100) / 100,
        matchedTerms: [...new Set(matchedTerms)],
        matchedSkillCardIds: [...new Set([...directMatches, ...relatedMatches])],
        qualityScore: chunk.sourceQuality.score,
        parentBlock: parentBlocks.get(chunk.parentBlockId),
      });
    }
    scored.sort((left, right) => right.score - left.score || left.chunk.pdfPage - right.chunk.pdfPage);

    // Quality-first diversity: prefer distinct pages and avoid filling the
    // bundle with near-identical OCR from one two-page spread.
    const selected: EngineRetrievalHit[] = [];
    for (const hit of scored.slice(0, Math.max(limit * 14, 50))) {
      const sameNeighborhood = selected.some(
        (current) => current.chunk.sourceId === hit.chunk.sourceId &&
          Math.abs(current.chunk.pdfPage - hit.chunk.pdfPage) <= 1,
      );
      const addsNewCard = hit.matchedSkillCardIds.some(
        (cardId) => !selected.some((current) => current.matchedSkillCardIds.includes(cardId)),
      );
      if (!sameNeighborhood || addsNewCard || hit.score >= scored[0].score * 0.78) selected.push(hit);
      if (selected.length >= Math.min(limit, 24)) break;
    }
    return selected;
  }

  return { retrieve, matchSkillCards };
}
