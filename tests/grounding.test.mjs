import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../dist/server/index.js", import.meta.url);

test("grounding utilities are bundled in the production build", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(moduleUrl, "utf8"));
  assert.match(source, /missing_citation|claims_not_array/u);
});
