CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`default_bar_weight_kg` real,
	`weight_increment_kg` real,
	`keep_screen_on` integer DEFAULT 0 NOT NULL,
	`overlay_in_background` integer DEFAULT 1 NOT NULL,
	`rest_vibrate` integer DEFAULT 1 NOT NULL,
	`rest_sound` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "app_settings_singleton_ck" CHECK(id = 1),
	CONSTRAINT "app_settings_keep_screen_ck" CHECK(keep_screen_on IN (0, 1)),
	CONSTRAINT "app_settings_overlay_ck" CHECK(overlay_in_background IN (0, 1)),
	CONSTRAINT "app_settings_vibrate_ck" CHECK(rest_vibrate IN (0, 1)),
	CONSTRAINT "app_settings_sound_ck" CHECK(rest_sound IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE TABLE `plate_inventory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`weight_kg` real NOT NULL,
	`count` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	CONSTRAINT "plate_inventory_weight_ck" CHECK(weight_kg > 0),
	CONSTRAINT "plate_inventory_count_ck" CHECK(count >= 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `plate_inventory_weight_live` ON `plate_inventory` (`weight_kg`) WHERE deleted_at IS NULL;