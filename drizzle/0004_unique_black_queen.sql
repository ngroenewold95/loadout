PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_exercises` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`modality` text,
	`loading` text,
	`primary_muscle` text,
	`tracking_type` text DEFAULT 'weight_reps' NOT NULL,
	`default_load_mode` text DEFAULT 'total' NOT NULL,
	`default_base_weight_kg` real,
	`default_increment_kg` real,
	`default_rest_s` integer,
	`preferred_unit` text DEFAULT 'lb' NOT NULL,
	`implement_count` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "exercises_modality_ck" CHECK(modality IS NULL OR modality IN ('barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other')),
	CONSTRAINT "exercises_loading_ck" CHECK(loading IS NULL OR loading IN ('plates_per_side', 'plates_total', 'stack', 'fixed')),
	CONSTRAINT "exercises_tracking_ck" CHECK(tracking_type IN ('weight_reps', 'bodyweight', 'duration', 'distance_time')),
	CONSTRAINT "exercises_load_mode_ck" CHECK(default_load_mode IN ('total', 'added', 'assistance')),
	CONSTRAINT "exercises_unit_ck" CHECK(preferred_unit IN ('kg', 'lb')),
	CONSTRAINT "exercises_implement_ck" CHECK(implement_count >= 1)
) STRICT;
--> statement-breakpoint
-- HAND-FIXED. drizzle-kit emitted `"loading"` and `"default_increment_kg"` in
-- the SELECT list, reading the two NEW columns from the OLD table, which does
-- not have them. Identical to the fault recorded against migration 0001 in
-- docs/PROJECT.md. Both are nullable and start empty, so they select as NULL.
INSERT INTO `__new_exercises`("id", "name", "modality", "loading", "primary_muscle", "tracking_type", "default_load_mode", "default_base_weight_kg", "default_increment_kg", "default_rest_s", "preferred_unit", "implement_count", "notes", "created_at", "updated_at", "deleted_at") SELECT "id", "name", "modality", NULL, "primary_muscle", "tracking_type", "default_load_mode", "default_base_weight_kg", NULL, "default_rest_s", "preferred_unit", "implement_count", "notes", "created_at", "updated_at", "deleted_at" FROM `exercises`;--> statement-breakpoint
DROP TABLE `exercises`;--> statement-breakpoint
ALTER TABLE `__new_exercises` RENAME TO `exercises`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `exercises_name_live` ON `exercises` (`name`) WHERE deleted_at IS NULL;