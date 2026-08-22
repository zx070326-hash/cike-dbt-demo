ALTER TABLE `session_summaries` ADD `conversation_id` text;--> statement-breakpoint
ALTER TABLE `session_summaries` ADD `raw_retention` text DEFAULT 'summary-only' NOT NULL;--> statement-breakpoint
ALTER TABLE `session_summaries` ADD `raw_expires_at` text;--> statement-breakpoint
ALTER TABLE `session_summaries` ADD `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `session_summaries_user_conversation_unique` ON `session_summaries` (`user_id`,`conversation_id`);--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `expires_at` text;--> statement-breakpoint
UPDATE `chat_messages` SET `expires_at` = datetime(`created_at`, '+30 days') WHERE `expires_at` IS NULL;
