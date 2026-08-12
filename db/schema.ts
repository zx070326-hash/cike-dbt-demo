import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Product data is deliberately structured and minimal. Raw chat transcripts
// are not a persistence primitive. Sensitive practice/safety payloads must be
// encrypted by the application before they reach these columns.
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  externalSubjectHash: text("external_subject_hash").notNull().unique(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  deletedAt: text("deleted_at"),
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

export const contentVersions = sqliteTable("content_versions", {
  id: text("id").primaryKey(),
  schemaVersion: text("schema_version").notNull(),
  sourceManifestSha256: text("source_manifest_sha256").notNull(),
  coverageJson: text("coverage_json").notNull(),
  status: text("status").notNull(),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
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
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("audit_events_type_created_idx").on(table.eventType, table.createdAt)]);
