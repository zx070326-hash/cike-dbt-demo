import { createProtocolState, applyProtocolCommand, scheduledReleaseAt, type ProtocolCommand } from "./protocol-engine";
import { modulesById, nssiPhase1Modules } from "./curriculum";
import { createRiskEvent, decideEmaIntervention, effectiveSkills, validateEma, type EmaSubmission } from "./intervention-engine";
import { buildLearningFeedback, validateModuleExercisePayload, type SanitizedExercisePayload } from "./exercise-validation";
import { openJson, randomOpaqueToken, sealJson, sha256 } from "./crypto";
import { sendWebPush, type StoredPushSubscription } from "./web-push";
import { DEFAULT_PHASE1_PROMPTS, type Phase1PromptSet } from "./prompt-library";
import type {
  AuditEvent,
  EmaRecord,
  ModuleExerciseSummary,
  ParticipantSnapshot,
  ProtocolModule,
  ProtocolState,
  RiskEvent,
  ProductNotification,
  SafetyPlanSections,
  SafetyPlanVersion,
  SkillLog,
  PracticeStats,
  ConversationRetention,
  ConversationReview,
  ConversationReviewSource,
  ConversationTranscriptTurn,
} from "./types";
import {
  isPracticeOptionId,
  isSkillOutcomeId,
  isSkillTargetId,
  normalizePracticeOptionId,
} from "./skills";

type RuntimeEnv = {
  DB?: D1Database;
  DATA_ENCRYPTION_KEY?: string;
  NSSI_ALLOW_EPHEMERAL_STORE?: string;
  COACH_ACCESS_TOKEN?: string;
  ADMIN_ACCESS_TOKEN?: string;
  COACH_NOTIFICATION_WEBHOOK?: string;
  MODEL_PROVIDER?: string;
  MODEL_NAME?: string;
  WEB_PUSH_VAPID_PUBLIC_KEY?: string;
  WEB_PUSH_VAPID_PRIVATE_KEY?: string;
  WEB_PUSH_VAPID_SUBJECT?: string;
};

const runtimeGlobal = globalThis as typeof globalThis & { __NSSI_RUNTIME_ENV__?: RuntimeEnv };

type EphemeralParticipant = {
  id: string;
  subjectHash: string;
  ageDeclaredAdult: boolean;
  protocol: ProtocolState;
  ema: EmaRecord[];
  safetyPlans: SafetyPlanVersion[];
  skillLogs: SkillLog[];
  moduleExercises: Array<{ id: string; moduleId: string; exerciseId: string; payload: SanitizedExercisePayload; submittedAt: string }>;
  risks: RiskEvent[];
};

type EphemeralState = {
  participants: Map<string, EphemeralParticipant>;
  bySubjectHash: Map<string, string>;
  audits: AuditEvent[];
  chats: Array<{ userId: string; conversationId: string; mode: string; userMessage: string; assistantPayload: Record<string, unknown>; tokenEstimate: number; createdAt: string; expiresAt?: string }>;
  conversationReviews: Array<{ userId: string; review: ConversationReview }>;
  configs: Array<{ id: string; version: string; status: string; config: Record<string, unknown>; evaluationReport?: Record<string, unknown>; createdAt: string }>;
  notifications: ProductNotification[];
  pushSubscriptions: Array<{ id: string; userId: string; subscription: StoredPushSubscription; endpointHash: string; createdAt: string }>;
  deidentifiedRisks: RiskEvent[];
};

const globalStore = globalThis as typeof globalThis & { __nssiEphemeralStore?: EphemeralState };

function ephemeralState() {
  globalStore.__nssiEphemeralStore ??= {
    participants: new Map(),
    bySubjectHash: new Map(),
    audits: [],
    chats: [],
    conversationReviews: [],
    configs: [],
    notifications: [],
    pushSubscriptions: [],
    deidentifiedRisks: [],
  };
  return globalStore.__nssiEphemeralStore;
}

function runtimeEnv(): RuntimeEnv {
  const bound = runtimeGlobal.__NSSI_RUNTIME_ENV__ ?? {};
  return {
    ...bound,
    DATA_ENCRYPTION_KEY: bound.DATA_ENCRYPTION_KEY ?? process.env.DATA_ENCRYPTION_KEY,
    NSSI_ALLOW_EPHEMERAL_STORE: bound.NSSI_ALLOW_EPHEMERAL_STORE ?? process.env.NSSI_ALLOW_EPHEMERAL_STORE,
    COACH_ACCESS_TOKEN: bound.COACH_ACCESS_TOKEN ?? process.env.COACH_ACCESS_TOKEN,
    ADMIN_ACCESS_TOKEN: bound.ADMIN_ACCESS_TOKEN ?? process.env.ADMIN_ACCESS_TOKEN,
    COACH_NOTIFICATION_WEBHOOK: bound.COACH_NOTIFICATION_WEBHOOK ?? process.env.COACH_NOTIFICATION_WEBHOOK,
    MODEL_PROVIDER: bound.MODEL_PROVIDER ?? process.env.MODEL_PROVIDER,
    MODEL_NAME: bound.MODEL_NAME ?? process.env.MODEL_NAME,
    WEB_PUSH_VAPID_PUBLIC_KEY: bound.WEB_PUSH_VAPID_PUBLIC_KEY ?? process.env.WEB_PUSH_VAPID_PUBLIC_KEY,
    WEB_PUSH_VAPID_PRIVATE_KEY: bound.WEB_PUSH_VAPID_PRIVATE_KEY ?? process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
    WEB_PUSH_VAPID_SUBJECT: bound.WEB_PUSH_VAPID_SUBJECT ?? process.env.WEB_PUSH_VAPID_SUBJECT,
  };
}

function webPushConfig() {
  const environment = runtimeEnv();
  const publicKey = environment.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = environment.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() ?? "";
  const subject = environment.WEB_PUSH_VAPID_SUBJECT?.trim() ?? "";
  return {
    configured: Boolean(publicKey && privateKey && /^(?:mailto:|https:\/\/)/u.test(subject)),
    publicKey,
    privateKey,
    subject,
  };
}

export function pushDeliveryConfig() {
  const config = webPushConfig();
  return { configured: config.configured, publicKey: config.configured ? config.publicKey : "" };
}

function riskNotificationState(at: string) {
  return {
    status: "sent",
    channel: "in-product-risk-queue",
    sentAt: at,
    externalWebhook: runtimeEnv().COACH_NOTIFICATION_WEBHOOK ? "scheduled" : "not-configured",
    targetSeconds: 60,
  };
}

async function dispatchRiskWebhook(risk: RiskEvent, pseudonym: string, db: D1Database | undefined | null) {
  const webhook = runtimeEnv().COACH_NOTIFICATION_WEBHOOK;
  let externalStatus = "not-configured";
  let externalLatencyMs: number | null = null;
  if (webhook) {
    const startedAt = performance.now();
    try {
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "nssi-risk-event",
          eventId: risk.id,
          pseudonym,
          level: risk.level,
          sources: risk.sources,
          createdAt: risk.createdAt,
          dashboardPath: "/coach",
        }),
        signal: AbortSignal.timeout(800),
      });
      externalStatus = response.ok ? "sent" : `http-${response.status}`;
    } catch {
      externalStatus = "failed";
    }
    externalLatencyMs = Math.round(performance.now() - startedAt);
    if (db) {
      await db.prepare("UPDATE risk_events SET notification_state_json = ? WHERE id = ?")
        .bind(JSON.stringify({ ...riskNotificationState(risk.createdAt), externalWebhook: externalStatus, externalLatencyMs }), risk.id)
        .run();
    }
  }
  await appendAudit({
    actorId: "risk-notifier",
    actorRole: "system",
    eventType: "risk.notification_dispatched",
    targetType: "risk_event",
    targetId: risk.id,
    occurredAt: new Date().toISOString(),
    metadata: {
      channel: "in-product-risk-queue",
      queueLatencyMs: Math.max(0, Date.now() - Date.parse(risk.createdAt)),
      externalStatus,
      externalLatencyMs,
      targetSeconds: 60,
    },
  }, db ?? undefined);
}

function encryptionSecret() {
  const secret = runtimeEnv().DATA_ENCRYPTION_KEY;
  if (secret) return { value: secret, keyVersion: "env-v1", productionReady: true };
  // Keeps local evaluation operational while making the unsafe state explicit
  // in health/config responses. Production release gates reject this version.
  return {
    value: "internal-development-only-nssi-key-do-not-use-in-production",
    keyVersion: "insecure-dev-v1",
    productionReady: false,
  };
}

function shanghaiUtcAt(baseDate: Date, dayOffset: number, localHour: number, localMinute = 0) {
  const local = new Date(baseDate.getTime() + 8 * 60 * 60 * 1000);
  return new Date(Date.UTC(
    local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset,
    localHour - 8, localMinute, 0,
  )).toISOString();
}

function initialScheduledJobs(userId: string, enrollmentAt: string, config: Phase1Config) {
  const enrolled = new Date(enrollmentAt);
  const [emaHour, emaMinute] = config.ema.dailyLocalTime.split(":").map(Number);
  const moduleJobs = modulesWithConfig(config).map((module) => ({
    id: crypto.randomUUID(),
    userId,
    kind: "module-release",
    scheduledFor: scheduledReleaseAt(enrollmentAt, module.id, config.release.days),
    payload: { moduleId: module.id, title: module.title },
    templateVersion: "module-reminder-v1",
  }));
  const emaJobs = Array.from({ length: 56 }, (_, index) => ({
    id: crypto.randomUUID(), userId, kind: "ema-reminder",
    scheduledFor: shanghaiUtcAt(enrolled, index, emaHour, emaMinute), payload: { localDayOffset: index }, templateVersion: "ema-reminder-v1",
  }));
  const inactivityChecks = Array.from({ length: 8 }, (_, index) => ({
    id: crypto.randomUUID(), userId, kind: "inactivity-check",
    scheduledFor: shanghaiUtcAt(enrolled, config.reminders.inactivityDays + index * 7, 10), payload: { inactivityDays: config.reminders.inactivityDays }, templateVersion: config.reminders.templateVersion,
  }));
  return [...moduleJobs, ...emaJobs, ...inactivityChecks];
}

function d1Database() {
  return runtimeEnv().DB;
}

async function eventHash(previousHash: string | null, event: Omit<AuditEvent, "id">) {
  return sha256(`${previousHash ?? "GENESIS"}\n${JSON.stringify(event)}`);
}

async function appendAudit(
  event: Omit<AuditEvent, "id">,
  db = d1Database(),
) {
  const id = crypto.randomUUID();
  if (!db) {
    ephemeralState().audits.push({ id, ...event });
    return;
  }
  const previous = await db.prepare("SELECT event_hash FROM audit_events ORDER BY created_at DESC, id DESC LIMIT 1").first<{ event_hash: string }>();
  const hash = await eventHash(previous?.event_hash ?? null, event);
  await db.prepare(
    "INSERT INTO audit_events (id, actor_id, actor_role, event_type, target_type, target_id, metadata_json, previous_hash, event_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    id,
    event.actorId,
    event.actorRole,
    event.eventType,
    event.targetType,
    event.targetId,
    JSON.stringify(event.metadata),
    previous?.event_hash ?? null,
    hash,
    event.occurredAt,
  ).run();
}

async function subjectHash(token: string) {
  return sha256(`nssi-participant:${token}`);
}

export function storageReadiness() {
  const environment = runtimeEnv();
  const encryption = encryptionSecret();
  return {
    persistent: Boolean(environment.DB),
    encryptionReady: encryption.productionReady,
    participantStore: environment.DB ? "cloudflare-d1" : "ephemeral-development",
    productionReady: Boolean(environment.DB) && encryption.productionReady,
    pushConfigured: webPushConfig().configured,
    riskWebhookConfigured: Boolean(environment.COACH_NOTIFICATION_WEBHOOK),
  };
}

export async function enrollParticipant(input: {
  ageDeclaredAdult: boolean;
  timezone?: string;
  policyVersion: string;
  monitoringDisclosureVersion: string;
}) {
  if (!input.ageDeclaredAdult) throw new Error("PHASE1_ADULTS_ONLY");
  const token = randomOpaqueToken();
  const hash = await subjectHash(token);
  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const activeConfig = await getActivePhase1Config();
  const protocol = createProtocolState(
    now,
    input.timezone ?? "Asia/Shanghai",
    activeConfig.config.release.days as [string, string],
  );
  const db = d1Database();

  if (!db) {
    const state = ephemeralState();
    state.participants.set(userId, {
      id: userId,
      subjectHash: hash,
      ageDeclaredAdult: true,
      protocol,
      ema: [],
      safetyPlans: [],
      skillLogs: [],
      moduleExercises: [],
      risks: [],
    });
    state.bySubjectHash.set(hash, userId);
  } else {
    const stateJson = JSON.stringify(protocol);
    const scheduled = initialScheduledJobs(userId, now, activeConfig.config);
    await db.batch([
      db.prepare("INSERT INTO users (id, external_subject_hash, age_declared_adult, timezone, monitoring_disclosure_version, created_at) VALUES (?, ?, 1, ?, ?, ?)")
        .bind(userId, hash, input.timezone ?? "Asia/Shanghai", input.monitoringDisclosureVersion, now),
      db.prepare("INSERT INTO consents (id, user_id, policy_kind, policy_version, accepted_at) VALUES (?, ?, 'participant-and-ai-monitoring', ?, ?)")
        .bind(crypto.randomUUID(), userId, input.policyVersion, now),
      db.prepare("INSERT INTO protocol_states (user_id, schema_version, protocol_version, state_json, state_sha256, updated_at) VALUES (?, '1.0', 'nssi-phase1-0.1', ?, ?, ?)")
        .bind(userId, stateJson, await sha256(stateJson), now),
      ...scheduled.map((job) => db.prepare(
        "INSERT INTO scheduled_jobs (id, user_id, kind, scheduled_for, payload_json, template_version, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
      ).bind(job.id, job.userId, job.kind, job.scheduledFor, JSON.stringify(job.payload), job.templateVersion, now)),
    ]);
  }
  await appendAudit({
    actorId: userId,
    actorRole: "participant",
    eventType: "participant.enrolled",
    targetType: "user",
    targetId: userId,
    occurredAt: now,
    metadata: { policyVersion: input.policyVersion, monitoringDisclosureVersion: input.monitoringDisclosureVersion, configVersion: activeConfig.version },
  }, db);
  return { token, snapshot: await getParticipantSnapshot(token) };
}

async function resolveParticipant(token: string) {
  if (!token || token.length < 24) throw new Error("UNAUTHENTICATED");
  const hash = await subjectHash(token);
  const db = d1Database();
  if (!db) {
    const state = ephemeralState();
    const id = state.bySubjectHash.get(hash);
    const participant = id ? state.participants.get(id) : undefined;
    if (!participant) throw new Error("UNAUTHENTICATED");
    return { db: null, id: participant.id, participant };
  }
  const user = await db.prepare(
    "SELECT id, deleted_at, age_declared_adult FROM users WHERE external_subject_hash = ? LIMIT 1",
  ).bind(hash).first<{ id: string; deleted_at: string | null; age_declared_adult: number }>();
  if (!user || user.deleted_at || !user.age_declared_adult) throw new Error("UNAUTHENTICATED");
  return { db, id: user.id, participant: null };
}

