CREATE TABLE `job` (
	`job_id` text PRIMARY KEY NOT NULL,
	`job_type` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`payload_json` text,
	`status` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`run_after` integer,
	`lease_owner` text,
	`parent_job_id` text,
	`job_group_id` text,
	`depends_on_job_ids` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_job_status_run_after` ON `job` (`status`,`run_after`);--> statement-breakpoint
CREATE INDEX `idx_job_group_id` ON `job` (`job_group_id`);--> statement-breakpoint
CREATE INDEX `idx_job_parent_job_id` ON `job` (`parent_job_id`);--> statement-breakpoint
CREATE TABLE `merge_queue_item` (
	`merge_queue_item_id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`repository_id` text NOT NULL,
	`status` text NOT NULL,
	`position` integer NOT NULL,
	`approved_commit_sha` text,
	`enqueued_at` integer DEFAULT (unixepoch()) NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`task_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repository_id`) REFERENCES `repository`(`repository_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_merge_queue_item_repo_status` ON `merge_queue_item` (`repository_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_merge_queue_item_task_id` ON `merge_queue_item` (`task_id`);--> statement-breakpoint
CREATE TABLE `validation_run` (
	`validation_run_id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`run_scope` text NOT NULL,
	`status` text NOT NULL,
	`tool_name` text,
	`summary` text,
	`artifact_refs` text,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`task_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_validation_run_task_id` ON `validation_run` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_validation_run_task_scope` ON `validation_run` (`task_id`,`run_scope`);