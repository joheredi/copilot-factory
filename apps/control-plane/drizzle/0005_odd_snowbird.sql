CREATE TABLE `audit_event` (
	`audit_event_id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`event_type` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`old_state` text,
	`new_state` text,
	`metadata_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_event_entity` ON `audit_event` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_event_created_at` ON `audit_event` (`created_at`);--> statement-breakpoint
CREATE TABLE `policy_set` (
	`policy_set_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`scheduling_policy_json` text,
	`review_policy_json` text,
	`merge_policy_json` text,
	`security_policy_json` text,
	`validation_policy_json` text,
	`budget_policy_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
