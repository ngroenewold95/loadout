CREATE TABLE `bodyweight_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`local_date` text NOT NULL,
	`weight_kg` real NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `bodyweight_date_live` ON `bodyweight_log` (`local_date`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `equipment` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`base_weight_kg` real NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_name_live` ON `equipment` (`name`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `exercise_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exercise_id` integer NOT NULL,
	`alias` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_aliases_alias_live` ON `exercise_aliases` (`alias`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX `exercise_aliases_exercise` ON `exercise_aliases` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`modality` text,
	`primary_muscle` text,
	`tracking_type` text DEFAULT 'weight_reps' NOT NULL,
	`default_load_mode` text DEFAULT 'total' NOT NULL,
	`default_base_weight_kg` real,
	`default_rest_s` integer,
	`preferred_unit` text DEFAULT 'lb' NOT NULL,
	`implement_count` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "exercises_modality_ck" CHECK(modality IS NULL OR modality IN ('barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other')),
	CONSTRAINT "exercises_tracking_ck" CHECK(tracking_type IN ('weight_reps', 'bodyweight', 'duration', 'distance_time')),
	CONSTRAINT "exercises_load_mode_ck" CHECK(default_load_mode IN ('total', 'added', 'assistance')),
	CONSTRAINT "exercises_unit_ck" CHECK(preferred_unit IN ('kg', 'lb')),
	CONSTRAINT "exercises_implement_ck" CHECK(implement_count >= 1)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `exercises_name_live` ON `exercises` (`name`) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text,
	`started_at_utc` integer NOT NULL,
	`ended_at_utc` integer,
	`local_date` text NOT NULL,
	`template_id` integer,
	`bodyweight_kg` real,
	`notes` text,
	`source` text DEFAULT 'native' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sessions_source_ck" CHECK(source IN ('progression_csv', 'native')),
	CONSTRAINT "sessions_local_date_ck" CHECK(local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
) STRICT;
--> statement-breakpoint
CREATE INDEX `sessions_local_date` ON `sessions` (`local_date`);--> statement-breakpoint
CREATE INDEX `sessions_started` ON `sessions` (`started_at_utc`);--> statement-breakpoint
CREATE TABLE `sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`exercise_id` integer NOT NULL,
	`order_index` integer NOT NULL,
	`set_index` integer NOT NULL,
	`group_id` integer,
	`group_kind` text,
	`performed_at_utc` integer,
	`weight_kg` real,
	`entered_value` real,
	`entered_unit` text,
	`load_mode` text DEFAULT 'total' NOT NULL,
	`reps` integer,
	`duration_s` integer,
	`distance_m` real,
	`rpe` real,
	`base_weight_kg` real,
	`equipment_id` integer,
	`set_type` text DEFAULT 'unknown' NOT NULL,
	`completed` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`source` text DEFAULT 'native' NOT NULL,
	`source_file` text,
	`source_line` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sets_load_mode_ck" CHECK(load_mode IN ('total', 'added', 'assistance')),
	CONSTRAINT "sets_set_type_ck" CHECK(set_type IN ('working', 'warmup', 'drop', 'failure', 'unknown')),
	CONSTRAINT "sets_source_ck" CHECK(source IN ('progression_csv', 'native')),
	CONSTRAINT "sets_completed_ck" CHECK(completed IN (0, 1)),
	CONSTRAINT "sets_entered_unit_ck" CHECK(entered_unit IS NULL OR entered_unit IN ('kg', 'lb')),
	CONSTRAINT "sets_group_kind_ck" CHECK(group_kind IS NULL OR group_kind IN ('superset', 'dropset')),
	CONSTRAINT "sets_has_payload_ck" CHECK(weight_kg IS NOT NULL OR reps IS NOT NULL OR duration_s IS NOT NULL OR distance_m IS NOT NULL),
	CONSTRAINT "sets_reps_ck" CHECK(reps IS NULL OR reps > 0)
) STRICT;
--> statement-breakpoint
CREATE INDEX `sets_session` ON `sets` (`session_id`,`order_index`);--> statement-breakpoint
CREATE INDEX `sets_exercise` ON `sets` (`exercise_id`,`performed_at_utc`);--> statement-breakpoint
CREATE TABLE `template_exercises` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`template_id` integer NOT NULL,
	`exercise_id` integer NOT NULL,
	`order_index` integer NOT NULL,
	`target_sets` integer,
	`target_reps` integer,
	`rest_s` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`template_id`) REFERENCES `templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action
) STRICT;
--> statement-breakpoint
CREATE INDEX `template_exercises_template` ON `template_exercises` (`template_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`order_index` integer DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_name_live` ON `templates` (`name`) WHERE deleted_at IS NULL;