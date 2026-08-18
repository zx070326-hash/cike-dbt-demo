CREATE TABLE `deletion_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`subject_hash` text NOT NULL,
	`status` text DEFAULT 'requested' NOT NULL,
	`requested_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`processed_at` text,
	`processing_summary_json` text
);
--> statement-breakpoint
CREATE INDEX `deletion_requests_status_idx` ON `deletion_requests` (`status`,`requested_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`template_version` text NOT NULL,
	`source_job_id` text,
	`status` text DEFAULT 'unread' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`read_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notifications_user_status_created_idx` ON `notifications` (`user_id`,`status`,`created_at`);