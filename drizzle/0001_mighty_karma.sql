CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`message_ciphertext` text NOT NULL,
	`key_version` text NOT NULL,
	`mode` text NOT NULL,
	`citations_json` text DEFAULT '[]' NOT NULL,
	`claims_json` text DEFAULT '[]' NOT NULL,
	`validator_json` text DEFAULT '{}' NOT NULL,
	`prompt_version` text,
	`model_provider` text,
	`model_name` text,
	`token_usage_json` text,
	`latency_ms` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `chat_messages_user_conversation_idx` ON `chat_messages` (`user_id`,`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `config_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`config_json` text NOT NULL,
	`config_sha256` text NOT NULL,
	`evaluation_report_json` text,
	`created_by` text NOT NULL,
	`approved_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`activated_at` text,
	`retired_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `config_versions_version_unique` ON `config_versions` (`version`);--> statement-breakpoint
CREATE TABLE `ema_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`local_date` text NOT NULL,
	`urge` integer NOT NULL,
	`moods_json` text DEFAULT '[]' NOT NULL,
	`skills_json` text DEFAULT '[]' NOT NULL,
	`note_ciphertext` text,
	`key_version` text,
	`is_backfill` integer DEFAULT false NOT NULL,
	`threshold_version` text NOT NULL,
	`risk_evaluation_json` text NOT NULL,
	`submitted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ema_records_user_date_uq` ON `ema_records` (`user_id`,`local_date`);--> statement-breakpoint
CREATE INDEX `ema_records_user_submitted_idx` ON `ema_records` (`user_id`,`submitted_at`);--> statement-breakpoint
CREATE TABLE `module_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`module_id` text NOT NULL,
	`module_version` text NOT NULL,
	`exercise_id` text NOT NULL,
	`payload_ciphertext` text NOT NULL,
	`key_version` text NOT NULL,
	`submitted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `module_submissions_user_module_idx` ON `module_submissions` (`user_id`,`module_id`);--> statement-breakpoint
CREATE TABLE `protocol_states` (
	`user_id` text PRIMARY KEY NOT NULL,
	`schema_version` text NOT NULL,
	`protocol_version` text NOT NULL,
	`state_json` text NOT NULL,
	`state_sha256` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `risk_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`participant_pseudonym` text NOT NULL,
	`level` text NOT NULL,
	`sources_json` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`evidence_ciphertext` text,
	`key_version` text,
	`notification_state_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`acknowledged_at` text,
	`participant_marked_safe_at` text,
	`closed_at` text,
	`closed_by` text,
	`closure_note_ciphertext` text,
	`deidentified_at` text
);
--> statement-breakpoint
CREATE INDEX `risk_events_status_level_created_idx` ON `risk_events` (`status`,`level`,`created_at`);--> statement-breakpoint
CREATE INDEX `risk_events_user_created_idx` ON `risk_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `safety_plan_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`version` integer NOT NULL,
	`payload_ciphertext` text NOT NULL,
	`key_version` text NOT NULL,
	`created_by_role` text NOT NULL,
	`content_review_version` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `safety_plan_versions_user_version_uq` ON `safety_plan_versions` (`user_id`,`version`);--> statement-breakpoint
CREATE INDEX `safety_plan_versions_user_created_idx` ON `safety_plan_versions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `scheduled_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`scheduled_for` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`template_version` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`delivered_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `scheduled_jobs_due_idx` ON `scheduled_jobs` (`status`,`scheduled_for`);--> statement-breakpoint
CREATE TABLE `skill_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`intensity_before` integer NOT NULL,
	`intensity_after` integer NOT NULL,
	`note_ciphertext` text,
	`key_version` text,
	`used_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `skill_logs_user_used_idx` ON `skill_logs` (`user_id`,`used_at`);--> statement-breakpoint
ALTER TABLE `audit_events` ADD `actor_role` text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `previous_hash` text;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `event_hash` text DEFAULT 'legacy-unhashed' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `age_declared_adult` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `timezone` text DEFAULT 'Asia/Shanghai' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `monitoring_disclosure_version` text;--> statement-breakpoint
ALTER TABLE `users` ADD `deidentified_at` text;