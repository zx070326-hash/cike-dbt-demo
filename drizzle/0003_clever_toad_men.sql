ALTER TABLE `ema_records` ADD `completion_duration_ms` integer;--> statement-breakpoint
ALTER TABLE `risk_events` ADD `notification_deadline_at` text;--> statement-breakpoint
ALTER TABLE `risk_events` ADD `human_sla_deadline_at` text;