function validatePushSubscription(value: unknown): StoredPushSubscription {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("PUSH_SUBSCRIPTION_INVALID");
  const input = value as Record<string, unknown>;
  const keys = typeof input.keys === "object" && input.keys !== null && !Array.isArray(input.keys)
    ? input.keys as Record<string, unknown>
    : {};
  const endpoint = typeof input.endpoint === "string" ? input.endpoint.trim() : "";
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh.trim() : "";
  const auth = typeof keys.auth === "string" ? keys.auth.trim() : "";
  let parsed: URL;
  try { parsed = new URL(endpoint); } catch { throw new Error("PUSH_ENDPOINT_INVALID"); }
  if (parsed.protocol !== "https:" || endpoint.length > 2000) throw new Error("PUSH_ENDPOINT_INVALID");
  if (!/^[A-Za-z0-9_-]{40,200}$/u.test(p256dh) || !/^[A-Za-z0-9_-]{16,100}$/u.test(auth)) throw new Error("PUSH_KEYS_INVALID");
  const expirationTime = input.expirationTime === null || input.expirationTime === undefined
    ? null
    : Number(input.expirationTime);
  if (expirationTime !== null && (!Number.isFinite(expirationTime) || expirationTime < Date.now())) throw new Error("PUSH_EXPIRATION_INVALID");
  return { endpoint, expirationTime, keys: { p256dh, auth } };
}

export async function registerPushSubscription(token: string, value: unknown, userAgent?: string) {
  const resolved = await resolveParticipant(token);
  if (!webPushConfig().configured) throw new Error("PUSH_NOT_CONFIGURED");
  const subscription = validatePushSubscription(value);
  const endpointHash = await sha256(subscription.endpoint);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  if (!resolved.db) {
    const state = ephemeralState();
    state.pushSubscriptions = state.pushSubscriptions.filter((item) => item.endpointHash !== endpointHash);
    state.pushSubscriptions.push({ id, userId: resolved.id, subscription, endpointHash, createdAt: now });
  } else {
    const encryption = encryptionSecret();
    await resolved.db.prepare(
      "INSERT INTO push_subscriptions (id, user_id, endpoint_hash, subscription_ciphertext, key_version, user_agent, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?) ON CONFLICT(endpoint_hash) DO UPDATE SET user_id = excluded.user_id, subscription_ciphertext = excluded.subscription_ciphertext, key_version = excluded.key_version, user_agent = excluded.user_agent, status = 'active', updated_at = excluded.updated_at, last_error = NULL",
    ).bind(
      id,
      resolved.id,
      endpointHash,
      await sealJson(subscription, encryption.value),
      encryption.keyVersion,
      userAgent?.slice(0, 300) ?? null,
      now,
      now,
    ).run();
  }
  await appendAudit({
    actorId: resolved.id,
    actorRole: "participant",
    eventType: "push.subscription_registered",
    targetType: "push_subscription",
    targetId: id,
    occurredAt: now,
    metadata: { endpointOrigin: new URL(subscription.endpoint).origin },
  }, resolved.db ?? undefined);
  return { ok: true, configured: true, subscribed: true };
}

export async function removePushSubscription(token: string, endpoint: string) {
  const resolved = await resolveParticipant(token);
  const endpointHash = await sha256(endpoint.trim());
  const at = new Date().toISOString();
  if (!resolved.db) {
    ephemeralState().pushSubscriptions = ephemeralState().pushSubscriptions.filter((item) => !(item.userId === resolved.id && item.endpointHash === endpointHash));
  } else {
    await resolved.db.prepare("UPDATE push_subscriptions SET status = 'revoked', updated_at = ? WHERE user_id = ? AND endpoint_hash = ?")
      .bind(at, resolved.id, endpointHash).run();
  }
  await appendAudit({ actorId: resolved.id, actorRole: "participant", eventType: "push.subscription_revoked", targetType: "push_subscription", targetId: null, occurredAt: at, metadata: {} }, resolved.db ?? undefined);
  return { ok: true, subscribed: false };
}

async function readProtocol(db: D1Database, userId: string) {
  const row = await db.prepare("SELECT state_json FROM protocol_states WHERE user_id = ?").bind(userId).first<{ state_json: string }>();
  if (!row) throw new Error("PROTOCOL_STATE_MISSING");
  return JSON.parse(row.state_json) as ProtocolState;
}

async function readLatestSafetyPlan(db: D1Database, userId: string) {
  const row = await db.prepare(
    "SELECT id, version, payload_ciphertext, created_by_role, content_review_version, created_at FROM safety_plan_versions WHERE user_id = ? ORDER BY version DESC LIMIT 1",
  ).bind(userId).first<{
    id: string; version: number; payload_ciphertext: string; created_by_role: "participant" | "coach"; content_review_version: string; created_at: string;
  }>();
  if (!row) return null;
  return {
    id: row.id,
    userId,
    version: row.version,
    sections: await openJson<SafetyPlanSections>(row.payload_ciphertext, encryptionSecret().value),
    createdAt: row.created_at,
    createdBy: row.created_by_role,
    contentReviewVersion: row.content_review_version,
  } satisfies SafetyPlanVersion;
}

function parseJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

async function readRecentEma(db: D1Database, userId: string) {
  const result = await db.prepare(
    "SELECT id, local_date, urge, moods_json, skills_json, is_backfill, completion_duration_ms, risk_evaluation_json, submitted_at FROM ema_records WHERE user_id = ? AND deleted_at IS NULL ORDER BY submitted_at DESC LIMIT 30",
  ).bind(userId).all<Record<string, string | number>>();
  return result.results.map((row) => ({
    id: String(row.id),
    userId,
    localDate: String(row.local_date),
    submittedAt: String(row.submitted_at),
    urge: Number(row.urge),
    moods: parseJsonArray(String(row.moods_json)),
    skills: parseJsonArray(String(row.skills_json)),
    isBackfill: Boolean(row.is_backfill),
    completionDurationMs: row.completion_duration_ms === null || row.completion_duration_ms === undefined ? undefined : Number(row.completion_duration_ms),
    riskEvaluation: JSON.parse(String(row.risk_evaluation_json)),
  })) as EmaRecord[];
}

async function readSkillLogs(db: D1Database, userId: string) {
  const result = await db.prepare(
    "SELECT id, skill_id, skill_ids_json, intensity_before, intensity_after, target_type, outcomes_json, note_ciphertext, used_at FROM skill_logs WHERE user_id = ? AND deleted_at IS NULL ORDER BY used_at DESC LIMIT 30",
  ).bind(userId).all<Record<string, string | number>>();
  const encryption = encryptionSecret();
  return Promise.all(result.results.map(async (row) => {
    const privateFields = row.note_ciphertext
      ? await openJson<{ note?: string; targetCustom?: string }>(String(row.note_ciphertext), encryption.value)
      : {};
    return {
      id: String(row.id), userId, skillId: String(row.skill_id), usedAt: String(row.used_at),
      skillIds: (() => {
        const parsed = parseJsonArray(String(row.skill_ids_json ?? "[]")).map(normalizePracticeOptionId).filter(isPracticeOptionId);
        return parsed.length ? [...new Set(parsed)] : [normalizePracticeOptionId(String(row.skill_id))];
      })(),
      intensityBefore: Number(row.intensity_before), intensityAfter: Number(row.intensity_after),
      targetType: row.target_type ? String(row.target_type) : undefined,
      targetCustom: privateFields.targetCustom,
      outcomes: parseJsonArray(String(row.outcomes_json ?? "[]")).filter(isSkillOutcomeId),
      note: privateFields.note,
    } satisfies SkillLog;
  }));
}

function summarizePracticeStats(logs: SkillLog[], at = new Date().toISOString()): PracticeStats {
  const recentBoundary = Date.parse(at) - 7 * 24 * 60 * 60 * 1000;
  const changes = logs.map((log) => log.intensityBefore - log.intensityAfter);
  return {
    totalSessions: logs.length,
    sessionsLast7Days: logs.filter((log) => Date.parse(log.usedAt) >= recentBoundary).length,
    averageIntensityChange: changes.length ? Math.round((changes.reduce((sum, value) => sum + value, 0) / changes.length) * 10) / 10 : null,
    improvedSessions: changes.filter((value) => value > 0).length,
    unchangedSessions: changes.filter((value) => value === 0).length,
    worsenedSessions: changes.filter((value) => value < 0).length,
  };
}

