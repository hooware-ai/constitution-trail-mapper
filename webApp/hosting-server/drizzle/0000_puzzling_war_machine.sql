CREATE TABLE `feedback_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`created_at` integer NOT NULL,
	`body_hash` text NOT NULL,
	`rate_key` text
);
--> statement-breakpoint
CREATE INDEX `feedback_created` ON `feedback_submissions` (`created_at`);--> statement-breakpoint
CREATE INDEX `feedback_rate` ON `feedback_submissions` (`rate_key`,`created_at`);