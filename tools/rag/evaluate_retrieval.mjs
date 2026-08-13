import { readFile, writeFile } from "node:fs/promises";
import { createRetrievalEngine, normalizeRetrievalText } from "../../lib/retrieval/engine.ts";
import { planRetrieval } from "../../lib/retrieval/planner.ts";

const knowledge = JSON.parse(await readFile(new URL("../../data/knowledge/knowledge-v2.json", import.meta.url), "utf8"));
const cases = JSON.parse(await readFile(new URL("../../data/eval/retrieval-cases-v0.3.json", import.meta.url), "utf8"));
const engine = createRetrievalEngine(knowledge);

let routeCorrect = 0;
let cardCases = 0;
let cardRecall1 = 0;
let cardRecall3 = 0;
let cardRecall5 = 0;
let reciprocalRank = 0;
let evidenceCases = 0;
let evidenceRecall5 = 0;
let parentResolved = 0;
let traceable = 0;
let lowQuality = 0;
let returned = 0;
const details = [];

for (const item of cases) {
  const plan = planRetrieval(item.input);
  if (plan.route === item.expected_route) routeCorrect += 1;
  const retrievalQuery = plan.kind === "guided" ? plan.retrievalQuery : item.input;
  const hits = item.expected_card_ids.length || item.expected_terms.length
    ? engine.retrieve(retrievalQuery, 6)
    : [];

  const firstRank = item.expected_card_ids.length
    ? hits.findIndex((hit) => hit.matchedSkillCardIds.some((id) => item.expected_card_ids.includes(id))) + 1
    : 0;
  if (item.expected_card_ids.length) {
    cardCases += 1;
    if (firstRank === 1) cardRecall1 += 1;
    if (firstRank > 0 && firstRank <= 3) cardRecall3 += 1;
    if (firstRank > 0 && firstRank <= 5) cardRecall5 += 1;
    if (firstRank > 0) reciprocalRank += 1 / firstRank;
  }

  const evidence = normalizeRetrievalText(hits.slice(0, 5).map((hit) => `${hit.chunk.displaySection}\n${hit.chunk.text}`).join("\n"));
  const evidenceMatched = item.expected_terms.length
    ? item.expected_terms.some((term) => evidence.includes(normalizeRetrievalText(term)))
    : true;
  if (item.expected_terms.length) {
    evidenceCases += 1;
    if (evidenceMatched) evidenceRecall5 += 1;
  }
  for (const hit of hits) {
    returned += 1;
    if (hit.parentBlock?.sourceExact && hit.parentBlock.chunkIds.length) parentResolved += 1;
    if (
      hit.chunk.id && hit.chunk.sourceId && hit.chunk.pdfPage &&
      Number.isInteger(hit.chunk.charStart) && Number.isInteger(hit.chunk.charEnd)
    ) traceable += 1;
    if (hit.qualityScore < 0.65) lowQuality += 1;
  }
  details.push({
    id: item.id,
    input: item.input,
    expectedRoute: item.expected_route,
    actualRoute: plan.route,
    routeCorrect: plan.route === item.expected_route,
    expectedCardIds: item.expected_card_ids,
    firstExpectedCardRank: firstRank || null,
    evidenceMatched,
    topHits: hits.slice(0, 5).map((hit) => ({
      chunkId: hit.chunk.id,
      section: hit.chunk.displaySection,
      pdfPage: hit.chunk.pdfPage,
      score: hit.score,
      qualityScore: hit.qualityScore,
      matchedSkillCardIds: hit.matchedSkillCardIds,
    })),
  });
}

const ratio = (numerator, denominator) => denominator ? Math.round((numerator / denominator) * 10000) / 10000 : null;
const report = {
  schemaVersion: "1.0",
  generatedAt: new Date().toISOString(),
  knowledgeVersion: knowledge.schemaVersion,
  corpus: knowledge.coverage,
  caseCount: cases.length,
  metrics: {
    routeAccuracy: ratio(routeCorrect, cases.length),
    routeCorrect,
    cardCaseCount: cardCases,
    cardRecallAt1: ratio(cardRecall1, cardCases),
    cardRecallAt3: ratio(cardRecall3, cardCases),
    cardRecallAt5: ratio(cardRecall5, cardCases),
    cardMRR: ratio(reciprocalRank, cardCases),
    evidenceCaseCount: evidenceCases,
    evidenceTermRecallAt5: ratio(evidenceRecall5, evidenceCases),
    parentBlockResolutionRate: ratio(parentResolved, returned),
    sourceTraceabilityRate: ratio(traceable, returned),
    lowQualityPrimaryRate: ratio(lowQuality, returned),
  },
  failures: details.filter((item) => !item.routeCorrect || (item.expectedCardIds.length && !item.firstExpectedCardRank) || !item.evidenceMatched),
  details,
};

const outputUrl = new URL("../../data/eval/retrieval-quality-report-v0.3.json", import.meta.url);
await writeFile(outputUrl, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ output: outputUrl.pathname, ...report.metrics }, null, 2));
if (report.metrics.sourceTraceabilityRate !== 1 || report.metrics.parentBlockResolutionRate !== 1) process.exitCode = 1;
