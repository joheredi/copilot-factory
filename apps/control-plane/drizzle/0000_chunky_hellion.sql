CREATE TABLE `project` (
	`project_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`owner` text NOT NULL,
	`default_workflow_template_id` text,
	`default_policy_set_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`default_workflow_template_id`) REFERENCES `workflow_template`(`workflow_template_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_name_unique` ON `project` (`name`);--> statement-breakpoint
CREATE TABLE `repository` (
	`repository_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`remote_url` text NOT NULL,
	`default_branch` text DEFAULT 'main' NOT NULL,
	`local_checkout_strategy` text NOT NULL,
	`credential_profile_id` text,
	`status` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`project_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_repository_project_id` ON `repository` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_repository_status` ON `repository` (`status`);--> statement-breakpoint
CREATE TABLE `workflow_template` (
	`workflow_template_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`task_selection_policy` text,
	`review_routing_policy` text,
	`merge_policy` text,
	`validation_policy_id` text,
	`retry_policy_id` text,
	`escalation_policy_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
