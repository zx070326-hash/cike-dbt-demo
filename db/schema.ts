import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Product data is deliberately structured and minimal. Raw chat transcripts
// are not a persistence primitive. Sensitive practice/safety payloads must be
// encrypted by the application before they reach these columns.
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  externalSubjectHash: text("external_subject_hash").notNull().unique(),
  ageDeclaredAdult: integer("age_declared_adult", { mode: "boolean" }).notNull().default(false),
  timezone: text("timezone").notNull().default("Asia/Shanghai"),
  monitoringDisclosureVersion: text("monitoring_disclosure_version"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  deletedAt: text("deleted_at"),
  deidentifiedAt: text("deidentified_at"),
});

export const consents = sqliteTable("consents", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  policyKind: text("policy_kind").notNull(),
  policyVersion: text("policy_version").notNull(),
  acceptedAt: text("accepted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  withdrawnAt: text("withdrawn_at"),
}, (table) => [index("consents_user_idx").on(table.userId)]);

export const practiceRecords = sqliteTable("practice_records", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  workflowId: text("workflow_id").notNull(),
  workflowVersion: text("workflow_version").notNull(),
  payloadCiphertext: text("payload_ciphertext").notNull(),
  keyVersion: text("key_version").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  deletedAt: text("deleted_at"),
}, (table) => [index("practice_records_user_created_idx").on(table.userId, table.createdAt)]);

export const sessionSummaries = sqliteTable("session_summaries", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  goalCode: text("goal_code").notNull(),
  selectedSkillId: text("selected_skill_id"),
  payloadCiphertext: text("payload_ciphertext").notNull(),
  keyVersion: text("key_version").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  deletedAt: text("deleted_at"),
}, (table) => [index("session_summaries_user_created_idx").on(table.userId, table.createdAt)]);

export const safetyPlans = sqliteTable("safety_plans", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  payloadCiphertext: text("payload_ciphertext").notNull(),
  keyVersion: text("key_version").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  deletedAt: text("deleted_at"),
}, (table) => [index("safety_plans_user_idx").on(table.userId)]);

// One row per immutable plan version. safety_plans remains a compatibility
// pointer for the previous demo schema; new product reads use this table.
export const safetyPlanVersions = sqliteTable("safety_plan_versions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  version: integer("version").notNull(),
  payloadCiphertext: text("payload_ciphertext").notNull(),
  keyVersion: text("key_version").notNull(),
  createdByRole: text("created_by_role").notNull(),
  contentReviewVersion: text("content_review_version").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("safety_plan_versions_user_version_uq").on(table.userId, table.version),
  index("safety_plan_versions_user_created_idx").on(table.userId, table.createdAt),
]);

