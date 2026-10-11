CREATE TABLE `submission_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `limits_expiry` ON `submission_limits` (`expires_at`);--> statement-breakpoint
ALTER TABLE `feedback_submissions` ADD `counted` integer DEFAULT 0 NOT NULL;