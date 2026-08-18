ALTER TABLE `skill_logs` ADD `skill_ids_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `skill_logs` ADD `target_type` text;--> statement-breakpoint
ALTER TABLE `skill_logs` ADD `outcomes_json` text DEFAULT '[]' NOT NULL;