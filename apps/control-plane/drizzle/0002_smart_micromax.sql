CREATE TABLE `agent_profile` (
	`agent_profile_id` text PRIMARY KEY NOT NULL,
	`pool_id` text NOT NULL,
	`prompt_template_id` text,
	`tool_policy_id` text,
	`command_policy_id` text,
	`file_scope_policy_id` text,
	`validation_policy_id` text,
	`review_policy_id` text,
	`budget_policy_id` text,
	`retry_policy_id` text,
	FOREIGN KEY (`pool_id`) REFERENCES `worker_pool`(`worker_pool_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prompt_template_id`) REFERENCES `prompt_template`(`prompt_template_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_agent_profile_pool_id` ON `agent_profile` (`pool_id`);--> statement-breakpoint
CREATE TABLE `prompt_template` (
	`prompt_template_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`role` text NOT NULL,
	`template_text` text NOT NULL,
	`input_schema` text,
	`output_schema` text,
	`stop_conditions` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_prompt_template_role` ON `prompt_template` (`role`);--> statement-breakpoint
CREATE TABLE `worker_pool` (
	`worker_pool_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`pool_type` text NOT NULL,
	`provider` text,
	`runtime` text,
	`model` text,
	`max_concurrency` integer DEFAULT 1 NOT NULL,
	`default_timeout_sec` integer,
	`default_token_budget` integer,
	`cost_profile` text,
	`capabilities` text,
	`repo_scope_rules` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_worker_pool_pool_type` ON `worker_pool` (`pool_type`);--> statement-breakpoint
CREATE INDEX `idx_worker_pool_enabled` ON `worker_pool` (`enabled`);--> statement-breakpoint
CREATE TABLE `worker` (
	`worker_id` text PRIMARY KEY NOT NULL,
	`pool_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`host` text,
	`runtime_version` text,
	`last_heartbeat_at` integer,
	`current_task_id` text,
	`current_run_id` text,
	`health_metadata` text,
	FOREIGN KEY (`pool_id`) REFERENCES `worker_pool`(`worker_pool_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_task_id`) REFERENCES `task`(`task_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_worker_pool_id` ON `worker` (`pool_id`);--> statement-breakpoint
CREATE INDEX `idx_worker_status` ON `worker` (`status`);