export const protocolStates = sqliteTable("protocol_states", {
  userId: text("user_id").primaryKey().references(() => users.id),
  schemaVersion: text("schema_version").notNull(),
  protocolVersion: text("protocol_version").notNull(),
  stateJson: text("state_json").notNull(),
  stateSha256: text("state_sha256").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const moduleSubmissions = sqliteTable("module_submissions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  moduleId: text("module_id").notNull(),
  moduleVersion: text("module_version").notNull(),
  exerciseId: text("exercise_id").notNull(),
  payloadCiphertext: text("payload_ciphertext").notNull(),
  keyVersion: text("key_version").notNull(),
  submittedAt: text("submitted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("module_submissions_user_module_idx").on(table.userId, table.moduleId)]);

export const emaRecords = sqliteTable("ema_records", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  localDate: text("local_date").notNull(),
  urge: integer("urge").notNull(),
  moodsJson: text("moods_json").notNull().default("[]"),
  skillsJson: text("skills_json").notNull().default("[]"),
  noteCiphertext: text("note_ciphertext"),
  keyVersion: text("key_version"),
  isBackfill: integer("is_backfill", { mode: "boolean" }).notNull().default(false),
  completionDurationMs: integer("completion_duration_ms"),
  thresholdVersion: text("threshold_version").notNull(),
  riskEvaluationJson: text("risk_evaluation_json").notNull(),
  submittedAt: text("submitted_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  deletedAt: text("deleted_at"),
}, (table) => [
  uniqueIndex("ema_records_user_date_uq").on(table.userId, table.localDate),
  index("ema_records_user_submitted_idx").on(table.userId, table.submittedAt),
]);

export const skillLogs = sqliteTable("skill_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  skillId: text("skill_id").notNull(),
  skillIdsJson: text("skill_ids_json").notNull().default("[]"),
  intensityBefore: integer("intensity_before").notNull(),
  intensityAfter: integer("intensity_after").notNull(),
  targetType: text("target_type"),
  outcomesJson: text("outcomes_json").notNull().default("[]"),
  noteCiphertext: text("note_ciphertext"),
  keyVersion: text("key_version"),
  usedAt: text("used_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  deletedAt: text("deleted_at"),
}, (table) => [index("skill_logs_user_used_idx").on(table.userId, table.usedAt)]);

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  conversationId: text("conversation_id").notNull(),
  role: text("role").notNull(),
  messageCiphertext: text("message_ciphertext").notNull(),
  keyVersion: text("key_version").notNull(),
  mode: text("mode").notNull(),
  citationsJson: text("citations_json").notNull().default("[]"),
  claimsJson: text("claims_json").notNull().default("[]"),
  validatorJson: text("validator_json").notNull().default("{}"),
  promptVersion: text("prompt_version"),
  modelProvider: text("model_provider"),
  modelName: text("model_name"),
  tokenUsageJson: text("token_usage_json"),
  latencyMs: integer("latency_ms"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  deletedAt: text("deleted_at"),
}, (table) => [index("chat_messages_user_conversation_idx").on(table.userId, table.conversationId, table.createdAt)]);

export const riskEvents = sqliteTable("risk_events", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  participantPseudonym: text("participant_pseudonym").notNull(),
  level: text("level").notNull(),
  sourcesJson: text("sources_json").notNull(),
  status: text("status").notNull().default("open"),
  evidenceCiphertext: text("evidence_ciphertext"),
  keyVersion: text("key_version"),
  notificationStateJson: text("notification_state_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  notificationDeadlineAt: text("notification_deadline_at"),
  humanSlaDeadlineAt: text("human_sla_deadline_at"),
  acknowledgedAt: text("acknowledged_at"),
  participantMarkedSafeAt: text("participant_marked_safe_at"),
  closedAt: text("closed_at"),
  closedBy: text("closed_by"),
  closureNoteCiphertext: text("closure_note_ciphertext"),
  deidentifiedAt: text("deidentified_at"),
}, (table) => [
  index("risk_events_status_level_created_idx").on(table.status, table.level, table.createdAt),
  index("risk_events_user_created_idx").on(table.userId, table.createdAt),
]);

export const scheduledJobs = sqliteTable("scheduled_jobs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  kind: text("kind").notNull(),
  scheduledFor: text("scheduled_for").notNull(),
  payloadJson: text("payload_json").notNull().default("{}"),
  templateVersion: text("template_version").notNull(),
  status: text("status").notNull().default("pending"),
  deliveredAt: text("delivered_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("scheduled_jobs_due_idx").on(table.status, table.scheduledFor)]);

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  templateVersion: text("template_version").notNull(),
  sourceJobId: text("source_job_id"),
  status: text("status").notNull().default("unread"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  readAt: text("read_at"),
}, (table) => [index("notifications_user_status_created_idx").on(table.userId, table.status, table.createdAt)]);

export const deletionRequests = sqliteTable("deletion_requests", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  subjectHash: text("subject_hash").notNull(),
  status: text("status").notNull().default("requested"),
  requestedAt: text("requested_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  processedAt: text("processed_at"),
  processingSummaryJson: text("processing_summary_json"),
}, (table) => [index("deletion_requests_status_idx").on(table.status, table.requestedAt)]);

export const contentVersions = sqliteTable("content_versions", {
  id: text("id").primaryKey(),
  schemaVersion: text("schema_version").notNull(),
  sourceManifestSha256: text("source_manifest_sha256").notNull(),
  coverageJson: text("coverage_json").notNull(),
  status: text("status").notNull(),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const configVersions = sqliteTable("config_versions", {
  id: text("id").primaryKey(),
  version: text("version").notNull().unique(),
  status: text("status").notNull().default("draft"),
  configJson: text("config_json").notNull(),
  configSha256: text("config_sha256").notNull(),
  evaluationReportJson: text("evaluation_report_json"),
  createdBy: text("created_by").notNull(),
  approvedBy: text("approved_by"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  activatedAt: text("activated_at"),
  retiredAt: text("retired_at"),
});

export const contentReviews = sqliteTable("content_reviews", {
  id: text("id").primaryKey(),
  contentVersionId: text("content_version_id").notNull().references(() => contentVersions.id),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  reviewerRole: text("reviewer_role").notNull(),
  decision: text("decision").notNull(),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("content_reviews_subject_idx").on(table.subjectType, table.subjectId)]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  actorId: text("actor_id"),
  eventType: text("event_type").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  actorRole: text("actor_role").notNull().default("system"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  previousHash: text("previous_hash"),
  eventHash: text("event_hash").notNull().default("legacy-unhashed"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("audit_events_type_created_idx").on(table.eventType, table.createdAt)]);
