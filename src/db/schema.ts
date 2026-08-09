/**
 * Database schema.
 *
 * Drizzle is a LAPTOP tool here: this file exists to generate types and
 * numbered migration SQL. The `drizzle-orm` runtime never ships to the device
 * (its migrator imports `node:fs`, and its proxy driver misreads the
 * name-keyed rows the Capacitor plugin returns). Device code runs plain SQL.
 *
 * Conventions:
 *  - `id` is the first column of every table - `exportToJson()` requires it.
 *  - Timestamps are integer epoch milliseconds (UTC).
 *  - `local_date` is a 'YYYY-MM-DD' string and is *ground truth*: the source
 *    export carries no timezone at all, so the UTC instant is the derived,
 *    lossy field. Do not "clean up" this redundancy.
 *  - Soft delete everywhere; uniqueness is enforced by partial indexes over
 *    live rows only.
 */
import { sql } from 'drizzle-orm'
import {
  sqliteTable,
  integer,
  text,
  real,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/sqlite-core'

const timestamps = {
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
}

/** How the number in `weight_kg` relates to effort. */
export const LOAD_MODES = ['total', 'added', 'assistance'] as const
/** Default shape of a set for this exercise. A hint, not a constraint. */
export const TRACKING_TYPES = [
  'weight_reps',
  'bodyweight',
  'duration',
  'distance_time',
] as const
export const SET_TYPES = [
  'working',
  'warmup',
  'drop',
  'failure',
  'unknown',
] as const
export const MODALITIES = [
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'bodyweight',
  'other',
] as const
export const UNITS = ['kg', 'lb'] as const
export const SOURCES = ['progression_csv', 'native'] as const
export const GROUP_KINDS = ['superset', 'dropset'] as const

const inList = (col: string, vals: readonly string[]) =>
  sql.raw(`${col} IN (${vals.map((v) => `'${v}'`).join(', ')})`)

export const exercises = sqliteTable(
  'exercises',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    modality: text('modality'),
    primaryMuscle: text('primary_muscle'),
    /** Default only - actual shape is derived per set. `Chinup` and
     *  `Chest Dip` legitimately appear both weighted and bodyweight. */
    trackingType: text('tracking_type').notNull().default('weight_reps'),
    /** 420 imported sets record machine ASSISTANCE, where a higher number
     *  means an easier set. Without this, PR detection reads backwards. */
    defaultLoadMode: text('default_load_mode').notNull().default('total'),
    defaultBaseWeightKg: real('default_base_weight_kg'),
    defaultRestS: integer('default_rest_s'),
    preferredUnit: text('preferred_unit').notNull().default('lb'),
    /** Two-handed dumbbell lifts log the PAIR total; single-arm lifts log the
     *  one bell. Both are "total load", but the UI must render "2 x 100 lb". */
    implementCount: integer('implement_count').notNull().default(1),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('exercises_name_live')
      .on(t.name)
      .where(sql`deleted_at IS NULL`),
    check('exercises_modality_ck', sql`modality IS NULL OR ${inList('modality', MODALITIES)}`),
    check('exercises_tracking_ck', inList('tracking_type', TRACKING_TYPES)),
    check('exercises_load_mode_ck', inList('default_load_mode', LOAD_MODES)),
    check('exercises_unit_ck', inList('preferred_unit', UNITS)),
    check('exercises_implement_ck', sql`implement_count >= 1`),
  ],
)

export const exerciseAliases = sqliteTable(
  'exercise_aliases',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    exerciseId: integer('exercise_id')
      .notNull()
      .references(() => exercises.id),
    alias: text('alias').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('exercise_aliases_alias_live')
      .on(t.alias)
      .where(sql`deleted_at IS NULL`),
    index('exercise_aliases_exercise').on(t.exerciseId),
  ],
)

/** Distinguishes one gym's leg press from another's. */
export const equipment = sqliteTable(
  'equipment',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    baseWeightKg: real('base_weight_kg').notNull(),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('equipment_name_live')
      .on(t.name)
      .where(sql`deleted_at IS NULL`),
  ],
)

export const templates = sqliteTable(
  'templates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    orderIndex: integer('order_index').notNull().default(0),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('templates_name_live')
      .on(t.name)
      .where(sql`deleted_at IS NULL`),
  ],
)