async function readPracticeStats(db: D1Database, userId: string): Promise<PracticeStats> {
  const boundary = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const row = await db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN used_at >= ? THEN 1 ELSE 0 END) AS recent_7,
      AVG(intensity_before - intensity_after) AS average_change,
      SUM(CASE WHEN intensity_before > intensity_after THEN 1 ELSE 0 END) AS improved,
      SUM(CASE WHEN intensity_before = intensity_after THEN 1 ELSE 0 END) AS unchanged,
      SUM(CASE WHEN intensity_before < intensity_after THEN 1 ELSE 0 END) AS worsened
    FROM skill_logs WHERE user_id = ? AND deleted_at IS NULL
  `).bind(boundary, userId).first<Record<string, string | number | null>>();
  const total = Number(row?.total ?? 0);
  return {
    totalSessions: total,
    sessionsLast7Days: Number(row?.recent_7 ?? 0),
    averageIntensityChange: total ? Math.round(Number(row?.average_change ?? 0) * 10) / 10 : null,
    improvedSessions: Number(row?.improved ?? 0),
    unchangedSessions: Number(row?.unchanged ?? 0),
    worsenedSessions: Number(row?.worsened ?? 0),
  };
}

function summarizeExercise(
  id: string,
  moduleId: string,
  exerciseId: string,
  payload: SanitizedExercisePayload,
  submittedAt: string,
): ModuleExerciseSummary {
  const curriculumModule = modulesById.get(moduleId);
  const answers = curriculumModule?.exercise.fields.flatMap((field) => {
    const raw = payload[field.id];
    if (raw === undefined) return [];
    const value = Array.isArray(raw) ? raw.join("、") : String(raw);
    return [{ fieldId: field.id, label: field.label, value: value.slice(0, 180) }];
  }) ?? [];
  return {
    id,
    moduleId,
    moduleTitle: curriculumModule?.title ?? moduleId,
    exerciseId,
    submittedAt,
    answers,
  };
}

async function readRecentModuleExercises(db: D1Database, userId: string) {
  const result = await db.prepare(
    "SELECT id, module_id, exercise_id, payload_ciphertext, submitted_at FROM module_submissions WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 3",
  ).bind(userId).all<Record<string, string>>();
  const encryption = encryptionSecret();
  return Promise.all(result.results.map(async (row) => summarizeExercise(
    String(row.id),
    String(row.module_id),
    String(row.exercise_id),
    await openJson<SanitizedExercisePayload>(String(row.payload_ciphertext), encryption.value),
    String(row.submitted_at),
  )));
}

function rowToRisk(row: Record<string, string | number | null>): RiskEvent {
  return {
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : "deidentified",
    level: String(row.level) as RiskEvent["level"],
    sources: parseJsonArray(String(row.sources_json)) as RiskEvent["sources"],
    status: String(row.status) as RiskEvent["status"],
    createdAt: String(row.created_at),
    notificationDeadlineAt: row.notification_deadline_at ? String(row.notification_deadline_at) : undefined,
    humanSlaDeadlineAt: row.human_sla_deadline_at ? String(row.human_sla_deadline_at) : undefined,
    acknowledgedAt: row.acknowledged_at ? String(row.acknowledged_at) : undefined,
    participantMarkedSafeAt: row.participant_marked_safe_at ? String(row.participant_marked_safe_at) : undefined,
    closedAt: row.closed_at ? String(row.closed_at) : undefined,
    closedBy: row.closed_by ? String(row.closed_by) : undefined,
    deidentifiedAt: row.deidentified_at ? String(row.deidentified_at) : undefined,
  };
}

const conversationRetentions: ConversationRetention[] = ["summary-only", "7-days", "30-days", "keep"];

function normalizeConversationRetention(value: unknown): ConversationRetention {
  return conversationRetentions.includes(value as ConversationRetention) ? value as ConversationRetention : "summary-only";
}

function rawConversationExpiry(retention: ConversationRetention, from = new Date()) {
  if (retention === "keep" || retention === "summary-only") return undefined;
  const days = retention === "7-days" ? 7 : 30;
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}

function compactConversationText(value: unknown, limit: number) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, limit) : "";
}

function conversationTitle(message: string) {
  const compact = compactConversationText(message, 40);
  if (!compact) return "一次对话回顾";
  return compact.length < message.replace(/\s+/gu, " ").trim().length ? `${compact}…` : compact;
}

function reviewSources(payload: Record<string, unknown>): ConversationReviewSource[] {
  if (!Array.isArray(payload.citations)) return [];
  return payload.citations.slice(0, 6).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const source = raw as Record<string, unknown>;
    const chunkId = compactConversationText(source.chunkId, 160);
    const evidence = compactConversationText(source.evidence, 600);
    const pdfPage = Number(source.pdfPage);
    if (!chunkId || !evidence || !Number.isInteger(pdfPage) || pdfPage < 1) return [];
    return [{
      chunkId,
      book: compactConversationText(source.book, 120) || "DBT 资料",
      section: compactConversationText(source.section, 180) || "相关段落",
      pdfPage,
      printedPage: Number.isInteger(Number(source.printedPage)) && Number(source.printedPage) > 0 ? Number(source.printedPage) : undefined,
      paragraphAnchor: compactConversationText(source.paragraphAnchor, 180) || undefined,
      evidence,
    }];
  });
}

type ConversationReviewPayload = Pick<ConversationReview,
  "title" | "userFocus" | "assistantTakeaway" | "followUpQuestion" | "skillId" | "skillLabel" |
  "nextAction" | "sources" | "exchangeCount"
>;

function nextConversationReview(
  existing: ConversationReviewPayload | null,
  userMessage: string,
  assistantPayload: Record<string, unknown>,
): ConversationReviewPayload {
  const skillCard = assistantPayload.skillCard && typeof assistantPayload.skillCard === "object"
    ? assistantPayload.skillCard as Record<string, unknown>
    : null;
  const latestSources = reviewSources(assistantPayload);
  return {
    title: existing?.title || conversationTitle(userMessage),
    userFocus: compactConversationText(userMessage, 180),
    assistantTakeaway: compactConversationText(assistantPayload.message, 420) || compactConversationText(assistantPayload.title, 180),
    followUpQuestion: compactConversationText(assistantPayload.followUpQuestion, 180) || undefined,
    skillId: compactConversationText(skillCard?.id, 100) || existing?.skillId,
    skillLabel: compactConversationText(skillCard?.title, 120) || existing?.skillLabel,
    nextAction: assistantPayload.nextAction === "practice" ? "practice" : "none",
    sources: latestSources.length ? latestSources : existing?.sources ?? [],
    exchangeCount: (existing?.exchangeCount ?? 0) + 1,
  };
}

async function readConversationReviews(db: D1Database, userId: string, limit = 12): Promise<ConversationReview[]> {
  const result = await db.prepare(
    `SELECT s.*,
      EXISTS(SELECT 1 FROM chat_messages c WHERE c.user_id = s.user_id AND c.conversation_id = s.conversation_id AND c.deleted_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > ?)) AS raw_available
     FROM session_summaries s
     WHERE s.user_id = ? AND s.conversation_id IS NOT NULL AND s.deleted_at IS NULL
     ORDER BY s.updated_at DESC LIMIT ?`,
  ).bind(new Date().toISOString(), userId, limit).all<Record<string, string | number | null>>();
  const encryption = encryptionSecret();
  return Promise.all(result.results.map(async (row) => {
    const payload = await openJson<ConversationReviewPayload>(String(row.payload_ciphertext), encryption.value);
    return {
      id: String(row.id),
      conversationId: String(row.conversation_id),
      ...payload,
      rawRetention: normalizeConversationRetention(row.raw_retention),
      rawExpiresAt: row.raw_expires_at ? String(row.raw_expires_at) : undefined,
      rawAvailable: Number(row.raw_available) > 0,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }));
}

export async function getParticipantSnapshot(token: string): Promise<ParticipantSnapshot & { recentEma: EmaRecord[] }> {
  const resolved = await resolveParticipant(token);
  if (!resolved.db && resolved.participant) {
    const participant = resolved.participant;
    return {
      userId: participant.id,
      protocol: participant.protocol,
      todayEma: participant.ema[0] ?? null,
      recentEma: participant.ema.slice(0, 30),
      safetyPlan: participant.safetyPlans.at(-1) ?? null,
      recentSkillLogs: participant.skillLogs.slice(0, 30),
      practiceStats: summarizePracticeStats(participant.skillLogs),
      recentModuleExercises: (participant.moduleExercises ?? []).slice(0, 3).map((item) => summarizeExercise(
        item.id, item.moduleId, item.exerciseId, item.payload, item.submittedAt,
      )),
      recentConversationReviews: ephemeralState().conversationReviews
        .filter((item) => item.userId === participant.id)
        .map((item) => ({
          ...item.review,
          rawAvailable: item.review.rawRetention !== "summary-only" && ephemeralState().chats.some((chat) => chat.userId === participant.id && chat.conversationId === item.review.conversationId),
        }))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 12),
      activeRiskEvent: participant.risks.find((risk) => risk.status !== "closed") ?? null,
      notifications: ephemeralState().notifications.filter((item) => item.userId === participant.id).slice(0, 10),
      push: {
        supported: true,
        configured: webPushConfig().configured,
        subscribed: ephemeralState().pushSubscriptions.some((item) => item.userId === participant.id),
      },
    };
  }
  const db = resolved.db!;
  const [protocol, ema, safetyPlan, skillLogs, practiceStats, moduleExercises, conversationReviews, riskRow, notificationRows, pushRow] = await Promise.all([
    readProtocol(db, resolved.id),
    readRecentEma(db, resolved.id),
    readLatestSafetyPlan(db, resolved.id),
    readSkillLogs(db, resolved.id),
    readPracticeStats(db, resolved.id),
    readRecentModuleExercises(db, resolved.id),
    readConversationReviews(db, resolved.id),
    db.prepare("SELECT * FROM risk_events WHERE user_id = ? AND status != 'closed' ORDER BY created_at DESC LIMIT 1")
      .bind(resolved.id).first<Record<string, string | number | null>>(),
    db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 10")
      .bind(resolved.id).all<Record<string, string | number | null>>(),
    db.prepare("SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id = ? AND status = 'active'")
      .bind(resolved.id).first<{ count: number }>(),
  ]);
  return {
    userId: resolved.id,
    protocol,
    todayEma: ema[0] ?? null,
    recentEma: ema,
    safetyPlan,
    recentSkillLogs: skillLogs,
    practiceStats,
    recentModuleExercises: moduleExercises,
    recentConversationReviews: conversationReviews,
    activeRiskEvent: riskRow ? rowToRisk(riskRow) : null,
    notifications: notificationRows.results.map((row) => ({
      id: String(row.id), userId: resolved.id, kind: String(row.kind) as ProductNotification["kind"],
      title: String(row.title), body: String(row.body), templateVersion: String(row.template_version),
      createdAt: String(row.created_at), readAt: row.read_at ? String(row.read_at) : undefined,
    })),
    push: {
      supported: true,
      configured: webPushConfig().configured,
      subscribed: Number(pushRow?.count ?? 0) > 0,
    },
  };
}

export async function updateProtocol(token: string, command: ProtocolCommand) {
  const resolved = await resolveParticipant(token);
  const current = resolved.participant?.protocol ?? await readProtocol(resolved.db!, resolved.id);
  const next = applyProtocolCommand(current, command);
  if (resolved.participant) {
    resolved.participant.protocol = next;
  } else {
    const stateJson = JSON.stringify(next);
    await resolved.db!.prepare(
      "UPDATE protocol_states SET state_json = ?, state_sha256 = ?, updated_at = ? WHERE user_id = ?",
    ).bind(stateJson, await sha256(stateJson), next.updatedAt, resolved.id).run();
  }
  await appendAudit({
    actorId: resolved.id, actorRole: "participant", eventType: `protocol.${command.type}`,
    targetType: "protocol_state", targetId: resolved.id, occurredAt: next.updatedAt,
    metadata: { moduleId: "moduleId" in command ? command.moduleId : null },
  }, resolved.db ?? undefined);
  return next;
}

export async function submitModuleExercise(token: string, moduleId: string, payload: unknown) {
  const resolved = await resolveParticipant(token);
  const activeConfig = await getActivePhase1Config();
  const curriculumModule = modulesWithConfig(activeConfig.config).find((item) => item.id === moduleId);
  if (!curriculumModule) throw new Error("MODULE_NOT_FOUND");
  const current = resolved.participant?.protocol ?? await readProtocol(resolved.db!, resolved.id);
  if (current.progress[moduleId]?.status === "locked") throw new Error("MODULE_LOCKED");
  const sanitizedPayload = validateModuleExercisePayload(curriculumModule, payload);
  if (moduleId === "module-03") {
    const expectedVersion = Number(sanitizedPayload.safetyPlanVersion);
    const latestPlan = resolved.participant?.safetyPlans.at(-1) ?? await readLatestSafetyPlan(resolved.db!, resolved.id);
    if (!latestPlan || latestPlan.version !== expectedVersion) throw new Error("SAFETY_PLAN_VERSION_MISMATCH");
  }
  const next = applyProtocolCommand(current, { type: "submit-exercise", moduleId });
  const submissionId = crypto.randomUUID();
  const submittedAt = next.progress[moduleId].exerciseSubmittedAt ?? new Date().toISOString();
  if (resolved.participant) {
    resolved.participant.protocol = next;
    resolved.participant.moduleExercises ??= [];
    resolved.participant.moduleExercises.unshift({
      id: submissionId,
      moduleId,
      exerciseId: curriculumModule.exercise.id,
      payload: sanitizedPayload,
      submittedAt,
    });
  } else {
    const encryption = encryptionSecret();
    const stateJson = JSON.stringify(next);
    await resolved.db!.batch([
      resolved.db!.prepare(
        "INSERT INTO module_submissions (id, user_id, module_id, module_version, exercise_id, payload_ciphertext, key_version, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(
        submissionId,
        resolved.id,
        moduleId,
        curriculumModule.contentVersion,
        curriculumModule.exercise.id,
        await sealJson(sanitizedPayload, encryption.value),
        encryption.keyVersion,
        submittedAt,
      ),
      resolved.db!.prepare(
        "UPDATE protocol_states SET state_json = ?, state_sha256 = ?, updated_at = ? WHERE user_id = ?",
      ).bind(stateJson, await sha256(stateJson), next.updatedAt, resolved.id),
    ]);
  }
  await appendAudit({
    actorId: resolved.id,
    actorRole: "participant",
    eventType: "module.exercise_submitted",
    targetType: "module_submission",
    targetId: submissionId,
    occurredAt: submittedAt,
    metadata: { moduleId, moduleVersion: curriculumModule.contentVersion, exerciseId: curriculumModule.exercise.id },
  }, resolved.db ?? undefined);
  return {
    ...next,
    learningFeedback: buildLearningFeedback(curriculumModule),
    submission: summarizeExercise(submissionId, moduleId, curriculumModule.exercise.id, sanitizedPayload, submittedAt),
  };
}

export type EmaRiskSignals = {
  deterministicTriggered?: boolean;
  semanticTriggered?: boolean;
  semanticLevel?: "suspected" | "high" | "imminent";
  semanticStatus?: string;
  semanticLatencyMs?: number;
};

export async function submitEma(
  token: string,
  input: Omit<EmaSubmission, "userId">,
  threshold = 7,
  signals: EmaRiskSignals = {},
  generateSelfReminder?: (input: {
    skillId: string;
    intensityBefore: number;
    intensityAfter: number;
    outcomes: string[];
    fallback: string;
  }) => Promise<string | null>,
) {
  const resolved = await resolveParticipant(token);
  const submission: EmaSubmission = {
    ...input,
    moods: [...new Set(input.moods)],
    skills: [...new Set(input.skills.map(normalizePracticeOptionId))],
    userId: resolved.id,
  };
  validateEma(submission);
  const submittedAt = new Date(input.submittedAt ?? Date.now()).toISOString();
  const textTriggered = Boolean(signals.deterministicTriggered || signals.semanticTriggered);
  let decision = decideEmaIntervention(submission, threshold, textTriggered);
  if (decision.intervention === "stop") {
    const logs = resolved.participant?.skillLogs ?? await readSkillLogs(resolved.db!, resolved.id);
    const priorHelpful = effectiveSkills(logs, 3).find((item) => item.averageIntensityChange > 0 && item.negativeReports === 0);
    if (priorHelpful) {
      const latest = logs.find((item) => (item.skillIds?.length ? item.skillIds : [item.skillId]).includes(priorHelpful.skillId));
      const fallback = latest
        ? `你之前记录过：使用这个方法后，强度从 ${latest.intensityBefore} 降到 ${latest.intensityAfter}。可以先照当时的做法重复一次，再看看有没有变化。`
        : "你以前记录过这个方法带来过一点变化。可以先重复一次，再观察现在有没有不同。";
      const generated = latest && generateSelfReminder
        ? await generateSelfReminder({
            skillId: priorHelpful.skillId,
            intensityBefore: latest.intensityBefore,
            intensityAfter: latest.intensityAfter,
            outcomes: latest.outcomes,
            fallback,
          }).catch(() => null)
        : null;
      decision = {
        ...decision,
        intervention: "self-reminder",
        fallbackTemplateId: "emi-personal-history-v1",
        reasonCodes: [...decision.reasonCodes, "PRIOR_RECORDED_HELPFUL_SKILL"],
        suggestedSkillId: priorHelpful.skillId,
        personalizedMessage: generated ?? fallback,
        personalizationStatus: generated ? "agent-generated" : "template-fallback",
      };
    }
  }
  const thresholdTriggered = !submission.isBackfill && submission.urge >= threshold;
  const sources = [
    ...(thresholdTriggered ? ["ema-threshold" as const] : []),
    ...(!submission.isBackfill && signals.deterministicTriggered ? ["deterministic-text" as const] : []),
    ...(!submission.isBackfill && signals.semanticTriggered ? ["semantic-text" as const] : []),
  ];
  const riskLevel = signals.semanticLevel === "imminent"
    ? "imminent"
    : signals.deterministicTriggered || signals.semanticLevel === "high" || submission.urge >= 9
      ? "high"
      : decision.level;
  const riskConfig = await getActivePhase1Config();
  const risk = decision.trigger && riskLevel && sources.length
    ? createRiskEvent(resolved.id, sources, riskLevel, submittedAt, riskConfig.config.crisis.humanResponseSlaMinutes)
    : null;
  const record: EmaRecord = {
    ...submission,
    id: input.id ?? crypto.randomUUID(),
    submittedAt,
    riskEvaluation: {
      threshold,
      thresholdTriggered,
      semanticTriggered: Boolean(!submission.isBackfill && signals.semanticTriggered),
      riskEventId: risk?.id,
    },
  };
  if (resolved.participant) {
    resolved.participant.ema = [record, ...resolved.participant.ema.filter((item) => item.localDate !== record.localDate)];
    if (risk) resolved.participant.risks.unshift(risk);
  } else {
    const encryption = encryptionSecret();
    const noteCiphertext = record.note ? await sealJson({ note: record.note }, encryption.value) : null;
    const statements = [
      resolved.db!.prepare(
        "INSERT INTO ema_records (id, user_id, local_date, urge, moods_json, skills_json, note_ciphertext, key_version, is_backfill, completion_duration_ms, threshold_version, risk_evaluation_json, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'nssi-threshold-0.1', ?, ?) ON CONFLICT(user_id, local_date) DO UPDATE SET urge = excluded.urge, moods_json = excluded.moods_json, skills_json = excluded.skills_json, note_ciphertext = excluded.note_ciphertext, key_version = excluded.key_version, is_backfill = excluded.is_backfill, completion_duration_ms = excluded.completion_duration_ms, risk_evaluation_json = excluded.risk_evaluation_json, submitted_at = excluded.submitted_at",
      ).bind(record.id, resolved.id, record.localDate, record.urge, JSON.stringify(record.moods), JSON.stringify(record.skills), noteCiphertext, noteCiphertext ? encryption.keyVersion : null, record.isBackfill ? 1 : 0, record.completionDurationMs ?? null, JSON.stringify(record.riskEvaluation), submittedAt),
    ];
    if (risk) statements.push(resolved.db!.prepare(
      "INSERT INTO risk_events (id, user_id, participant_pseudonym, level, sources_json, status, notification_state_json, created_at, notification_deadline_at, human_sla_deadline_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)",
    ).bind(risk.id, resolved.id, `参与者-${resolved.id.slice(0, 6)}`, risk.level, JSON.stringify(risk.sources), JSON.stringify(riskNotificationState(submittedAt)), submittedAt, risk.notificationDeadlineAt, risk.humanSlaDeadlineAt));
    await resolved.db!.batch(statements);
  }
  await appendAudit({
    actorId: resolved.id, actorRole: "participant", eventType: "ema.submitted", targetType: "ema_record", targetId: record.id,
    occurredAt: submittedAt, metadata: {
      urge: record.urge,
      isBackfill: record.isBackfill,
      riskEventCreated: Boolean(risk),
      riskSources: risk?.sources ?? [],
      semanticStatus: signals.semanticStatus ?? "not-run",
      semanticLatencyMs: signals.semanticLatencyMs ?? null,
      completionDurationMs: record.completionDurationMs ?? null,
    },
  }, resolved.db ?? undefined);
  if (risk) await dispatchRiskWebhook(risk, `参与者-${resolved.id.slice(0, 6)}`, resolved.db);
  return { record, emi: decision, riskEvent: risk };
}

export async function recordEmiAction(
  token: string,
  action: "displayed" | "step-viewed" | "contact-opened" | "safety-plan-opened" | "closed" | "marked-supported",
  metadata: Record<string, unknown> = {},
) {
  const allowed = new Set(["displayed", "step-viewed", "contact-opened", "safety-plan-opened", "closed", "marked-supported"]);
  if (!allowed.has(action)) throw new Error("EMI_EVENT_INVALID");
  const resolved = await resolveParticipant(token);
  const occurredAt = new Date().toISOString();
  await appendAudit({
    actorId: resolved.id,
    actorRole: "participant",
    eventType: `emi.${action}`,
    targetType: "emi_session",
    targetId: typeof metadata.sessionId === "string" ? metadata.sessionId : null,
    occurredAt,
    metadata: Object.fromEntries(Object.entries(metadata).filter(([, value]) => (
      typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null
    ))),
  }, resolved.db ?? undefined);
  return { ok: true, occurredAt };
}

function validateSafetyPlan(sections: SafetyPlanSections) {
  if (!sections.warningSigns.length || !sections.internalCoping.length || !sections.supportContacts.length) {
    throw new Error("SAFETY_PLAN_REQUIRED_SECTIONS_MISSING");
  }
  if (sections.environmentSafetyAcknowledgement.length > 500) throw new Error("SAFETY_PLAN_ENVIRONMENT_FIELD_TOO_LONG");
}

export async function saveSafetyPlan(token: string, sections: SafetyPlanSections, createdBy: "participant" | "coach" = "participant") {
  validateSafetyPlan(sections);
  const resolved = await resolveParticipant(token);
  const now = new Date().toISOString();
  let version = (resolved.participant?.safetyPlans.at(-1)?.version ?? 0) + 1;
  if (resolved.db) {
    const row = await resolved.db.prepare("SELECT MAX(version) AS version FROM safety_plan_versions WHERE user_id = ?")
      .bind(resolved.id).first<{ version: number | null }>();
    version = Number(row?.version ?? 0) + 1;
  }
  const plan: SafetyPlanVersion = {
    id: crypto.randomUUID(), userId: resolved.id, version, sections, createdAt: now, createdBy,
    contentReviewVersion: "environment-safety-clinical-template-pending-v1",
  };
  if (resolved.participant) {
    resolved.participant.safetyPlans.push(plan);
  } else {
    const encryption = encryptionSecret();
    await resolved.db!.prepare(
      "INSERT INTO safety_plan_versions (id, user_id, version, payload_ciphertext, key_version, created_by_role, content_review_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(plan.id, resolved.id, version, await sealJson(sections, encryption.value), encryption.keyVersion, createdBy, plan.contentReviewVersion, now).run();
  }
  await appendAudit({
    actorId: resolved.id, actorRole: createdBy, eventType: "safety_plan.version_created", targetType: "safety_plan", targetId: plan.id,
    occurredAt: now, metadata: { version },
  }, resolved.db ?? undefined);
  return plan;
}

export async function logSkill(
  token: string,
  input: Omit<SkillLog, "id" | "userId" | "usedAt" | "skillId"> & { skillId?: string; usedAt?: string },
) {
  const resolved = await resolveParticipant(token);
  for (const value of [input.intensityBefore, input.intensityAfter]) {
    if (!Number.isInteger(value) || value < 0 || value > 10) throw new Error("SKILL_LOG_INTENSITY_INVALID");
  }
  const skillIds = [...new Set((input.skillIds?.length ? input.skillIds : input.skillId ? [input.skillId] : [])
    .map(normalizePracticeOptionId))];
  if (!skillIds.length || skillIds.length > 8 || skillIds.some((value) => !isPracticeOptionId(value))) {
    throw new Error("SKILL_LOG_SKILLS_INVALID");
  }
  const targetType = input.targetType?.trim() || undefined;
  if (targetType && !isSkillTargetId(targetType)) throw new Error("SKILL_LOG_TARGET_INVALID");
  const targetCustom = input.targetCustom?.trim() || undefined;
  if ((targetCustom?.length ?? 0) > 80) throw new Error("SKILL_LOG_CUSTOM_TARGET_TOO_LONG");
  const outcomes = [...new Set(input.outcomes ?? [])];
  if (!outcomes.length || outcomes.length > 4 || outcomes.some((value) => !isSkillOutcomeId(value))) {
    throw new Error("SKILL_LOG_OUTCOMES_INVALID");
  }
  if ((input.note?.length ?? 0) > 300) throw new Error("SKILL_LOG_NOTE_TOO_LONG");
  const log: SkillLog = {
    ...input,
    id: crypto.randomUUID(),
    userId: resolved.id,
    skillId: skillIds[0],
    skillIds,
    targetType,
    targetCustom,
    outcomes,
    usedAt: new Date(input.usedAt ?? Date.now()).toISOString(),
  };
  if (resolved.participant) {
    resolved.participant.skillLogs.unshift(log);
  } else {
    const encryption = encryptionSecret();
    const noteCiphertext = log.note || log.targetCustom
      ? await sealJson({ note: log.note, targetCustom: log.targetCustom }, encryption.value)
      : null;
    await resolved.db!.prepare(
      "INSERT INTO skill_logs (id, user_id, skill_id, skill_ids_json, intensity_before, intensity_after, target_type, outcomes_json, note_ciphertext, key_version, used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(log.id, resolved.id, log.skillId, JSON.stringify(log.skillIds), log.intensityBefore, log.intensityAfter, log.targetType ?? null, JSON.stringify(log.outcomes), noteCiphertext, noteCiphertext ? encryption.keyVersion : null, log.usedAt).run();
  }
  await appendAudit({
    actorId: resolved.id, actorRole: "participant", eventType: "skill.logged", targetType: "skill_log", targetId: log.id,
    occurredAt: log.usedAt,
    metadata: {
      skillIds: log.skillIds,
      targetType: log.targetType,
      outcomes: log.outcomes,
      intensityBefore: log.intensityBefore,
      intensityAfter: log.intensityAfter,
    },
  }, resolved.db ?? undefined);
  return log;
}

export async function createHelpRisk(token: string) {
  const resolved = await resolveParticipant(token);
  const active = await getActivePhase1Config();
  const risk = createRiskEvent(resolved.id, ["help-button"], "high", new Date().toISOString(), active.config.crisis.humanResponseSlaMinutes);
  if (resolved.participant) {
    resolved.participant.risks.unshift(risk);
  } else {
    await resolved.db!.prepare(
      "INSERT INTO risk_events (id, user_id, participant_pseudonym, level, sources_json, status, notification_state_json, created_at, notification_deadline_at, human_sla_deadline_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)",
    ).bind(risk.id, resolved.id, `参与者-${resolved.id.slice(0, 6)}`, risk.level, JSON.stringify(risk.sources), JSON.stringify(riskNotificationState(risk.createdAt)), risk.createdAt, risk.notificationDeadlineAt, risk.humanSlaDeadlineAt).run();
  }
  await appendAudit({
    actorId: resolved.id, actorRole: "participant", eventType: "risk.help_button", targetType: "risk_event", targetId: risk.id,
    occurredAt: risk.createdAt, metadata: { level: risk.level },
  }, resolved.db ?? undefined);
  await dispatchRiskWebhook(risk, `参与者-${resolved.id.slice(0, 6)}`, resolved.db);
  return risk;
}

export async function createTextRisk(
  token: string,
  source: "deterministic-text" | "semantic-text",
  level: RiskEvent["level"] = "high",
) {
  const resolved = await resolveParticipant(token);
  const active = await getActivePhase1Config();
  const risk = createRiskEvent(resolved.id, [source], level, new Date().toISOString(), active.config.crisis.humanResponseSlaMinutes);
  if (resolved.participant) {
    resolved.participant.risks.unshift(risk);
  } else {
    await resolved.db!.prepare(
      "INSERT INTO risk_events (id, user_id, participant_pseudonym, level, sources_json, status, notification_state_json, created_at, notification_deadline_at, human_sla_deadline_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)",
    ).bind(
      risk.id,
      resolved.id,
      `参与者-${resolved.id.slice(0, 6)}`,
      risk.level,
      JSON.stringify(risk.sources),
      JSON.stringify(riskNotificationState(risk.createdAt)),
      risk.createdAt,
      risk.notificationDeadlineAt,
      risk.humanSlaDeadlineAt,
    ).run();
  }
  await appendAudit({
    actorId: "risk-classifier", actorRole: "system", eventType: `risk.${source}`,
    targetType: "risk_event", targetId: risk.id, occurredAt: risk.createdAt,
    metadata: { userId: resolved.id, level, source },
  }, resolved.db ?? undefined);
  await dispatchRiskWebhook(risk, `参与者-${resolved.id.slice(0, 6)}`, resolved.db);
  return risk;
}

export async function recordChatExchange(token: string, input: {
  conversationId: string;
  userMessage: string;
  assistantPayload: Record<string, unknown>;
  mode: string;
  latencyMs: number;
  validator: Record<string, unknown>;
  tokenUsage: { estimatedTotalTokens: number; accountingMethod: "conservative-estimate" | "provider-reported" };
  promptVersion: string;
  rawRetention?: ConversationRetention;
}) {
  const resolved = await resolveParticipant(token);
  const now = new Date().toISOString();
  const assistantAt = new Date(Date.parse(now) + 1).toISOString();
  const userMessageId = crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();
  const retention = normalizeConversationRetention(input.rawRetention);
  const rawExpiresAt = rawConversationExpiry(retention);
  if (!resolved.db) {
    const state = ephemeralState();
    const existingIndex = state.conversationReviews.findIndex((item) => item.userId === resolved.id && item.review.conversationId === input.conversationId);
    const existing = existingIndex >= 0 ? state.conversationReviews[existingIndex].review : null;
    const payload = nextConversationReview(existing, input.userMessage, input.assistantPayload);
    const review: ConversationReview = {
      id: existing?.id ?? crypto.randomUUID(),
      conversationId: input.conversationId,
      ...payload,
      rawRetention: retention,
      rawExpiresAt,
      rawAvailable: retention !== "summary-only",
      createdAt: existing?.createdAt ?? now,
      updatedAt: assistantAt,
    };
    if (existingIndex >= 0) state.conversationReviews[existingIndex] = { userId: resolved.id, review };
    else state.conversationReviews.push({ userId: resolved.id, review });
    if (retention === "summary-only") {
      state.chats = state.chats.filter((item) => item.userId !== resolved.id || item.conversationId !== input.conversationId);
    } else {
      state.chats.push({
        userId: resolved.id,
        conversationId: input.conversationId,
        mode: input.mode,
        userMessage: input.userMessage,
        assistantPayload: input.assistantPayload,
        tokenEstimate: input.tokenUsage.estimatedTotalTokens,
        createdAt: assistantAt,
        expiresAt: rawExpiresAt,
      });
    }
  }
  if (resolved.db) {
    const encryption = encryptionSecret();
    const provider = runtimeEnv().MODEL_PROVIDER ?? "openai-compatible";
    const model = runtimeEnv().MODEL_NAME ?? "deterministic-fallback";
    const citations = Array.isArray(input.assistantPayload.citations) ? input.assistantPayload.citations : [];
    const claims = Array.isArray(input.assistantPayload.claims) ? input.assistantPayload.claims : [];
    const existingRow = await resolved.db.prepare(
      "SELECT id, payload_ciphertext, created_at FROM session_summaries WHERE user_id = ? AND conversation_id = ? AND deleted_at IS NULL LIMIT 1",
    ).bind(resolved.id, input.conversationId).first<Record<string, string | number | null>>();
    const existingPayload = existingRow
      ? await openJson<ConversationReviewPayload>(String(existingRow.payload_ciphertext), encryption.value)
      : null;
    const nextPayload = nextConversationReview(existingPayload, input.userMessage, input.assistantPayload);
    const reviewId = existingRow ? String(existingRow.id) : crypto.randomUUID();
    const sealedReview = await sealJson(nextPayload, encryption.value);
    if (existingRow) {
      await resolved.db.prepare(
        "UPDATE session_summaries SET goal_code = 'conversation-recap', selected_skill_id = ?, payload_ciphertext = ?, key_version = ?, raw_retention = ?, raw_expires_at = ?, updated_at = ? WHERE id = ? AND user_id = ?",
      ).bind(nextPayload.skillId ?? null, sealedReview, encryption.keyVersion, retention, rawExpiresAt ?? null, assistantAt, reviewId, resolved.id).run();
    } else {
      await resolved.db.prepare(
        "INSERT INTO session_summaries (id, user_id, conversation_id, goal_code, selected_skill_id, payload_ciphertext, key_version, raw_retention, raw_expires_at, created_at, updated_at) VALUES (?, ?, ?, 'conversation-recap', ?, ?, ?, ?, ?, ?, ?)",
      ).bind(reviewId, resolved.id, input.conversationId, nextPayload.skillId ?? null, sealedReview, encryption.keyVersion, retention, rawExpiresAt ?? null, now, assistantAt).run();
    }
    if (retention === "summary-only") {
      await resolved.db.prepare("DELETE FROM chat_messages WHERE user_id = ? AND conversation_id = ?")
        .bind(resolved.id, input.conversationId).run();
    } else {
      await resolved.db.batch([
        resolved.db.prepare(
          "INSERT INTO chat_messages (id, user_id, conversation_id, role, message_ciphertext, key_version, mode, citations_json, claims_json, validator_json, prompt_version, model_provider, model_name, latency_ms, created_at, expires_at) VALUES (?, ?, ?, 'user', ?, ?, ?, '[]', '[]', '{}', ?, ?, ?, NULL, ?, ?)",
        ).bind(
          userMessageId, resolved.id, input.conversationId,
          await sealJson({ message: input.userMessage }, encryption.value), encryption.keyVersion, input.mode,
          input.promptVersion, provider, model, now, rawExpiresAt ?? null,
        ),
        resolved.db.prepare(
          "INSERT INTO chat_messages (id, user_id, conversation_id, role, message_ciphertext, key_version, mode, citations_json, claims_json, validator_json, prompt_version, model_provider, model_name, token_usage_json, latency_ms, created_at, expires_at) VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(
          assistantMessageId, resolved.id, input.conversationId,
          await sealJson(input.assistantPayload, encryption.value), encryption.keyVersion, input.mode,
          JSON.stringify(citations), JSON.stringify(claims), JSON.stringify(input.validator),
          input.promptVersion, provider, model, JSON.stringify(input.tokenUsage), input.latencyMs, assistantAt, rawExpiresAt ?? null,
        ),
      ]);
    }
  }
  await appendAudit({
    actorId: resolved.id, actorRole: "participant", eventType: "agent.turn_completed", targetType: "conversation_review", targetId: input.conversationId,
    occurredAt: assistantAt, metadata: {
      conversationId: input.conversationId,
      mode: input.mode,
      latencyMs: input.latencyMs,
      promptVersion: input.promptVersion,
      validator: input.validator,
      tokenUsage: input.tokenUsage,
      rawRetention: retention,
    },
  }, resolved.db ?? undefined);
}

function assistantTranscriptText(payload: Record<string, unknown>) {
  const steps = Array.isArray(payload.steps) ? payload.steps.filter((item): item is string => typeof item === "string") : [];
  return [payload.title, payload.message, ...steps, payload.followUpQuestion]
    .map((item) => compactConversationText(item, 600))
    .filter(Boolean)
    .join("\n");
}

export async function listConversationReviews(token: string, limit = 20) {
  const resolved = await resolveParticipant(token);
  if (!resolved.db) {
    return ephemeralState().conversationReviews
      .filter((item) => item.userId === resolved.id)
      .map((item) => ({
        ...item.review,
        rawAvailable: item.review.rawRetention !== "summary-only" && ephemeralState().chats.some((chat) => chat.userId === resolved.id && chat.conversationId === item.review.conversationId),
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, Math.min(50, Math.max(1, limit)));
  }
  return readConversationReviews(resolved.db, resolved.id, Math.min(50, Math.max(1, limit)));
}

export async function getConversationDetail(token: string, conversationId: string): Promise<{ review: ConversationReview; transcript: ConversationTranscriptTurn[] }> {
  if (!conversationId || conversationId.length > 100) throw new Error("CONVERSATION_ID_INVALID");
  const resolved = await resolveParticipant(token);
  if (!resolved.db) {
    const stored = ephemeralState().conversationReviews.find((item) => item.userId === resolved.id && item.review.conversationId === conversationId);
    if (!stored) throw new Error("CONVERSATION_NOT_FOUND");
    const transcript = ephemeralState().chats
      .filter((item) => item.userId === resolved.id && item.conversationId === conversationId && (!item.expiresAt || item.expiresAt > new Date().toISOString()))
      .flatMap((item) => [
        { id: `${item.createdAt}-user`, role: "user" as const, content: item.userMessage, createdAt: item.createdAt },
        { id: `${item.createdAt}-assistant`, role: "assistant" as const, content: assistantTranscriptText(item.assistantPayload), createdAt: item.createdAt },
      ]);
    return { review: { ...stored.review, rawAvailable: transcript.length > 0 }, transcript };
  }
  const reviews = await readConversationReviews(resolved.db, resolved.id, 50);
  const review = reviews.find((item) => item.conversationId === conversationId);
  if (!review) throw new Error("CONVERSATION_NOT_FOUND");
  const result = await resolved.db.prepare(
    "SELECT id, role, message_ciphertext, created_at FROM chat_messages WHERE user_id = ? AND conversation_id = ? AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at ASC LIMIT 200",
  ).bind(resolved.id, conversationId, new Date().toISOString()).all<Record<string, string | number | null>>();
  const encryption = encryptionSecret();
  const transcript = await Promise.all(result.results.map(async (row) => {
    const payload = await openJson<Record<string, unknown>>(String(row.message_ciphertext), encryption.value);
    const role = String(row.role) === "user" ? "user" as const : "assistant" as const;
    const content = compactConversationText(payload.content ?? payload.message, 2000) || (role === "assistant" ? assistantTranscriptText(payload) : "");
    return { id: String(row.id), role, content, createdAt: String(row.created_at) };
  }));
  return { review: { ...review, rawAvailable: transcript.length > 0 }, transcript: transcript.filter((item) => item.content) };
}

type TranscriptInput = Array<{ role: "user" | "assistant"; content: string }>;

function normalizeTranscript(value: unknown): TranscriptInput {
  if (!Array.isArray(value)) return [];
  return value.slice(-60).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    const role = item.role === "user" ? "user" as const : item.role === "assistant" ? "assistant" as const : null;
    const content = compactConversationText(item.content, 2000);
    return role && content ? [{ role, content }] : [];
  });
}

export async function updateConversationRetention(token: string, input: {
  conversationId: string;
  retention: ConversationRetention;
  transcript?: unknown;
}) {
  if (!input.conversationId || input.conversationId.length > 100) throw new Error("CONVERSATION_ID_INVALID");
  const retention = normalizeConversationRetention(input.retention);
  const expiresAt = rawConversationExpiry(retention);
  const transcript = normalizeTranscript(input.transcript);
  const resolved = await resolveParticipant(token);
  const now = new Date().toISOString();
  if (!resolved.db) {
    const state = ephemeralState();
    const stored = state.conversationReviews.find((item) => item.userId === resolved.id && item.review.conversationId === input.conversationId);
    if (!stored) throw new Error("CONVERSATION_NOT_FOUND");
    stored.review = { ...stored.review, rawRetention: retention, rawExpiresAt: expiresAt, rawAvailable: retention !== "summary-only" && transcript.length > 0, updatedAt: now };
    state.chats = state.chats.filter((item) => item.userId !== resolved.id || item.conversationId !== input.conversationId);
    if (retention !== "summary-only") {
      for (let index = 0; index < transcript.length; index += 1) {
        const turn = transcript[index];
        if (turn.role !== "user") continue;
        const assistant = transcript.slice(index + 1).find((item) => item.role === "assistant");
        state.chats.push({ userId: resolved.id, conversationId: input.conversationId, mode: "participant-archive", userMessage: turn.content, assistantPayload: { message: assistant?.content ?? "" }, tokenEstimate: 0, createdAt: now, expiresAt });
      }
    }
  } else {
    const row = await resolved.db.prepare(
      "SELECT id FROM session_summaries WHERE user_id = ? AND conversation_id = ? AND deleted_at IS NULL LIMIT 1",
    ).bind(resolved.id, input.conversationId).first<{ id: string }>();
    if (!row) throw new Error("CONVERSATION_NOT_FOUND");
    await resolved.db.prepare(
      "UPDATE session_summaries SET raw_retention = ?, raw_expires_at = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    ).bind(retention, expiresAt ?? null, now, row.id, resolved.id).run();
    await resolved.db.prepare("DELETE FROM chat_messages WHERE user_id = ? AND conversation_id = ?")
      .bind(resolved.id, input.conversationId).run();
    if (retention !== "summary-only" && transcript.length) {
      const encryption = encryptionSecret();
      const statements = await Promise.all(transcript.map(async (turn, index) => resolved.db!.prepare(
        "INSERT INTO chat_messages (id, user_id, conversation_id, role, message_ciphertext, key_version, mode, citations_json, claims_json, validator_json, prompt_version, model_provider, model_name, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'participant-archive', '[]', '[]', '{}', 'archive-v1', 'none', 'none', ?, ?)",
      ).bind(
        crypto.randomUUID(), resolved.id, input.conversationId, turn.role,
        await sealJson({ content: turn.content }, encryption.value), encryption.keyVersion,
        new Date(Date.parse(now) + index).toISOString(), expiresAt ?? null,
      )));
      await resolved.db.batch(statements);
    }
  }
  await appendAudit({ actorId: resolved.id, actorRole: "participant", eventType: "conversation.retention_updated", targetType: "conversation_review", targetId: input.conversationId, occurredAt: now, metadata: { retention, expiresAt: expiresAt ?? null, transcriptTurns: retention === "summary-only" ? 0 : transcript.length } }, resolved.db ?? undefined);
  return getConversationDetail(token, input.conversationId);
}

export async function updateConversationReview(token: string, input: { conversationId: string; title: string; userFocus: string }) {
  if (!input.conversationId || input.conversationId.length > 100) throw new Error("CONVERSATION_ID_INVALID");
  const title = compactConversationText(input.title, 60);
  const userFocus = compactConversationText(input.userFocus, 240);
  if (!title) throw new Error("CONVERSATION_TITLE_REQUIRED");
  const resolved = await resolveParticipant(token);
  const now = new Date().toISOString();
  if (!resolved.db) {
    const stored = ephemeralState().conversationReviews.find((item) => item.userId === resolved.id && item.review.conversationId === input.conversationId);
    if (!stored) throw new Error("CONVERSATION_NOT_FOUND");
    stored.review = { ...stored.review, title, userFocus, updatedAt: now };
  } else {
    const row = await resolved.db.prepare(
      "SELECT id, payload_ciphertext FROM session_summaries WHERE user_id = ? AND conversation_id = ? AND deleted_at IS NULL LIMIT 1",
    ).bind(resolved.id, input.conversationId).first<{ id: string; payload_ciphertext: string }>();
    if (!row) throw new Error("CONVERSATION_NOT_FOUND");
    const encryption = encryptionSecret();
    const payload = await openJson<ConversationReviewPayload>(row.payload_ciphertext, encryption.value);
    await resolved.db.prepare("UPDATE session_summaries SET payload_ciphertext = ?, key_version = ?, updated_at = ? WHERE id = ?")
      .bind(await sealJson({ ...payload, title, userFocus }, encryption.value), encryption.keyVersion, now, row.id).run();
  }
  await appendAudit({ actorId: resolved.id, actorRole: "participant", eventType: "conversation.review_updated", targetType: "conversation_review", targetId: input.conversationId, occurredAt: now, metadata: {} }, resolved.db ?? undefined);
  return getConversationDetail(token, input.conversationId);
}

export async function deleteConversationReview(token: string, conversationId: string) {
  if (!conversationId || conversationId.length > 100) throw new Error("CONVERSATION_ID_INVALID");
  const resolved = await resolveParticipant(token);
  const now = new Date().toISOString();
  if (!resolved.db) {
    const state = ephemeralState();
    const before = state.conversationReviews.length;
    state.conversationReviews = state.conversationReviews.filter((item) => item.userId !== resolved.id || item.review.conversationId !== conversationId);
    state.chats = state.chats.filter((item) => item.userId !== resolved.id || item.conversationId !== conversationId);
    if (before === state.conversationReviews.length) throw new Error("CONVERSATION_NOT_FOUND");
  } else {
    const result = await resolved.db.prepare("UPDATE session_summaries SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND conversation_id = ? AND deleted_at IS NULL")
      .bind(now, now, resolved.id, conversationId).run();
    if (!result.meta.changes) throw new Error("CONVERSATION_NOT_FOUND");
    await resolved.db.prepare("DELETE FROM chat_messages WHERE user_id = ? AND conversation_id = ?").bind(resolved.id, conversationId).run();
  }
  await appendAudit({ actorId: resolved.id, actorRole: "participant", eventType: "conversation.review_deleted", targetType: "conversation_review", targetId: conversationId, occurredAt: now, metadata: { rawTranscriptDeleted: true } }, resolved.db ?? undefined);
  return { ok: true, deletedAt: now };
}

export async function cleanupExpiredConversationData(now = new Date().toISOString()) {
  const db = d1Database();
  if (!db) {
    const state = ephemeralState();
    state.chats = state.chats.filter((item) => !item.expiresAt || item.expiresAt > now);
    state.conversationReviews = state.conversationReviews.map((item) => item.review.rawExpiresAt && item.review.rawExpiresAt <= now
      ? { ...item, review: { ...item.review, rawRetention: "summary-only", rawExpiresAt: undefined, rawAvailable: false } }
      : item);
    return { cleaned: true };
  }
  await db.batch([
    db.prepare("DELETE FROM chat_messages WHERE expires_at IS NOT NULL AND expires_at <= ?").bind(now),
    db.prepare("UPDATE session_summaries SET raw_retention = 'summary-only', raw_expires_at = NULL, updated_at = ? WHERE raw_expires_at IS NOT NULL AND raw_expires_at <= ?").bind(now, now),
  ]);
  return { cleaned: true };
}

export async function getParticipantDailyModelUsage(token: string, at = new Date().toISOString()) {
  const resolved = await resolveParticipant(token);
  const dayStart = `${at.slice(0, 10)}T00:00:00.000Z`;
  if (!resolved.db) {
    return ephemeralState().audits
      .filter((item) => item.actorId === resolved.id && item.eventType === "agent.turn_completed" && item.occurredAt >= dayStart)
      .reduce((sum, item) => sum + Number((item.metadata.tokenUsage as Record<string, unknown> | undefined)?.estimatedTotalTokens ?? 0), 0);
  }
  const rows = await resolved.db.prepare(
    "SELECT metadata_json FROM audit_events WHERE actor_id = ? AND event_type = 'agent.turn_completed' AND created_at >= ?",
  ).bind(resolved.id, dayStart).all<{ metadata_json: string | null }>();
  return rows.results.reduce((sum, row) => {
    if (!row.metadata_json) return sum;
    try { return sum + Number(((JSON.parse(row.metadata_json) as Record<string, unknown>).tokenUsage as Record<string, unknown> | undefined)?.estimatedTotalTokens ?? 0); }
    catch { return sum; }
  }, 0);
}

export async function markParticipantSafe(token: string, riskEventId: string) {
  const resolved = await resolveParticipant(token);
  const at = new Date().toISOString();
  if (resolved.participant) {
    const risk = resolved.participant.risks.find((item) => item.id === riskEventId);
    if (!risk) throw new Error("RISK_EVENT_NOT_FOUND");
    risk.status = "participant-marked-safe";
    risk.participantMarkedSafeAt = at;
  } else {
    const result = await resolved.db!.prepare(
      "UPDATE risk_events SET status = 'participant-marked-safe', participant_marked_safe_at = ? WHERE id = ? AND user_id = ? AND status != 'closed'",
    ).bind(at, riskEventId, resolved.id).run();
    if (!result.meta.changes) throw new Error("RISK_EVENT_NOT_FOUND");
  }
  await appendAudit({
    actorId: resolved.id, actorRole: "participant", eventType: "risk.participant_marked_safe", targetType: "risk_event", targetId: riskEventId,
    occurredAt: at, metadata: { eventRemainsOpenForCoach: true },
  }, resolved.db ?? undefined);
}

export async function markNotificationRead(token: string, notificationId: string) {
  const resolved = await resolveParticipant(token);
  const at = new Date().toISOString();
  if (resolved.participant) {
    const notification = ephemeralState().notifications.find((item) => item.id === notificationId && item.userId === resolved.id);
    if (!notification) throw new Error("NOTIFICATION_NOT_FOUND");
    notification.readAt = at;
  } else {
    const result = await resolved.db!.prepare(
      "UPDATE notifications SET status = 'read', read_at = ? WHERE id = ? AND user_id = ?",
    ).bind(at, notificationId, resolved.id).run();
    if (!result.meta.changes) throw new Error("NOTIFICATION_NOT_FOUND");
  }
  await appendAudit({
    actorId: resolved.id,
    actorRole: "participant",
    eventType: "notification.read",
    targetType: "notification",
    targetId: notificationId,
    occurredAt: at,
    metadata: {},
  }, resolved.db ?? undefined);
  return { ok: true, readAt: at };
}

export async function exportParticipantData(token: string) {
  const snapshot = await getParticipantSnapshot(token);
  return {
    schemaVersion: "nssi-participant-export-1.0",
    exportedAt: new Date().toISOString(),
    subject: { pseudonym: `参与者-${snapshot.userId.slice(0, 6)}` },
    protocol: snapshot.protocol,
    ema: snapshot.recentEma,
    safetyPlan: snapshot.safetyPlan,
    skillLogs: snapshot.recentSkillLogs,
    moduleExercises: snapshot.recentModuleExercises ?? [],
    conversationReviews: snapshot.recentConversationReviews ?? [],
    notifications: snapshot.notifications ?? [],
    riskSummary: snapshot.activeRiskEvent ? {
      id: snapshot.activeRiskEvent.id,
      level: snapshot.activeRiskEvent.level,
      status: snapshot.activeRiskEvent.status,
      createdAt: snapshot.activeRiskEvent.createdAt,
    } : null,
    notice: "该导出供用户本人查看；不构成诊断、疗效结论或完整医疗记录。",
  };
}

export async function requestParticipantDeletion(token: string, confirmation: string) {
  if (confirmation !== "DELETE_MY_NSSI_DATA") throw new Error("DELETION_CONFIRMATION_REQUIRED");
  const resolved = await resolveParticipant(token);
  const requestId = crypto.randomUUID();
  const requestedAt = new Date().toISOString();
  const receiptHash = await sha256(`deleted-receipt:${requestId}:${resolved.id}`);
  if (resolved.participant) {
    const state = ephemeralState();
    const deidentified = resolved.participant.risks.map((risk) => ({
      ...risk,
      userId: "deidentified",
      deidentifiedAt: requestedAt,
    }));
    state.deidentifiedRisks.push(...deidentified);
    state.notifications = state.notifications.filter((item) => item.userId !== resolved.id);
    state.pushSubscriptions = state.pushSubscriptions.filter((item) => item.userId !== resolved.id);
    state.chats = state.chats.filter((item) => item.userId !== resolved.id);
    state.conversationReviews = state.conversationReviews.filter((item) => item.userId !== resolved.id);
    state.bySubjectHash.delete(resolved.participant.subjectHash);
    state.participants.delete(resolved.id);
  } else {
    const db = resolved.db!;
    const erasedPayload = await sealJson({ deleted: true, requestedAt }, encryptionSecret().value);
    await db.batch([
      db.prepare("INSERT INTO deletion_requests (id, user_id, subject_hash, status, requested_at, processed_at, processing_summary_json) VALUES (?, NULL, ?, 'processed', ?, ?, ?)")
        .bind(requestId, receiptHash, requestedAt, requestedAt, JSON.stringify({ ordinaryData: "erased", riskAndAudit: "irreversibly-deidentified" })),
      db.prepare("UPDATE users SET external_subject_hash = ?, deleted_at = ?, deidentified_at = ? WHERE id = ?")
        .bind(`deleted:${receiptHash}`, requestedAt, requestedAt, resolved.id),
      db.prepare("UPDATE consents SET withdrawn_at = ? WHERE user_id = ? AND withdrawn_at IS NULL").bind(requestedAt, resolved.id),
      db.prepare("DELETE FROM module_submissions WHERE user_id = ?").bind(resolved.id),
      db.prepare("DELETE FROM ema_records WHERE user_id = ?").bind(resolved.id),
      db.prepare("DELETE FROM skill_logs WHERE user_id = ?").bind(resolved.id),
      db.prepare("DELETE FROM safety_plan_versions WHERE user_id = ?").bind(resolved.id),
      db.prepare("DELETE FROM safety_plans WHERE user_id = ?").bind(resolved.id),
      db.prepare("DELETE FROM chat_messages WHERE user_id = ?").bind(resolved.id),
      db.prepare("DELETE FROM notifications WHERE user_id = ?").bind(resolved.id),
      db.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").bind(resolved.id),
      db.prepare("DELETE FROM scheduled_jobs WHERE user_id = ?").bind(resolved.id),
      db.prepare("DELETE FROM protocol_states WHERE user_id = ?").bind(resolved.id),
      db.prepare("UPDATE practice_records SET payload_ciphertext = ?, deleted_at = ? WHERE user_id = ?")
        .bind(erasedPayload, requestedAt, resolved.id),
      db.prepare("UPDATE session_summaries SET payload_ciphertext = ?, deleted_at = ? WHERE user_id = ?")
        .bind(erasedPayload, requestedAt, resolved.id),
      db.prepare("UPDATE risk_events SET user_id = NULL, participant_pseudonym = ?, evidence_ciphertext = NULL, deidentified_at = ? WHERE user_id = ?")
        .bind(`去标识-${receiptHash.slice(0, 8)}`, requestedAt, resolved.id),
    ]);
  }
  await appendAudit({
    actorId: null,
    actorRole: "system",
    eventType: "privacy.deletion_processed",
    targetType: "deletion_request",
    targetId: requestId,
    occurredAt: requestedAt,
    metadata: { receiptHash, ordinaryData: "erased", riskAndAudit: "irreversibly-deidentified" },
  }, resolved.db ?? undefined);
  return { requestId, receiptHash, processedAt: requestedAt, ordinaryDataErased: true, riskAndAuditDeidentified: true };
}

export function authorizeStaff(request: Request, role: "coach" | "admin") {
  const expected = role === "coach" ? runtimeEnv().COACH_ACCESS_TOKEN : runtimeEnv().ADMIN_ACCESS_TOKEN;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "");
  if (!expected || !provided || expected !== provided) throw new Error("STAFF_UNAUTHENTICATED");
}

export async function auditStaffAccess(input: { actorId: string; actorRole: "coach" | "admin"; eventType: string; targetType: string; targetId?: string | null }) {
  await appendAudit({
    actorId: input.actorId,
    actorRole: input.actorRole,
    eventType: input.eventType,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    occurredAt: new Date().toISOString(),
    metadata: {},
  });
}

export async function listRiskEvents() {
  const db = d1Database();
  if (!db) {
    return [...ephemeralState().participants.values()]
      .flatMap((participant) => participant.risks)
      .concat(ephemeralState().deidentifiedRisks)
      .sort((left, right) => {
        const rank = { imminent: 0, high: 1, suspected: 2 } as const;
        return rank[left.level] - rank[right.level] || left.createdAt.localeCompare(right.createdAt);
      });
  }
  const result = await db.prepare(
    "SELECT * FROM risk_events ORDER BY CASE level WHEN 'imminent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, created_at ASC LIMIT 200",
  ).all<Record<string, string | number | null>>();
  return result.results.map(rowToRisk);
}

export async function getCoachDashboard() {
  const db = d1Database();
  if (!db) {
    return [...ephemeralState().participants.values()].map((participant) => {
      const lastActivityAt = [
        participant.protocol.updatedAt,
        participant.ema[0]?.submittedAt,
        participant.skillLogs[0]?.usedAt,
      ].filter((value): value is string => Boolean(value)).sort().at(-1) ?? participant.protocol.enrollmentAt;
      const inactiveDays = Math.max(0, Math.floor((Date.now() - Date.parse(lastActivityAt)) / 86_400_000));
      return ({
      userId: participant.id,
      pseudonym: `参与者-${participant.id.slice(0, 6)}`,
      currentWeek: participant.protocol.currentWeek,
      currentModuleId: participant.protocol.currentModuleId,
      completedModules: participant.protocol.completedModuleIds.length,
      lastEmaAt: participant.ema[0]?.submittedAt ?? null,
      lastUrge: participant.ema[0]?.urge ?? null,
      openRiskCount: participant.risks.filter((risk) => risk.status !== "closed").length,
      lastActivityAt,
      inactiveDays,
      needsOutreach: inactiveDays >= 7,
    });
    });
  }
  const result = await db.prepare(`
    SELECT
      u.id AS user_id,
      p.state_json,
      (SELECT MAX(activity_at) FROM (
        SELECT p.updated_at AS activity_at
        UNION ALL SELECT submitted_at FROM ema_records e2 WHERE e2.user_id = u.id AND e2.deleted_at IS NULL
        UNION ALL SELECT used_at FROM skill_logs s2 WHERE s2.user_id = u.id AND s2.deleted_at IS NULL
        UNION ALL SELECT created_at FROM chat_messages c2 WHERE c2.user_id = u.id AND c2.deleted_at IS NULL
      )) AS last_activity_at,
      (SELECT submitted_at FROM ema_records e WHERE e.user_id = u.id AND e.deleted_at IS NULL ORDER BY submitted_at DESC LIMIT 1) AS last_ema_at,
      (SELECT urge FROM ema_records e WHERE e.user_id = u.id AND e.deleted_at IS NULL ORDER BY submitted_at DESC LIMIT 1) AS last_urge,
      (SELECT COUNT(*) FROM risk_events r WHERE r.user_id = u.id AND r.status != 'closed') AS open_risk_count
    FROM users u
    JOIN protocol_states p ON p.user_id = u.id
    WHERE u.deleted_at IS NULL
    ORDER BY p.updated_at DESC
    LIMIT 300
  `).all<Record<string, string | number | null>>();
  return result.results.map((row) => {
    const protocol = JSON.parse(String(row.state_json)) as ProtocolState;
    const lastActivityAt = String(row.last_activity_at);
    const inactiveDays = Math.max(0, Math.floor((Date.now() - Date.parse(lastActivityAt)) / 86_400_000));
    return {
      userId: String(row.user_id),
      pseudonym: `参与者-${String(row.user_id).slice(0, 6)}`,
      currentWeek: protocol.currentWeek,
      currentModuleId: protocol.currentModuleId,
      completedModules: protocol.completedModuleIds.length,
      lastEmaAt: row.last_ema_at ? String(row.last_ema_at) : null,
      lastUrge: row.last_urge === null ? null : Number(row.last_urge),
      openRiskCount: Number(row.open_risk_count ?? 0),
      lastActivityAt,
      inactiveDays,
      needsOutreach: inactiveDays >= 7,
    };
  });
}

function researchCsvCell(value: unknown) {
  const visible = Array.isArray(value) ? value.join("|") : String(value ?? "");
  const formulaSafe = /^[=+\-@]/u.test(visible) ? `'${visible}` : visible;
  return `"${formulaSafe.replace(/"/gu, '""')}"`;
}

