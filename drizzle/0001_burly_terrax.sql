CREATE TABLE `account_journals` (
	`owner` text NOT NULL,
	`admin_id` integer NOT NULL,
	`json` text NOT NULL,
	`revision` integer NOT NULL,
	`previous_json` text,
	`previous_revision` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner`, `admin_id`),
	FOREIGN KEY (`admin_id`) REFERENCES `admin`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "journal_revision" CHECK("account_journals"."revision" >= 1 AND "account_journals"."revision" <= 9007199254740991),
	CONSTRAINT "journal_backup" CHECK(("account_journals"."previous_json" IS NULL AND "account_journals"."previous_revision" IS NULL) OR ("account_journals"."previous_json" IS NOT NULL AND "account_journals"."previous_revision" IS NOT NULL AND "account_journals"."previous_revision" >= 1 AND "account_journals"."previous_revision" < "account_journals"."revision"))
);
