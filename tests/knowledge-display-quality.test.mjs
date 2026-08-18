import assert from "node:assert/strict";
import test from "node:test";

import knowledge from "../data/knowledge/knowledge-v2.json" with { type: "json" };

test("full-corpus knowledge separates retrieval eligibility from display quality", () => {
  assert.equal(knowledge.coverage.characterCoverage, 1);
  assert.equal(knowledge.coverage.chunkCount, 1189);
  assert.ok(knowledge.chunks.every((chunk) => ["primary", "supporting", "index-only"].includes(chunk.sourceQuality.displayRole)));
  assert.ok(knowledge.chunks.every((chunk) => Number.isFinite(chunk.sourceQuality.displayScore)));

  const mindfulnessHandout = knowledge.chunks.find((chunk) => chunk.sourceId === "dbt-handouts-lower" && chunk.pdfPage === 65);
  const mindfulnessWorksheet = knowledge.chunks.find((chunk) => chunk.sourceId === "dbt-handouts-lower" && chunk.pdfPage === 94);
  const previouslyTruncated = knowledge.chunks.find((chunk) => chunk.sourceId === "dbt-manual-upper" && chunk.pdfPage === 310);
  assert.equal(mindfulnessHandout?.sourceQuality.contentType, "handout");
  assert.equal(mindfulnessHandout?.sourceQuality.displayRole, "primary");
  assert.equal(mindfulnessWorksheet?.sourceQuality.displayRole, "supporting");
  assert.ok(mindfulnessWorksheet?.sourceQuality.displayIssues.includes("form-template"));
  assert.doesNotMatch(previouslyTruncated?.displaySection ?? "", /、\s*$/u);
});
