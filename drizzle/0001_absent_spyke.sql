PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_template_exercises` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_id` integer NOT NULL,
	`exercise_id` integer NOT NULL,
	`order_index` integer NOT NULL,
	`target_sets` integer,
	`target_reps` integer,
	`target_rep_min` integer,
	`target_rep_max` integer,
	`rest_s` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "template_exercises_rep_range_ck" CHECK(target_rep_min IS NULL OR target_rep_max IS NULL OR target_rep_max >= target_rep_min)
) STRICT;
--> statement-breakpoint
-- HAND-FIXED: drizzle-kit emitted `SELECT ... "target_rep_min", "target_rep_max"`
-- from the OLD table, which does not have those columns yet. The rebuild is
-- forced by the new CHECK constraint; the two added columns start NULL.
INSERT INTO `__new_template_exercises`("id", "template_id", "exercise_id", "order_index", "target_sets", "target_reps", "target_rep_min", "target_rep_max", "rest_s", "notes", "created_at", "updated_at", "deleted_at") SELECT "id", "template_id", "exercise_id", "order_index", "target_sets", "target_reps", NULL, NULL, "rest_s", "notes", "created_at", "updated_at", "deleted_at" FROM `template_exercises`;--> statement-breakpoint
DROP TABLE `template_exercises`;--> statement-breakpoint
ALTER TABLE `__new_template_exercises` RENAME TO `template_exercises`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `template_exercises_template` ON `template_exercises` (`template_id`,`order_index`);