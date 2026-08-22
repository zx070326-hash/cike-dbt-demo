import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cases = JSON.parse(await readFile(
  new URL("../data/eval/conversation-understanding-v1.json", import.meta.url),
  "utf8",
));

let workerPromise;

async function getWorker() {
  workerPromise ??= import(new URL("../dist/server/index.js", import.meta.url).href)
    .then((module) => module.default);
  return workerPromise;
}

async function chat(message, experienceMode, history = []) {
  const worker = await getWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ message, history, experienceMode }),
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
  assert.equal(response.status, 200, message);
  return response.json();
}

test("self-experience scope is high recall in both presentation modes", async () => {
  assert.ok(cases.selfExperience.length >= 30);
  for (const message of cases.selfExperience) {
    const [companion, deepRead] = await Promise.all([
      chat(message, "companion"),
      chat(message, "deep-read"),
    ]);
    for (const payload of [companion, deepRead]) {
      assert.equal(payload.kind, "answer", `${message}: ${JSON.stringify(payload)}`);
      assert.equal(payload.decision?.inputUnderstanding?.scope, "self-experience", message);
      assert.notEqual(payload.decision?.route, "out-of-scope", message);
      assert.notEqual(payload.refusalReason, "out-of-scope", message);
    }
    assert.equal(
      companion.decision.inputUnderstanding.scope,
      deepRead.decision.inputUnderstanding.scope,
      message,
    );
  }
});

test("third-party emotion words and unrelated objects do not impersonate user distress", async () => {
  assert.ok(cases.clearlyUnrelated.length >= 10);
  for (const message of cases.clearlyUnrelated) {
    const [companion, deepRead] = await Promise.all([
      chat(message, "companion"),
      chat(message, "deep-read"),
    ]);
    for (const payload of [companion, deepRead]) {
      assert.equal(payload.kind, "refusal", `${message}: ${JSON.stringify(payload)}`);
      assert.equal(payload.refusalReason, "out-of-scope", message);
      assert.equal(payload.decision?.inputUnderstanding?.scope, "clearly-unrelated", message);
      assert.equal(payload.decision?.route, "out-of-scope", message);
      assert.equal(payload.citations?.length ?? 0, 0, message);
    }
  }
});

test("a repeated self-experience after an unresolved reply recovers into clarification", async () => {
  const message = "我今天很焦躁";
  const payload = await chat(message, "deep-read", [
    { role: "user", content: message },
    {
      role: "assistant",
      content: "我暂时还没看出该从哪种 DBT 方法开始。这个体验版暂时回答不了。",
    },
  ]);
  assert.equal(payload.kind, "answer");
  assert.equal(payload.mode, "bridge");
  assert.equal(payload.decision.inputUnderstanding.scope, "self-experience");
  assert.ok(payload.decision.reasonCodes.includes("REPEATED_UNRESOLVED_INPUT"));
  assert.doesNotMatch(`${payload.title} ${payload.message}`, /回答不了|范围之外/u);
});

test("an exact repeated scope refusal does not return an identical card", async () => {
  const message = "请解释量子色动力学";
  const first = await chat(message, "deep-read");
  const firstText = [first.title, first.message, first.followUpQuestion].filter(Boolean).join(" ");
  const second = await chat(message, "deep-read", [
    { role: "user", content: message },
    { role: "assistant", content: firstText },
  ]);
  assert.equal(first.kind, "refusal");
  assert.equal(second.kind, "refusal");
  assert.notEqual(second.title, first.title);
  assert.notEqual(second.message, first.message);
  assert.match(`${second.title} ${second.message}`, /换个方式|没有接住/u);
});