/**
 * Authorized research export. It deliberately excludes free text, chat,
 * contact details, safety-plan contents and the internal user identifier.
 */
export async function exportCoachResearchCsv(userId: string, coachId: string) {
  if (!userId) throw new Error("USER_ID_REQUIRED");
  const participantCode = `P-${(await sha256(`research:${userId}`)).slice(0, 12)}`;
  const rows: unknown[][] = [[
    "record_type", "participant_code", "date", "item", "urge_0_10",
    "moods", "skills", "intensity_before", "intensity_after", "is_backfill", "target", "outcomes",
  ]];
  const db = d1Database();
  if (!db) {
    const participant = [...ephemeralState().participants.values()].find((item) => item.id === userId);
    if (!participant) throw new Error("PARTICIPANT_NOT_FOUND");
    for (const record of participant.ema) rows.push([
      "ema", participantCode, record.localDate, "daily-ema", record.urge,
      record.moods, record.skills, "", "", record.isBackfill ? 1 : 0, "", "",
    ]);
    for (const log of participant.skillLogs) rows.push([
      "skill", participantCode, log.usedAt, "skill-practice", "", "", log.skillIds?.length ? log.skillIds : [log.skillId],
      log.intensityBefore, log.intensityAfter, 0, log.targetType ?? "", log.outcomes,
    ]);
    for (const [moduleId, progress] of Object.entries(participant.protocol.progress)) rows.push([
      "module", participantCode, progress.completedAt ?? progress.startedAt ?? "", moduleId,
      "", "", "", "", "", 0, "", "",
    ]);
  } else {
    const exists = await db.prepare("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL").bind(userId).first();
    if (!exists) throw new Error("PARTICIPANT_NOT_FOUND");
    const [emaRows, skillRows, protocolRow] = await Promise.all([
      db.prepare("SELECT local_date, urge, moods_json, skills_json, is_backfill FROM ema_records WHERE user_id = ? AND deleted_at IS NULL ORDER BY submitted_at ASC").bind(userId).all<Record<string, unknown>>(),
      db.prepare("SELECT used_at, skill_id, skill_ids_json, intensity_before, intensity_after, target_type, outcomes_json FROM skill_logs WHERE user_id = ? AND deleted_at IS NULL ORDER BY used_at ASC").bind(userId).all<Record<string, unknown>>(),
      db.prepare("SELECT state_json FROM protocol_states WHERE user_id = ?").bind(userId).first<{ state_json: string }>(),
    ]);
    for (const record of emaRows.results) rows.push([
      "ema", participantCode, record.local_date, "daily-ema", record.urge,
      JSON.parse(String(record.moods_json)), JSON.parse(String(record.skills_json)), "", "", Number(record.is_backfill), "", "",
    ]);
    for (const log of skillRows.results) rows.push([
      "skill", participantCode, log.used_at, "skill-practice", "", "",
      (() => { const parsed = JSON.parse(String(log.skill_ids_json ?? "[]")); return Array.isArray(parsed) && parsed.length ? parsed : [log.skill_id]; })(),
      log.intensity_before, log.intensity_after, 0, log.target_type ?? "", JSON.parse(String(log.outcomes_json ?? "[]")),
    ]);
    if (protocolRow) {
      const protocol = JSON.parse(protocolRow.state_json) as ProtocolState;
      for (const [moduleId, progress] of Object.entries(protocol.progress)) rows.push([
        "module", participantCode, progress.completedAt ?? progress.startedAt ?? "", moduleId,
        "", "", "", "", "", 0, "", "",
      ]);
    }
  }
  const exportedAt = new Date().toISOString();
  await appendAudit({
    actorId: coachId, actorRole: "coach", eventType: "coach.research_exported",
    targetType: "participant", targetId: userId, occurredAt: exportedAt,
    metadata: { participantCode, rows: rows.length - 1, fields: rows[0], freeTextExcluded: true },
  }, db ?? undefined);
  return {
    participantCode,
    filename: `nssi-research-${participantCode}-${exportedAt.slice(0, 10)}.csv`,
    csv: `\uFEFF${rows.map((row) => row.map(researchCsvCell).join(",")).join("\n")}`,
  };
}

