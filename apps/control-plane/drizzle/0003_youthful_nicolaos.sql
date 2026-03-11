CREATE TABLE `lead_review_decision` (
	`lead_review_decision_id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`review_cycle_id` text NOT NULL,
	`decision` text NOT NULL,
	`blocking_issue_count` integer DEFAULT 0 NOT NULL,
	`non_blocking_issue_count` integer DEFAULT 0 NOT NULL,
	`follow_up_task_refs` text,
	`packet_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`task_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_cycle_id`) REFERENCES `review_cycle`(`review_cycle_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_lead_review_decision_task_id` ON `lead_review_decision` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_lead_review_decision_cycle_id` ON `lead_review_decision` (`review_cycle_id`);--> statement-breakpoint
CREATE TABLE `review_cycle` (
	`review_cycle_id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`status` text NOT NULL,
	`required_reviewers` text,
	`optional_reviewers` text,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`task_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_review_cycle_task_id` ON `review_cycle` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_review_cycle_status` ON `review_cycle` (`status`);--> statement-breakpoint
CREATE TABLE `review_packet` (
	`review_packet_id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`review_cycle_id` text NOT NULL,
	`reviewer_pool_id` text,
	`reviewer_type` text NOT NULL,
	`verdict` text NOT NULL,
	`severity_summary` text,
	`packet_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`task_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_cycle_id`) REFERENCES `review_cycle`(`review_cycle_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_review_packet_task_cycle` ON `review_packet` (`task_id`,`review_cycle_id`);--> statement-breakpoint
CREATE INDEX `idx_review_packet_verdict` ON `review_packet` (`verdict`);--> statement-breakpoint
CREATE TABLE `task_lease` (
	`lease_id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`worker_id` text NOT NULL,
	`pool_id` text NOT NULL,
	`leased_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer NOT NULL,
	`heartbeat_at` integer,
	`status` text NOT NULL,
	`reclaim_reason` text,
	`partial_result_artifact_refs` text,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`task_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pool_id`) REFERENCES `worker_pool`(`worker_pool_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_task_lease_task_id` ON `task_lease` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_task_lease_worker_id` ON `task_lease` (`worker_id`);--> statement-breakpoint
CREATE INDEX `idx_task_lease_status` ON `task_lease` (`status`);