export const templateExercises = sqliteTable(
  'template_exercises',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    templateId: integer('template_id')
      .notNull()
      .references(() => templates.id),
    exerciseId: integer('exercise_id')
      .notNull()
      .references(() => exercises.id),
    orderIndex: integer('order_index').notNull(),
    targetSets: integer('target_sets'),
    /** Rep target as a RANGE - "2 x 5-8", not "2 x 8". The programme's
     *  progression rule is "hit the top of the range on both sets, then add
     *  load", so a single number cannot express the goal or decide the cue.
     *  A fixed target is the degenerate case where min == max. */
    targetRepMin: integer('target_rep_min'),
    targetRepMax: integer('target_rep_max'),
    restS: integer('rest_s'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    index('template_exercises_template').on(t.templateId, t.orderIndex),
    check(
      'template_exercises_rep_range_ck',
      sql`target_rep_min IS NULL OR target_rep_max IS NULL OR target_rep_max >= target_rep_min`,
    ),
  ],
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Snapshot of the workout name AT THE TIME. Editing a template must never
     *  rewrite what a past session was called. */
    name: text('name'),
    startedAtUtc: integer('started_at_utc').notNull(),
    endedAtUtc: integer('ended_at_utc'),
    localDate: text('local_date').notNull(),
    /** Advisory provenance only. Deliberately nullable on template delete. */
    templateId: integer('template_id').references(() => templates.id, {
      onDelete: 'set null',
    }),
    bodyweightKg: real('bodyweight_kg'),
    notes: text('notes'),
    source: text('source').notNull().default('native'),
    ...timestamps,
  },
  (t) => [
    index('sessions_local_date').on(t.localDate),
    index('sessions_started').on(t.startedAtUtc),
    check('sessions_source_ck', inList('source', SOURCES)),
    check(
      'sessions_local_date_ck',
      sql`local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
  ],
)

export const sets = sqliteTable(
  'sets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: integer('session_id')
      .notNull()
      .references(() => sessions.id),
    exerciseId: integer('exercise_id')
      .notNull()
      .references(() => exercises.id),
    /** Position within the SESSION. The export does not record this - it is
     *  derived by sorting set timestamps. */
    orderIndex: integer('order_index').notNull(),
    /** Position within the exercise. This is the export's `Set Order`. */
    setIndex: integer('set_index').notNull(),
    groupId: integer('group_id'),
    groupKind: text('group_kind'),
    performedAtUtc: integer('performed_at_utc'),

    /** Canonical load, always kg, always TOTAL including bar/sled/carriage.
     *  Proven against five years of the user's own comments:
     *  "Machine weight 100" + 7x45/side == 730 lb logged. */
    weightKg: real('weight_kg'),
    /** What was actually typed, for faithful display. 100% of history is lb. */
    enteredValue: real('entered_value'),
    enteredUnit: text('entered_unit'),
    loadMode: text('load_mode').notNull().default('total'),

    reps: integer('reps'),
    durationS: integer('duration_s'),
    distanceM: real('distance_m'),
    rpe: real('rpe'),

    /** Snapshotted at log time, never looked up. Re-measuring a Smith machine
     *  must not silently rewrite five years of history. */
    baseWeightKg: real('base_weight_kg'),
    equipmentId: integer('equipment_id').references(() => equipment.id),

    setType: text('set_type').notNull().default('unknown'),
    completed: integer('completed').notNull().default(1),
    notes: text('notes'),

    source: text('source').notNull().default('native'),
    sourceFile: text('source_file'),
    sourceLine: integer('source_line'),
    ...timestamps,
  },
  (t) => [
    index('sets_session').on(t.sessionId, t.orderIndex),
    index('sets_exercise').on(t.exerciseId, t.performedAtUtc),
    check('sets_load_mode_ck', inList('load_mode', LOAD_MODES)),
    check('sets_set_type_ck', inList('set_type', SET_TYPES)),
    check('sets_source_ck', inList('source', SOURCES)),
    check('sets_completed_ck', sql`completed IN (0, 1)`),
    check(
      'sets_entered_unit_ck',
      sql`entered_unit IS NULL OR ${inList('entered_unit', UNITS)}`,
    ),
    check(
      'sets_group_kind_ck',
      sql`group_kind IS NULL OR ${inList('group_kind', GROUP_KINDS)}`,
    ),
    // A set must record something. Every row in the export satisfies this.
    check(
      'sets_has_payload_ck',
      sql`weight_kg IS NOT NULL OR reps IS NOT NULL OR duration_s IS NOT NULL OR distance_m IS NOT NULL`,
    ),
    check('sets_reps_ck', sql`reps IS NULL OR reps > 0`),
  ],
)

export const bodyweightLog = sqliteTable(
  'bodyweight_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    localDate: text('local_date').notNull(),
    weightKg: real('weight_kg').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('bodyweight_date_live')
      .on(t.localDate)
      .where(sql`deleted_at IS NULL`),
  ],
)

export type Exercise = typeof exercises.$inferSelect
export type Session = typeof sessions.$inferSelect
export type SetRow = typeof sets.$inferSelect
export type Template = typeof templates.$inferSelect
export type TemplateExercise = typeof templateExercises.$inferSelect
export type Equipment = typeof equipment.$inferSelect
export type LoadMode = (typeof LOAD_MODES)[number]
export type TrackingType = (typeof TRACKING_TYPES)[number]
export type SetType = (typeof SET_TYPES)[number]