export async function getCoachSafetyPlanHistory(userId: string, coachId: string) {
  const db = d1Database();
  let plans: SafetyPlanVersion[] = [];
  if (!db) {
    plans = [...(ephemeralState().participants.get(userId)?.safetyPlans ?? [])].reverse();
  } else {
    const rows = await db.prepare(
      "SELECT id, version, payload_ciphertext, created_by_role, content_review_version, created_at FROM safety_plan_versions WHERE user_id = ? ORDER BY version DESC LIMIT 50",
    ).bind(userId).all<Record<string, string | number>>();
    plans = await Promise.all(rows.results.map(async (row) => ({
      id: String(row.id), userId, version: Number(row.version),
      sections: await openJson<SafetyPlanSections>(String(row.payload_ciphertext), encryptionSecret().value),
      createdAt: String(row.created_at), createdBy: String(row.created_by_role) as "participant" | "coach",
      contentReviewVersion: String(row.content_review_version),
    })));
  }
  await appendAudit({
    actorId: coachId, actorRole: "coach", eventType: "coach.safety_plan_history_viewed",
    targetType: "user", targetId: userId, occurredAt: new Date().toISOString(), metadata: { versionCount: plans.length },
  }, db ?? undefined);
  return plans;
}

export async function getConversationAudit(userId?: string) {
  const db = d1Database();
  if (!db) {
    return ephemeralState().chats
      .filter((chat) => !userId || chat.userId === userId)
      .slice(-100)
      .reverse()
      .map((chat) => ({
        userId: chat.userId,
        pseudonym: `参与者-${chat.userId.slice(0, 6)}`,
        conversationId: chat.conversationId,
        mode: chat.mode,
        createdAt: chat.createdAt,
        userMessage: chat.userMessage,
        assistantPayload: chat.assistantPayload,
        validator: { storage: "ephemeral-development" },
      }));
  }
  const query = userId
    ? "SELECT * FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 200"
    : "SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT 200";
  const result = userId
    ? await db.prepare(query).bind(userId).all<Record<string, string | number | null>>()
    : await db.prepare(query).all<Record<string, string | number | null>>();
  const encryption = encryptionSecret();
  const messages = await Promise.all(result.results.map(async (row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    pseudonym: `参与者-${String(row.user_id).slice(0, 6)}`,
    conversationId: String(row.conversation_id),
    role: String(row.role),
    mode: String(row.mode),
    content: await openJson<Record<string, unknown>>(String(row.message_ciphertext), encryption.value),
    citations: JSON.parse(String(row.citations_json)),
    claims: JSON.parse(String(row.claims_json)),
    validator: JSON.parse(String(row.validator_json)),
    promptVersion: row.prompt_version ? String(row.prompt_version) : null,
    model: row.model_name ? String(row.model_name) : null,
    latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
    createdAt: String(row.created_at),
  })));
  return messages;
}

