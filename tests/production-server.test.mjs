import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { startProdServer } from "../node_modules/vinext/dist/server/prod-server.js";

test("production server delivers the client JavaScript needed for interaction", async (t) => {
  const { server, port } = await startProdServer({
    port: 0,
    host: "127.0.0.1",
    outDir: path.resolve("dist"),
    purpose: "production asset regression test",
  });

  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));

  const homeResponse = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(homeResponse.status, 200);
  const html = await homeResponse.text();
  assert.doesNotMatch(html, /\/@vite\/client/u);

  const scriptPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/gu)]
    .map((match) => match[1]);
  assert.ok(scriptPaths.length > 0, "production HTML should reference client JavaScript");

  for (const scriptPath of new Set(scriptPaths)) {
    const scriptResponse = await fetch(`http://127.0.0.1:${port}${scriptPath}`);
    assert.equal(scriptResponse.status, 200, `${scriptPath} should be served`);
    assert.match(scriptResponse.headers.get("content-type") ?? "", /javascript/u);
    assert.ok((await scriptResponse.arrayBuffer()).byteLength > 100);
  }
});
