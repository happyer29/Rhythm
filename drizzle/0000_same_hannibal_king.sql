CREATE TABLE `admin` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`username` text NOT NULL,
	`salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "singleton_admin" CHECK("admin"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `auth_attempts` (
	`identity` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_expiry` ON `sessions` (`expires_at`);