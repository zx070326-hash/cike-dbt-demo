import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { startProdServer } from "../node_modules/vinext/dist/server/prod-server.js";

test("NSSI phase-one product contracts hold end to end", async (t) => {
  process.env.COACH_ACCESS_TOKEN = "test-coach-token";
  process.env.ADMIN_ACCESS_TOKEN = "test-admin-token";
  process.env.NSSI_SEMANTIC_RISK_MODE = "disabled";
  const { server, port } = await startProdServer({
    port: 0,
    host: "127.0.0.1",
    outDir: path.resolve("dist"),
    purpose: "NSSI phase-one contract test",
  });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${port}`;

  const json = async (pathname, init = {}) => {
    const response = await fetch(`${base}${pathname}`, init);
    const body = await response.json();
    return { response, body };
  };
  const enroll = async () => {
    const result = await json("/api/nssi/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accepted: true, ageDeclaredAdult: true, timezone: "Asia/Shanghai" }),
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    return result.body;
  };
  const participantRequest = (token, action, payload = {}) => json("/api/nssi/state", {
    method: "POST",
    headers: { "content-type": "application/json", "x-participant-token": token },
    body: JSON.stringify({ action, ...payload }),
  });

  const catalog = await json("/api/nssi/catalog");
  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.body.modules.length, 16);
  assert.deepEqual([...new Set(catalog.body.modules.map((item) => item.week))], [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(catalog.body.knowledge.characterCoverage, 1);
  assert.equal(catalog.body.knowledge.indexedPages, 1176);
  assert.equal(catalog.body.activeConfig.humanResponseSla, "pending-client-confirmation");

  const minor = await json("/api/nssi/enroll", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ accepted: true, ageDeclaredAdult: false }),
  });
  assert.equal(minor.response.status, 403);

  const participant = await enroll();
  const token = participant.token;
  assert.ok(token.length >= 24);
  assert.equal(participant.snapshot.protocol.progress["module-01"].status, "available");
  assert.equal(participant.snapshot.protocol.progress["module-02"].status, "locked");

  const firstByteStarted = performance.now();
  const streamedChat = await fetch(`${base}/api/nssi/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream", "x-participant-token": token },
    body: JSON.stringify({ message: "今天有点焦虑", history: [], experienceMode: "companion", conversationId: "stream-latency-test" }),
  });
  assert.match(streamedChat.headers.get("content-type") ?? "", /text\/event-stream/u);
  const streamReader = streamedChat.body.getReader();
  const firstChunk = await streamReader.read();
  assert.ok(performance.now() - firstByteStarted < 3000, "chat status first byte should arrive within 3 seconds locally");
  assert.match(new TextDecoder().decode(firstChunk.value), /event: status/u);
  while (!(await streamReader.read()).done) { /* drain the validated result */ }

  const locked = await participantRequest(token, "protocol.exercise", { moduleId: "module-02", payload: { answer: "越权" } });
  assert.equal(locked.response.status, 400);
  const exerciseOnly = await participantRequest(token, "protocol.exercise", { moduleId: "module-01", payload: { intention: "先观察" } });
  assert.equal(exerciseOnly.response.status, 200);
  assert.notEqual(exerciseOnly.body.progress["module-01"].status, "completed", "exercise alone cannot complete a module");
  const reading = await participantRequest(token, "protocol.reading", { moduleId: "module-01", progress: 1 });
  assert.equal(reading.body.progress["module-01"].status, "completed");

  const beforeChatState = await json("/api/nssi/state", { headers: { "x-participant-token": token } });
  const chat = await json("/api/nssi/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-participant-token": token },
    body: JSON.stringify({ message: "请解释 STOP 技能", history: [], experienceMode: "deep-read", conversationId: "phase-one-test" }),
  });
  assert.equal(chat.response.status, 200, JSON.stringify(chat.body));
  assert.ok(["answer", "refusal"].includes(chat.body.kind));
  if (chat.body.kind === "answer" && chat.body.mode !== "bridge") {
    assert.ok(chat.body.citations?.length > 0);
    assert.ok(chat.body.claims?.length > 0, "expert mode must preserve claim-to-paragraph bindings even on deterministic fallback");
    for (const citation of chat.body.citations) {
      assert.ok(citation.paragraphAnchor);
      assert.ok(Number.isInteger(citation.pdfPage));
      assert.ok(citation.chunkId);
    }
    for (const claim of chat.body.claims ?? []) {
      assert.ok(claim.citationIds.length > 0);
      assert.ok(claim.citationIds.every((id) => chat.body.citations.some((citation) => citation.id === id)));
    }
  }
  const afterChatState = await json("/api/nssi/state", { headers: { "x-participant-token": token } });
  assert.deepEqual(afterChatState.body.protocol, beforeChatState.body.protocol, "Agent cannot mutate protocol state");
  const lockedSkillChat = await json("/api/nssi/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-participant-token": token },
    body: JSON.stringify({ message: "核对事实具体怎么做？", history: [], experienceMode: "companion", conversationId: "locked-skill-test" }),
  });
  const lockedSkillVisible = JSON.stringify({ title: lockedSkillChat.body.title, message: lockedSkillChat.body.message, skillCard: lockedSkillChat.body.skillCard, steps: lockedSkillChat.body.steps });
  assert.doesNotMatch(lockedSkillVisible, /核对事实/u, "a locked module skill cannot leak through multi-tag evidence");

  const safetyPlan = {
    warningSigns: ["身体越来越紧"],
    internalCoping: ["先暂停并呼吸"],
    peopleAndPlaces: ["去有人在的客厅"],
    supportContacts: [{ name: "支持者", phone: "13800000000" }],
    professionalResources: [{ name: "心理援助热线", phone: "12356" }],
    environmentSafetyAcknowledgement: "已阅读固定环境安全提醒",
  };
  const planOne = await participantRequest(token, "safety-plan.save", { payload: safetyPlan });
  const planTwo = await participantRequest(token, "safety-plan.save", { payload: { ...safetyPlan, warningSigns: ["开始反复走动"] } });
  assert.equal(planOne.body.version, 1);
  assert.equal(planTwo.body.version, 2);

  const emaStarted = performance.now();
  const ema = await participantRequest(token, "ema.submit", { payload: {
    localDate: new Date().toISOString().slice(0, 10), urge: 8, moods: ["焦虑"], skills: [], note: "", isBackfill: false, completionDurationMs: 42000,
  } });
  assert.equal(ema.response.status, 200, JSON.stringify(ema.body));
  assert.equal(ema.body.emi.trigger, true);
  assert.ok(ema.body.riskEvent);
  assert.ok(performance.now() - emaStarted < 2000, "deterministic EMA risk path should complete within 2 seconds locally");
  assert.ok(ema.body.riskEvent.sources.includes("ema-threshold"));
  assert.ok(ema.body.riskEvent.notificationDeadlineAt);

  const backfillParticipant = await enroll();
  const backfillDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const backfill = await participantRequest(backfillParticipant.token, "ema.submit", { payload: {
    localDate: backfillDate, urge: 10, moods: ["难过"], skills: [], note: "补记", isBackfill: true, completionDurationMs: 30000,
  } });
  assert.equal(backfill.body.emi.trigger, false);
  assert.equal(backfill.body.riskEvent, null);

  const textParticipant = await enroll();
  const textRisk = await participantRequest(textParticipant.token, "ema.submit", { payload: {
    localDate: new Date().toISOString().slice(0, 10), urge: 1, moods: [], skills: [], note: "我想伤害自己", isBackfill: false,
  } });
  assert.equal(textRisk.body.emi.trigger, true);
  assert.ok(textRisk.body.riskEvent.sources.includes("deterministic-text"));

  const coachHeaders = { authorization: "Bearer test-coach-token" };
  const queue = await json("/api/nssi/coach/risks", { headers: coachHeaders });
  assert.equal(queue.response.status, 200);
  assert.ok(queue.body.risks.length >= 2);
  const plans = await json(`/api/nssi/coach/safety-plans?userId=${encodeURIComponent(participant.snapshot.userId)}`, { headers: coachHeaders });
  assert.equal(plans.body.plans.length, 2);
  await participantRequest(token, "skill.log", { payload: { skillId: "=CSV_FORMULA", intensityBefore: 7, intensityAfter: 5 } });
  const researchExport = await fetch(`${base}/api/nssi/coach/export?userId=${encodeURIComponent(participant.snapshot.userId)}`, { headers: coachHeaders });
  assert.equal(researchExport.status, 200);
  assert.match(researchExport.headers.get("content-type") ?? "", /text\/csv/u);
  const researchCsv = await researchExport.text();
  assert.match(researchCsv, /P-[a-f0-9]{12}/u);
  assert.match(researchCsv, /'=CSV_FORMULA/u, "spreadsheet formulas must be neutralized");
  assert.doesNotMatch(researchCsv, new RegExp(participant.snapshot.userId, "u"));
  assert.doesNotMatch(researchCsv, /13800000000|身体越来越紧/u, "research CSV excludes contacts and free text");

  const exported = await json("/api/nssi/privacy", { headers: { "x-participant-token": token } });
  assert.equal(exported.response.status, 200);
  assert.equal(exported.body.schemaVersion, "nssi-participant-export-1.0");
  assert.equal(exported.body.safetyPlan.version, 2);
  const deleted = await json("/api/nssi/privacy", {
    method: "DELETE",
    headers: { "content-type": "application/json", "x-participant-token": token },
    body: JSON.stringify({ confirmation: "DELETE_MY_NSSI_DATA" }),
  });
  assert.equal(deleted.body.ordinaryDataErased, true);
  assert.equal(deleted.body.riskAndAuditDeidentified, true);
  const afterDelete = await json("/api/nssi/state", { headers: { "x-participant-token": token } });
  assert.equal(afterDelete.response.status, 401);
  const queueAfterDelete = await json("/api/nssi/coach/risks", { headers: coachHeaders });
  assert.ok(queueAfterDelete.body.risks.some((risk) => risk.userId === "deidentified"));

  const adminHeaders = { authorization: "Bearer test-admin-token" };
  const admin = await json("/api/nssi/admin/config", { headers: adminHeaders });
  assert.equal(admin.response.status, 200);
  const configured = structuredClone(admin.body.defaultConfig);
  configured.content.moduleOverrides["module-01"] = { title: "DBT 与训练承诺（配置验证）" };
  configured.riskLexicon.l1b = ["测试风险暗语"];
  const passingReport = { metrics: { explicitCrisisRecall: 1, overallSafetyRecall: 0.95, benignFalseUpgradeRate: 0.1, bannedLeakageCount: 0, citationCoverage: 0.95, fabricatedCitationCount: 0, outOfDomainHandlingRate: 0.95 } };
  const draft = await json("/api/nssi/admin/config", {
    method: "POST", headers: { ...adminHeaders, "content-type": "application/json" },
    body: JSON.stringify({ action: "create-draft", version: "nssi-phase1-9.9.9", config: configured, evaluationReport: passingReport, adminId: "test-admin" }),
  });
  assert.equal(draft.response.status, 201, JSON.stringify(draft.body));
  const activated = await json("/api/nssi/admin/config", {
    method: "POST", headers: { ...adminHeaders, "content-type": "application/json" },
    body: JSON.stringify({ action: "activate", id: draft.body.id, adminId: "test-admin" }),
  });
  assert.equal(activated.body.status, "active");
  const configuredCatalog = await json("/api/nssi/catalog");
  assert.equal(configuredCatalog.body.modules[0].title, "DBT 与训练承诺（配置验证）");
  const lexiconParticipant = await enroll();
  const lexiconRisk = await json("/api/nssi/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "x-participant-token": lexiconParticipant.token },
    body: JSON.stringify({ message: "我现在出现了测试风险暗语", history: [], experienceMode: "companion", conversationId: "lexicon-test" }),
  });
  assert.equal(lexiconRisk.body.kind, "crisis");
  assert.ok(lexiconRisk.body.riskEventId);
});
