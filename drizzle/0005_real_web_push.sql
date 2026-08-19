CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint_hash` text NOT NULL,
	`subscription_ciphertext` text NOT NULL,
	`key_version` text NOT NULL,
	`user_agent` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_delivered_at` text,
	`last_error` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_hash_unique` ON `push_subscriptions` (`endpoint_hash`);
--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_status_idx` ON `push_subscriptions` (`user_id`,`status`);