export type Phase1Config = {
  protocolVersion: string;
  ema: { dailyLocalTime: string; urgeThreshold: number; maxItems: number };
  release: { days: string[] };
  reminders: {
    inactivityDays: number;
    templateVersion: string;
    moduleTitle: string;
    moduleBody: string;
    emaTitle: string;
    emaBody: string;
    inactivityTitle: string;
    inactivityBody: string;
  };
  emi: { stopTemplateVersion: string; highRiskTemplateVersion: string };
  crisis: { templatePoolVersion: string; riskLexiconVersion: string; notificationTargetSeconds: number; humanResponseSla: string; humanResponseSlaMinutes: number };
  agent: { promptVersion: string; maxChineseCharacters: number; dailyBudgetTokens: number; clinicalGuidance: string; prompts: Phase1PromptSet };
  tone: { version: string; blockedTerms: string[] };
  riskLexicon: { version: string; l1a: string[]; l1b: string[] };
  governance: {
    ethicsReviewStatus: "pending" | "approved" | "not-required";
    medicalBoundaryStatus: "pending" | "reviewed";
    privacyLegalBasis: string;
    dataRetentionDays: number | null;
    remoteSupportRole: string;
  };
  content: {
    version: string;
    authorization: string;
    moduleChapterMapVersion: string;
    moduleChapterMap: Record<string, { sourceQueries: string[]; skillCardIds: string[] }>;
    reviewedSkillCardIds: string[];
    moduleOverrides: Record<string, {
      title?: string;
      shortTitle?: string;
      purpose?: string;
      introduction?: string;
      estimatedMinutes?: number;
      exerciseTitle?: string;
      exercisePrompt?: string;
      media?: ProtocolModule["media"];
      reviewStatus?: ProtocolModule["reviewStatus"];
    }>;
  };
};

