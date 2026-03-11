CREATE TABLE `task_dependency` (
	`task_dependency_id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`depends_on_task_id` text NOT NULL,
	`dependency_type` text NOT NULL,
	`is_hard_block` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`task_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`depends_on_task_id`) REFERENCES `task`(`task_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_task_dependency_unique` ON `task_dependency` (`task_id`,`depends_on_task_id`);--> statement-breakpoint
CREATE INDEX `idx_task_dependency_task_id` ON `task_dependency` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_task_dependency_depends_on` ON `task_dependency` (`depends_on_task_id`);--> statement-breakpoint
CREATE TABLE `task` (
	`task_id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`external_ref` text,
	`title` text NOT NULL,
	`description` text,
	`task_type` text NOT NULL,
	`priority` text NOT NULL,
	`severity` text,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`acceptance_criteria` text,
	`definition_of_done` text,
	`estimated_size` text,
	`risk_level` text,
	`required_capabilities` text,
	`suggested_file_scope` text,
	`branch_name` text,
	`current_lease_id` text,
	`current_review_cycle_id` text,
	`merge_queue_item_id` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`review_round_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`repository_id`) REFERENCES `repository`(`repository_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_task_repository_id_status` ON `task` (`repository_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_task_status` ON `task` (`status`);--> statement-breakpoint
CREATE INDEX `idx_task_priority` ON `task` (`priority`);