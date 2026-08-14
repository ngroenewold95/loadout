CREATE TABLE `session_exercises` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`exercise_id` integer NOT NULL,
	`order_index` integer NOT NULL,
	`target_sets` integer,
	`target_rep_min` integer,
	`target_rep_max` integer,
	`rest_s` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "session_exercises_rep_range_ck" CHECK(target_rep_min IS NULL OR target_rep_max IS NULL OR target_rep_max >= target_rep_min)
) STRICT;
--> statement-breakpoint
CREATE INDEX `session_exercises_session` ON `session_exercises` (`session_id`,`order_index`);--> statement-breakpoint
-- Hand-written, and not from drizzle-kit.
--
-- A workout is already in progress on the device, and after this migration it
-- would read an empty exercise list: `startSession` is what fills this table,
-- and that session started before the table existed. So it is backfilled from
-- the template it was started from.
--
-- Only LIVE sessions. Finished ones never render an exercise list - the summary
-- reads `sets` - so copying rows for all 343 of them would be work that nothing
-- ever queries.
--
-- `rest_s` is resolved through the exercise default here rather than copied
-- raw, so the row records what this session was actually resting rather than a
-- null that later re-resolves against a changed default. `startSession` does
-- the same, and the two must not drift.
INSERT INTO session_exercises
  (session_id, exercise_id, order_index, target_sets,
   target_rep_min, target_rep_max, rest_s, notes, created_at, updated_at)
SELECT s.id,
       te.exercise_id,
       te.order_index,
       te.target_sets,
       te.target_rep_min,
       te.target_rep_max,
       COALESCE(te.rest_s, e.default_rest_s),
       te.notes,
       CAST(strftime('%s', 'now') AS INTEGER) * 1000,
       CAST(strftime('%s', 'now') AS INTEGER) * 1000
  FROM sessions s
  JOIN template_exercises te
    ON te.template_id = s.template_id AND te.deleted_at IS NULL
  JOIN exercises e
    ON e.id = te.exercise_id AND e.deleted_at IS NULL
 WHERE s.ended_at_utc IS NULL
   AND s.deleted_at IS NULL
   AND s.template_id IS NOT NULL;