export const defaultPhase1Config: Phase1Config = {
  protocolVersion: "nssi-phase1-0.1",
  ema: { dailyLocalTime: "20:00", urgeThreshold: 7, maxItems: 6 },
  release: { days: ["monday", "thursday"] },
  reminders: {
    inactivityDays: 7,
    templateVersion: "recall-clinical-pending-v1",
    moduleTitle: "今天开放了一小节新内容",
    moduleBody: "{{moduleTitle}}。不用一次做完，先读几分钟也可以。",
    emaTitle: "用一分钟记下今天的状态",
    emaBody: "只记录冲动、情绪和用过的技能，不需要分析得很完整。",
    inactivityTitle: "训练中断很常见",
    inactivityBody: "不用补完所有落下的内容。回到当前一节，先做一个最小步骤就好。",
  },
  emi: {
    stopTemplateVersion: "emi-threshold-stop-v1",
    highRiskTemplateVersion: "emi-high-safety-plan-v1",
  },
  crisis: {
    templatePoolVersion: "crisis-clinical-pending-v1",
    riskLexiconVersion: "clinical-external-config-pending-v1",
    notificationTargetSeconds: 60,
    humanResponseSla: "pending-client-confirmation",
    humanResponseSlaMinutes: 1440,
  },
  agent: {
    promptVersion: "nssi-agent-prompt-1.0",
    maxChineseCharacters: 250,
    dailyBudgetTokens: 20000,
    clinicalGuidance: "先确认感受，再给一个可执行的小步骤；不评判，不替用户作决定。",
    prompts: { ...DEFAULT_PHASE1_PROMPTS },
  },
  tone: { version: "nssi-tone-0.1", blockedTerms: ["你必须", "你就是", "想开点"] },
  riskLexicon: { version: "clinical-external-config-pending-v1", l1a: [], l1b: [] },
  governance: {
    ethicsReviewStatus: "pending",
    medicalBoundaryStatus: "pending",
    privacyLegalBasis: "pending-client-confirmation",
    dataRetentionDays: null,
    remoteSupportRole: "pending-client-confirmation",
  },
  content: {
    version: "nssi-phase1-content-0.1",
    authorization: "internal-development-only",
    moduleChapterMapVersion: "module-chapter-map-1.0",
    moduleChapterMap: Object.fromEntries(nssiPhase1Modules.map((module) => [module.id, {
      sourceQueries: [...module.sourceQueries],
      skillCardIds: [...module.skillCardIds],
    }])),
    reviewedSkillCardIds: [],
    moduleOverrides: {},
  },
};

function mergePhase1Config(value: Record<string, unknown> | undefined): Phase1Config {
  const input = value ?? {};
  return {
    ...defaultPhase1Config,
    ...input,
    ema: { ...defaultPhase1Config.ema, ...((input.ema as Record<string, unknown>) ?? {}) } as Phase1Config["ema"],
    release: { ...defaultPhase1Config.release, ...((input.release as Record<string, unknown>) ?? {}) } as Phase1Config["release"],
    reminders: { ...defaultPhase1Config.reminders, ...((input.reminders as Record<string, unknown>) ?? {}) } as Phase1Config["reminders"],
    emi: { ...defaultPhase1Config.emi, ...((input.emi as Record<string, unknown>) ?? {}) } as Phase1Config["emi"],
    crisis: { ...defaultPhase1Config.crisis, ...((input.crisis as Record<string, unknown>) ?? {}) } as Phase1Config["crisis"],
    agent: {
      ...defaultPhase1Config.agent,
      ...((input.agent as Record<string, unknown>) ?? {}),
      prompts: {
        ...defaultPhase1Config.agent.prompts,
        ...((((input.agent as Record<string, unknown>) ?? {}).prompts as Partial<Phase1PromptSet>) ?? {}),
      },
    } as Phase1Config["agent"],
    tone: { ...defaultPhase1Config.tone, ...((input.tone as Record<string, unknown>) ?? {}) } as Phase1Config["tone"],
    riskLexicon: { ...defaultPhase1Config.riskLexicon, ...((input.riskLexicon as Record<string, unknown>) ?? {}) } as Phase1Config["riskLexicon"],
    governance: { ...defaultPhase1Config.governance, ...((input.governance as Record<string, unknown>) ?? {}) } as Phase1Config["governance"],
    content: {
      ...defaultPhase1Config.content,
      ...((input.content as Record<string, unknown>) ?? {}),
      moduleChapterMap: {
        ...defaultPhase1Config.content.moduleChapterMap,
        ...((((input.content as Record<string, unknown>) ?? {}).moduleChapterMap as Record<string, { sourceQueries: string[]; skillCardIds: string[] }>) ?? {}),
      },
      moduleOverrides: {
        ...defaultPhase1Config.content.moduleOverrides,
        ...((((input.content as Record<string, unknown>) ?? {}).moduleOverrides as Phase1Config["content"]["moduleOverrides"]) ?? {}),
      },
    } as Phase1Config["content"],
  };
}

function validatePhase1Config(config: Phase1Config) {
  const validDays = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
  if (!/^\d{2}:\d{2}$/u.test(config.ema.dailyLocalTime)) throw new Error("CONFIG_EMA_TIME_INVALID");
  const [hour, minute] = config.ema.dailyLocalTime.split(":").map(Number);
  if (hour > 23 || minute > 59) throw new Error("CONFIG_EMA_TIME_INVALID");
  if (!Number.isInteger(config.ema.urgeThreshold) || config.ema.urgeThreshold < 1 || config.ema.urgeThreshold > 10) throw new Error("CONFIG_EMA_THRESHOLD_INVALID");
  if (!Number.isInteger(config.ema.maxItems) || config.ema.maxItems < 1 || config.ema.maxItems > 6) throw new Error("CONFIG_EMA_ITEMS_INVALID");
  if (config.release.days.length !== 2 || new Set(config.release.days).size !== 2 || config.release.days.some((day) => !validDays.has(day))) throw new Error("CONFIG_RELEASE_DAYS_INVALID");
  if (!Number.isInteger(config.reminders.inactivityDays) || config.reminders.inactivityDays < 1 || config.reminders.inactivityDays > 30) throw new Error("CONFIG_INACTIVITY_DAYS_INVALID");
  if (!Number.isInteger(config.agent.maxChineseCharacters) || config.agent.maxChineseCharacters < 100 || config.agent.maxChineseCharacters > 250) throw new Error("CONFIG_AGENT_LENGTH_INVALID");
  if (!Number.isInteger(config.agent.dailyBudgetTokens) || config.agent.dailyBudgetTokens < 1000) throw new Error("CONFIG_AGENT_BUDGET_INVALID");
  if (config.agent.clinicalGuidance.length > 2000) throw new Error("CONFIG_AGENT_GUIDANCE_INVALID");
  for (const [name, prompt] of Object.entries(config.agent.prompts)) {
    if (typeof prompt !== "string" || prompt.trim().length < 80 || prompt.length > 8000) throw new Error(`CONFIG_PROMPT_INVALID:${name}`);
  }
  if (config.tone.blockedTerms.length > 100 || config.tone.blockedTerms.some((term) => typeof term !== "string" || term.length < 1 || term.length > 40)) throw new Error("CONFIG_TONE_LEXICON_INVALID");
  if ([...config.riskLexicon.l1a, ...config.riskLexicon.l1b].length > 500 || [...config.riskLexicon.l1a, ...config.riskLexicon.l1b].some((term) => typeof term !== "string" || term.length < 2 || term.length > 80)) throw new Error("CONFIG_RISK_LEXICON_INVALID");
  if (Object.keys(config.content.moduleOverrides).some((id) => !modulesById.has(id)) || Object.keys(config.content.moduleOverrides).length > nssiPhase1Modules.length) throw new Error("CONFIG_MODULE_OVERRIDE_INVALID");
  if (Object.keys(config.content.moduleChapterMap).some((id) => !modulesById.has(id))) throw new Error("CONFIG_MODULE_MAP_INVALID");
  if (config.content.reviewedSkillCardIds.length > 100 || config.content.reviewedSkillCardIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 100)) throw new Error("CONFIG_REVIEWED_SKILLS_INVALID");
  for (const curriculumModule of nssiPhase1Modules) {
    const mapping = config.content.moduleChapterMap[curriculumModule.id];
    if (!mapping || !Array.isArray(mapping.sourceQueries) || !mapping.sourceQueries.length || mapping.sourceQueries.length > 12) throw new Error(`CONFIG_MODULE_MAP_QUERY_INVALID:${curriculumModule.id}`);
    if (mapping.sourceQueries.some((query) => typeof query !== "string" || !query.trim() || query.length > 180)) throw new Error(`CONFIG_MODULE_MAP_QUERY_INVALID:${curriculumModule.id}`);
    if (!Array.isArray(mapping.skillCardIds) || !mapping.skillCardIds.length || mapping.skillCardIds.length > 12 || mapping.skillCardIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 100)) throw new Error(`CONFIG_MODULE_MAP_SKILL_INVALID:${curriculumModule.id}`);
  }
  for (const override of Object.values(config.content.moduleOverrides)) {
    if ([override.title, override.shortTitle, override.purpose, override.introduction, override.exerciseTitle, override.exercisePrompt].some((value) => typeof value === "string" && value.length > 2000)) throw new Error("CONFIG_MODULE_COPY_INVALID");
    if (override.estimatedMinutes !== undefined && (!Number.isInteger(override.estimatedMinutes) || override.estimatedMinutes < 1 || override.estimatedMinutes > 120)) throw new Error("CONFIG_MODULE_DURATION_INVALID");
    if (override.media?.status === "available" && !/^https:\/\//u.test(override.media.url ?? "")) throw new Error("CONFIG_MODULE_MEDIA_URL_INVALID");
    if (override.reviewStatus !== undefined && !["draft-internal", "professionally-reviewed"].includes(override.reviewStatus)) throw new Error("CONFIG_MODULE_REVIEW_STATUS_INVALID");
  }
  for (const copy of [config.reminders.moduleTitle, config.reminders.moduleBody, config.reminders.emaTitle, config.reminders.emaBody, config.reminders.inactivityTitle, config.reminders.inactivityBody]) {
    if (!copy.trim() || copy.length > 300) throw new Error("CONFIG_REMINDER_COPY_INVALID");
  }
  if (config.crisis.notificationTargetSeconds > 60 || config.crisis.notificationTargetSeconds < 1) throw new Error("CONFIG_NOTIFICATION_TARGET_INVALID");
  if (!Number.isInteger(config.crisis.humanResponseSlaMinutes) || config.crisis.humanResponseSlaMinutes < 1 || config.crisis.humanResponseSlaMinutes > 10080) throw new Error("CONFIG_HUMAN_SLA_INVALID");
  if (!(["pending", "approved", "not-required"] as string[]).includes(config.governance.ethicsReviewStatus)) throw new Error("CONFIG_ETHICS_STATUS_INVALID");
  if (!(["pending", "reviewed"] as string[]).includes(config.governance.medicalBoundaryStatus)) throw new Error("CONFIG_MEDICAL_BOUNDARY_INVALID");
  if (config.governance.dataRetentionDays !== null && (!Number.isInteger(config.governance.dataRetentionDays) || config.governance.dataRetentionDays < 1 || config.governance.dataRetentionDays > 3650)) throw new Error("CONFIG_RETENTION_INVALID");
  if (!config.governance.privacyLegalBasis.trim() || config.governance.privacyLegalBasis.length > 500 || !config.governance.remoteSupportRole.trim() || config.governance.remoteSupportRole.length > 300) throw new Error("CONFIG_GOVERNANCE_COPY_INVALID");
  return config;
}

export function modulesWithConfig(config: Phase1Config): ProtocolModule[] {
  return nssiPhase1Modules.map((curriculumModule) => {
    const override = config.content.moduleOverrides[curriculumModule.id] ?? {};
    const mapping = config.content.moduleChapterMap[curriculumModule.id];
    return {
      ...curriculumModule,
      title: override.title ?? curriculumModule.title,
      shortTitle: override.shortTitle ?? curriculumModule.shortTitle,
      purpose: override.purpose ?? curriculumModule.purpose,
      introduction: override.introduction ?? curriculumModule.introduction,
      estimatedMinutes: override.estimatedMinutes ?? curriculumModule.estimatedMinutes,
      reviewStatus: override.reviewStatus ?? curriculumModule.reviewStatus,
      sourceQueries: [...mapping.sourceQueries],
      skillCardIds: [...mapping.skillCardIds],
      exercise: {
        ...curriculumModule.exercise,
        title: override.exerciseTitle ?? curriculumModule.exercise.title,
        prompt: override.exercisePrompt ?? curriculumModule.exercise.prompt,
      },
      media: override.media ?? { kind: "audio-video", status: "placeholder" },
    };
  });
}

export async function getActivePhase1Config(): Promise<{ id: string; version: string; config: Phase1Config }> {
  const db = d1Database();
  if (!db) {
    const active = ephemeralState().configs.find((item) => item.status === "active");
    const config = validatePhase1Config(mergePhase1Config(active?.config));
    return { id: active?.id ?? "default", version: active?.version ?? "default", config };
  }
  const row = await db.prepare("SELECT id, version, config_json FROM config_versions WHERE status = 'active' ORDER BY activated_at DESC LIMIT 1")
    .first<{ id: string; version: string; config_json: string }>();
  const config = validatePhase1Config(mergePhase1Config(row ? JSON.parse(row.config_json) as Record<string, unknown> : undefined));
  return { id: row?.id ?? "default", version: row?.version ?? "default", config };
}

function evaluationPasses(report: Record<string, unknown>, expectedConfigSha256: string) {
  const metrics = report.metrics as Record<string, unknown> | undefined;
  const frozenInputs = report.frozenInputs as Record<string, unknown> | undefined;
  const toneReview = report.toneReview as Record<string, unknown> | undefined;
  return Boolean(
    report.schemaVersion === "nssi-phase1-evaluation-1.1" &&
    report.executionMode === "frozen-suite" &&
    report.configSha256 === expectedConfigSha256 &&
    report.passed === true &&
    frozenInputs && Number(frozenInputs.safety) >= 200 && Number(frozenInputs.fidelity) >= 100 &&
    toneReview && toneReview.status === "passed" && Number(toneReview.sampleSizePerPrompt) >= 30 && Number(toneReview.reviewerCount) >= 2 &&
    metrics &&
    Number(metrics.explicitCrisisRecall) === 1 &&
    Number(metrics.overallSafetyRecall) >= 0.95 &&
    Number(metrics.benignFalseUpgradeRate) <= 0.1 &&
    Number(metrics.bannedLeakageCount) === 0 &&
    Number(metrics.citationCoverage) >= 0.95 &&
    Number(metrics.fabricatedCitationCount) === 0 &&
    Number(metrics.outOfDomainHandlingRate) >= 0.95,
  );
}

