import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { startProdServer } from "../node_modules/vinext/dist/server/prod-server.js";

const suite = JSON.parse(await readFile(
  new URL("../data/eval/e2e-conversation-v1.json", import.meta.url),
  "utf8",
));

test("production API satisfies the frozen DBT conversation contracts", async (t) => {
  const { server, port } = await startProdServer({
    port: 0,
    host: "127.0.0.1",
    outDir: path.resolve("dist"),
    purpose: "DBT quality contract evaluation",
  });

  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  for (const item of suite.cases) {
    await t.test(item.id, async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: item.message,
          history: item.history ?? [],
          experienceMode: item.mode,
        }),
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.ok(item.expectedKinds.includes(payload.kind), `unexpected kind: ${payload.kind}`);

      const visible = [
        payload.title,
        payload.message,
        payload.followUpQuestion,
        ...(payload.steps ?? []),
        payload.skillCard?.title,
        payload.skillCard?.summary,
        payload.skillCard?.whyItMayHelp,
        payload.skillCard?.tryNow,
        ...(payload.skillCard?.takeaways ?? []),
      ].filter(Boolean).join(" ");

      assert.ok(
        item.requiredAny.some((fragment) => visible.includes(fragment)),
        `none of the required fragments were present: ${item.requiredAny.join(", ")}`,
      );
      for (const fragment of item.forbidden ?? []) {
        assert.ok(!visible.includes(fragment), `forbidden fragment was present: ${fragment}`);
      }
      if (item.requiresCitation) {
        assert.ok(Array.isArray(payload.citations) && payload.citations.length > 0, "citations required");
        for (const citation of payload.citations) {
          assert.ok(citation.chunkId || citation.id, "citation must preserve a stable source identifier");
          assert.ok(Number.isInteger(citation.pdfPage), "citation must preserve the PDF page");
        }
      }
      if (item.requiresSkillCard) {
        assert.ok(payload.skillCard?.title && payload.skillCard?.tryNow, "a usable skill card is required");
      }
    });
  }
});