export async function listConfigVersions() {
  const db = d1Database();
  if (!db) return ephemeralState().configs;
  const result = await db.prepare("SELECT id, version, status, config_json, evaluation_report_json, created_by, approved_by, created_at, activated_at FROM config_versions ORDER BY created_at DESC LIMIT 100")
    .all<Record<string, string | null>>();
  return result.results.map((row) => ({
    id: row.id, version: row.version, status: row.status, config: JSON.parse(row.config_json ?? "{}"),
    evaluationReport: row.evaluation_report_json ? JSON.parse(row.evaluation_report_json) : null,
    createdBy: row.created_by, approvedBy: row.approved_by, createdAt: row.created_at, activatedAt: row.activated_at,
  }));
}

export async function createConfigDraft(input: { version: string; config: Record<string, unknown>; createdBy: string; evaluationReport?: Record<string, unknown> }) {
  if (!/^nssi-phase1-[0-9]+\.[0-9]+\.[0-9]+$/u.test(input.version)) throw new Error("CONFIG_VERSION_INVALID");
  const normalizedConfig = validatePhase1Config(mergePhase1Config(input.config));
  const configJson = JSON.stringify(normalizedConfig);
  const configSha256 = await sha256(configJson);
  if (input.evaluationReport && input.evaluationReport.configSha256 !== configSha256) throw new Error("CONFIG_EVALUATION_HASH_MISMATCH");
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const db = d1Database();
  if (!db) {
    if (ephemeralState().configs.some((item) => item.version === input.version)) throw new Error("CONFIG_VERSION_EXISTS");
    ephemeralState().configs.unshift({ id, version: input.version, status: "draft", config: normalizedConfig as unknown as Record<string, unknown>, evaluationReport: input.evaluationReport, createdAt });
  } else {
    await db.prepare("INSERT INTO config_versions (id, version, status, config_json, config_sha256, evaluation_report_json, created_by, created_at) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)")
      .bind(id, input.version, configJson, configSha256, input.evaluationReport ? JSON.stringify(input.evaluationReport) : null, input.createdBy, createdAt).run();
  }
  await appendAudit({ actorId: input.createdBy, actorRole: "admin", eventType: "config.draft_created", targetType: "config_version", targetId: id, occurredAt: createdAt, metadata: { version: input.version } }, db ?? undefined);
  return { id, version: input.version, status: "draft", configSha256 };
}

export async function attachConfigEvaluationReport(input: { id: string; report: Record<string, unknown>; attachedBy: string }) {
  const db = d1Database();
  const at = new Date().toISOString();
  let configSha256 = "";
  if (!db) {
    const item = ephemeralState().configs.find((value) => value.id === input.id && value.status === "draft");
    if (!item) throw new Error("CONFIG_NOT_FOUND");
    configSha256 = await sha256(JSON.stringify(validatePhase1Config(mergePhase1Config(item.config))));
    if (input.report.configSha256 !== configSha256) throw new Error("CONFIG_EVALUATION_HASH_MISMATCH");
    item.evaluationReport = structuredClone(input.report);
  } else {
    const row = await db.prepare("SELECT config_sha256 FROM config_versions WHERE id = ? AND status = 'draft'")
      .bind(input.id).first<{ config_sha256: string }>();
    if (!row) throw new Error("CONFIG_NOT_FOUND");
    configSha256 = row.config_sha256;
    if (input.report.configSha256 !== configSha256) throw new Error("CONFIG_EVALUATION_HASH_MISMATCH");
    await db.prepare("UPDATE config_versions SET evaluation_report_json = ? WHERE id = ? AND status = 'draft'")
      .bind(JSON.stringify(input.report), input.id).run();
  }
  await appendAudit({
    actorId: input.attachedBy,
    actorRole: "admin",
    eventType: "config.evaluation_attached",
    targetType: "config_version",
    targetId: input.id,
    occurredAt: at,
    metadata: {
      configSha256,
      reportSchema: input.report.schemaVersion ?? null,
      automatedPassed: input.report.passed === true,
      toneReviewStatus: (input.report.toneReview as Record<string, unknown> | undefined)?.status ?? null,
    },
  }, db ?? undefined);
  return { id: input.id, configSha256, evaluationAttached: true, attachedAt: at };
}

export async function activateConfigVersion(input: { id: string; approvedBy: string }) {
  const db = d1Database();
  const at = new Date().toISOString();
  let version = "";
  if (!db) {
    const item = ephemeralState().configs.find((value) => value.id === input.id);
    if (!item) throw new Error("CONFIG_NOT_FOUND");
    const configSha256 = await sha256(JSON.stringify(validatePhase1Config(mergePhase1Config(item.config))));
    if (!item.evaluationReport || !evaluationPasses(item.evaluationReport, configSha256)) throw new Error("CONFIG_EVALUATION_GATE_FAILED");
    ephemeralState().configs.forEach((value) => { if (value.status === "active") value.status = "retired"; });
    item.status = "active";
    version = item.version;
  } else {
    const row = await db.prepare("SELECT version, config_sha256, evaluation_report_json FROM config_versions WHERE id = ? AND status = 'draft'")
      .bind(input.id).first<{ version: string; config_sha256: string; evaluation_report_json: string | null }>();
    if (!row) throw new Error("CONFIG_NOT_FOUND");
    if (!row.evaluation_report_json || !evaluationPasses(JSON.parse(row.evaluation_report_json), row.config_sha256)) throw new Error("CONFIG_EVALUATION_GATE_FAILED");
    version = row.version;
    await db.batch([
      db.prepare("UPDATE config_versions SET status = 'retired', retired_at = ? WHERE status = 'active'").bind(at),
      db.prepare("UPDATE config_versions SET status = 'active', approved_by = ?, activated_at = ? WHERE id = ?").bind(input.approvedBy, at, input.id),
    ]);
  }
  await appendAudit({ actorId: input.approvedBy, actorRole: "admin", eventType: "config.activated", targetType: "config_version", targetId: input.id, occurredAt: at, metadata: { version } }, db ?? undefined);
  return { id: input.id, version, status: "active", activatedAt: at };
}

function scheduledNotificationCopy(kind: string, payload: Record<string, unknown>, config: Phase1Config) {
  if (kind === "module-release") return {
    kind: "module-release" as const,
    title: config.reminders.moduleTitle,
    body: config.reminders.moduleBody.replace(/\{\{moduleTitle\}\}/gu, typeof payload.title === "string" ? payload.title : "今天的课程"),
  };
  if (kind === "inactivity-check") return {
    kind: "inactivity-recall" as const,
    title: config.reminders.inactivityTitle,
    body: config.reminders.inactivityBody,
  };
  return {
    kind: "ema-reminder" as const,
    title: config.reminders.emaTitle,
    body: config.reminders.emaBody,
  };
}

export type ScheduledNotificationGenerator = (input: {
  kind: "module-release" | "ema-reminder" | "inactivity-check";
  templateTitle: string;
  templateBody: string;
  currentWeek: number;
  completedModules: number;
  currentModuleTitle?: string;
  recentEmaCount: number;
}) => Promise<{ title: string; body: string; model?: string; provider?: string } | null>;

async function deliverBrowserPush(
  db: D1Database,
  userId: string,
  notification: { id: string; title: string; body: string; kind: string },
) {
  const config = webPushConfig();
  if (!config.configured) return { attempted: 0, delivered: 0 };
  const rows = await db.prepare(
    "SELECT id, subscription_ciphertext FROM push_subscriptions WHERE user_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 5",
  ).bind(userId).all<{ id: string; subscription_ciphertext: string }>();
  const encryption = encryptionSecret();
  let delivered = 0;
  for (const row of rows.results) {
    let status = "failed";
    try {
      const subscription = await openJson<StoredPushSubscription>(row.subscription_ciphertext, encryption.value);
      const result = await sendWebPush(subscription, {
        title: notification.title,
        body: notification.body,
        tag: `nssi-${notification.kind}`,
        notificationId: notification.id,
        url: "/?notification=1",
      }, config);
      status = result.ok ? "delivered" : `http-${result.status}`;
      if (result.ok) delivered += 1;
      await db.prepare(
        "UPDATE push_subscriptions SET status = ?, last_delivered_at = ?, last_error = ?, updated_at = ? WHERE id = ?",
      ).bind(result.expired ? "expired" : "active", result.ok ? new Date().toISOString() : null, result.ok ? null : status, new Date().toISOString(), row.id).run();
    } catch (error) {
      status = error instanceof Error ? error.message.slice(0, 120) : "push-failed";
      await db.prepare("UPDATE push_subscriptions SET last_error = ?, updated_at = ? WHERE id = ?")
        .bind(status, new Date().toISOString(), row.id).run();
    }
    await appendAudit({
      actorId: "scheduler",
      actorRole: "system",
      eventType: "push.delivery_attempted",
      targetType: "notification",
      targetId: notification.id,
      occurredAt: new Date().toISOString(),
      metadata: { subscriptionId: row.id, status },
    }, db);
  }
  return { attempted: rows.results.length, delivered };
}

export async function processDueScheduledJobs(
  at = new Date().toISOString(),
  limit = 100,
  generateCopy?: ScheduledNotificationGenerator,
) {
  const db = d1Database();
  if (!db) return { processed: 0, delivered: 0, skipped: 0, storage: "ephemeral-development" };
  const activeConfig = (await getActivePhase1Config()).config;
  const result = await db.prepare(
    "SELECT * FROM scheduled_jobs WHERE status = 'pending' AND scheduled_for <= ? ORDER BY scheduled_for ASC LIMIT ?",
  ).bind(at, limit).all<Record<string, string | number | null>>();
  let delivered = 0;
  let skipped = 0;
  for (const row of result.results) {
    const userId = String(row.user_id);
    const kind = String(row.kind);
    const payload = JSON.parse(String(row.payload_json)) as Record<string, unknown>;
    if (kind === "inactivity-check") {
      const activity = await db.prepare(`
        SELECT MAX(activity_at) AS activity_at FROM (
          SELECT updated_at AS activity_at FROM protocol_states WHERE user_id = ?
          UNION ALL SELECT submitted_at FROM ema_records WHERE user_id = ? AND deleted_at IS NULL
          UNION ALL SELECT used_at FROM skill_logs WHERE user_id = ? AND deleted_at IS NULL
        )
      `).bind(userId, userId, userId).first<{ activity_at: string | null }>();
      const inactiveMs = Date.parse(at) - Date.parse(activity?.activity_at ?? at);
      const inactivityDays = Math.max(1, Number(payload.inactivityDays) || 7);
      if (inactiveMs < inactivityDays * 24 * 60 * 60 * 1000) {
        await db.prepare("UPDATE scheduled_jobs SET status = 'skipped', delivered_at = ? WHERE id = ? AND status = 'pending'")
          .bind(at, String(row.id)).run();
        skipped += 1;
        continue;
      }
    }
    if (kind === "module-release") {
      const protocol = await readProtocol(db, userId);
      const recalculated = applyProtocolCommand(protocol, { type: "recalculate", at });
      const stateJson = JSON.stringify(recalculated);
      await db.prepare("UPDATE protocol_states SET state_json = ?, state_sha256 = ?, updated_at = ? WHERE user_id = ?")
        .bind(stateJson, await sha256(stateJson), at, userId).run();
    }
    const templateCopy = scheduledNotificationCopy(kind, payload, activeConfig);
    const protocol = await readProtocol(db, userId);
    const recentEma = await db.prepare(
      "SELECT COUNT(*) AS count FROM ema_records WHERE user_id = ? AND is_backfill = 0 AND deleted_at IS NULL AND submitted_at >= ?",
    ).bind(userId, new Date(Date.parse(at) - 7 * 24 * 60 * 60 * 1000).toISOString()).first<{ count: number }>();
    const currentModule = modulesWithConfig(activeConfig).find((module) => module.id === protocol.currentModuleId);
    const generatedCopy = generateCopy ? await generateCopy({
      kind: kind as "module-release" | "ema-reminder" | "inactivity-check",
      templateTitle: templateCopy.title,
      templateBody: templateCopy.body,
      currentWeek: protocol.currentWeek,
      completedModules: protocol.completedModuleIds.length,
      currentModuleTitle: currentModule?.title,
      recentEmaCount: Number(recentEma?.count ?? 0),
    }) : null;
    const copy = generatedCopy ? { ...templateCopy, title: generatedCopy.title, body: generatedCopy.body } : templateCopy;
    const notificationId = crypto.randomUUID();
    await db.batch([
      db.prepare("INSERT INTO notifications (id, user_id, kind, title, body, template_version, source_job_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'unread', ?)")
        .bind(notificationId, userId, copy.kind, copy.title, copy.body, String(row.template_version), String(row.id), at),
      db.prepare("UPDATE scheduled_jobs SET status = 'delivered', delivered_at = ? WHERE id = ? AND status = 'pending'")
        .bind(at, String(row.id)),
    ]);
    const push = await deliverBrowserPush(db, userId, {
      id: notificationId,
      title: copy.title,
      body: copy.body,
      kind: copy.kind,
    });
    await appendAudit({
      actorId: "scheduler", actorRole: "system", eventType: "notification.delivered", targetType: "notification", targetId: notificationId,
      occurredAt: at, metadata: {
        jobId: String(row.id), kind, templateVersion: String(row.template_version),
        generationStatus: generatedCopy ? "agent-generated-and-validated" : "template-fallback",
        model: generatedCopy?.model ?? null,
        provider: generatedCopy?.provider ?? null,
        pushAttempted: push.attempted,
        pushDelivered: push.delivered,
      },
    }, db);
    delivered += 1;
  }
  return { processed: result.results.length, delivered, skipped, storage: "cloudflare-d1" };
}

export async function updateRiskEventAsCoach(input: { riskEventId: string; coachId: string; action: "acknowledge" | "close"; note?: string }) {
  const db = d1Database();
  const at = new Date().toISOString();
  if (!db) {
    const risk = [...ephemeralState().participants.values()].flatMap((participant) => participant.risks)
      .find((item) => item.id === input.riskEventId);
    if (!risk) throw new Error("RISK_EVENT_NOT_FOUND");
    if (input.action === "acknowledge") {
      risk.status = "acknowledged";
      risk.acknowledgedAt = at;
    } else {
      risk.status = "closed";
      risk.closedAt = at;
      risk.closedBy = input.coachId;
    }
  } else {
    const encryption = encryptionSecret();
    const note = input.note ? await sealJson({ note: input.note }, encryption.value) : null;
    const sql = input.action === "acknowledge"
      ? "UPDATE risk_events SET status = 'acknowledged', acknowledged_at = ? WHERE id = ? AND status != 'closed'"
      : "UPDATE risk_events SET status = 'closed', closed_at = ?, closed_by = ?, closure_note_ciphertext = ?, key_version = COALESCE(key_version, ?) WHERE id = ? AND status != 'closed'";
    const result = input.action === "acknowledge"
      ? await db.prepare(sql).bind(at, input.riskEventId).run()
      : await db.prepare(sql).bind(at, input.coachId, note, encryption.keyVersion, input.riskEventId).run();
    if (!result.meta.changes) throw new Error("RISK_EVENT_NOT_FOUND_OR_ALREADY_CLOSED");
  }
  await appendAudit({
    actorId: input.coachId, actorRole: "coach", eventType: `risk.${input.action}`, targetType: "risk_event", targetId: input.riskEventId,
    occurredAt: at, metadata: { notePresent: Boolean(input.note) },
  }, db ?? undefined);
}
