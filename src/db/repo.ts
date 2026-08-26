/**
 * Every query the app makes, in one place.
 *
 * Conventions, all of them load-bearing:
 *
 * - **Columns are aliased to camelCase in the SQL.** The Capacitor plugin
 *   returns rows keyed by column name, so `AS "weightKg"` means the UI gets the
 *   shape it wants with no mapping layer to drift out of sync.
 * - **Soft delete is never implicit.** Every read filters `deleted_at IS NULL`
 *   explicitly. There is no base query to forget to extend.
 * - **No query inside a loop.** Anything that spans exercises takes an array
 *   and answers in one statement; on device each call is a bridge crossing.
 * - **Positional `?` only.** `?N` numbered parameters bind differently across
 *   better-sqlite3 and the plugin, so repeated values are repeated in the
 *   params array instead.
 */
import type { Db } from './driver.ts'
import type { Loading, LoadMode, SetType, TrackingType } from './schema.ts'
import type { Unit } from '../logic/units.ts'

/** Sentinel for "exclude nothing" - no row has a negative rowid here. */
const NO_SESSION = -1

/**
 * `local_date` is ground truth (see schema.ts), so it comes from the wall clock
 * the set was logged against, never from a UTC instant.
 */
export function localDateOf(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const placeholders = (n: number) => Array(n).fill('?').join(', ')

/**
 * How the load is made up before any plates go on, as one SQL expression.
 *
 * Most specific first, and **defined once** because two hand-written copies
 * would drift: the chip row above the entry bar and the `base_weight_kg`
 * snapshotted into a set have to agree or the history stops meaning what it
 * says.
 *
 * 1. the exercise's own `default_base_weight_kg` - a trap bar, a Smith
 *    carriage, a plate-loaded sled's own frame
 * 2. the global bar weight, **only for `modality = 'barbell'`**
 *
 * The gate on step 2 is load-bearing. The reference app keeps a single global
 * `Equipment weight: 45 Lb` with no override anywhere, which is wrong the
 * moment a trap bar is involved, and a sled whose base is unrecorded must show
 * NO base rather than silently claiming 45 lb.
 *
 * Expects the exercises table aliased `e`.
 */
const BASE_WEIGHT_KG = `COALESCE(
        e.default_base_weight_kg,
        CASE WHEN e.modality = 'barbell'
             THEN (SELECT default_bar_weight_kg FROM app_settings WHERE id = 1) END
      )`

// ------------------------------------------------- settings and the plates

export interface AppSettings {
  defaultBarWeightKg: number | null
  weightIncrementKg: number | null
  keepScreenOn: boolean
  overlayInBackground: boolean
  restVibrate: boolean
  restSound: boolean
}

/**
 * The one settings row, or null before `seedDefaults` has ever run.
 *
 * Every caller must tolerate null and fall back to its own constant. A device
 * pushed from an older lineage opens once with no row, and a screen that
 * assumed one would render blank rather than the defaults it has always used.
 */
export async function getSettings(db: Db): Promise<AppSettings | null> {
  const row = await db.queryOne<{
    defaultBarWeightKg: number | null
    weightIncrementKg: number | null
    keepScreenOn: number
    overlayInBackground: number
    restVibrate: number
    restSound: number
  }>(
    `SELECT default_bar_weight_kg AS "defaultBarWeightKg",
            weight_increment_kg AS "weightIncrementKg",
            keep_screen_on AS "keepScreenOn",
            overlay_in_background AS "overlayInBackground",
            rest_vibrate AS "restVibrate",
            rest_sound AS "restSound"
       FROM app_settings
      WHERE id = 1 AND deleted_at IS NULL`,
  )
  if (!row) return null
  // SQLite has no boolean type; the CHECKs keep these to 0 or 1.
  return {
    defaultBarWeightKg: row.defaultBarWeightKg,
    weightIncrementKg: row.weightIncrementKg,
    keepScreenOn: row.keepScreenOn === 1,
    overlayInBackground: row.overlayInBackground === 1,
    restVibrate: row.restVibrate === 1,
    restSound: row.restSound === 1,
  }
}

/**
 * Change one or more settings.
 *
 * The column list is a closed record in code and only the keys actually present
 * in the patch are written, so an absent key means leave it alone. Values bind
 * positionally like everything else here.
 */
export async function setSettings(db: Db, patch: Partial<AppSettings>): Promise<void> {
  const columns: Record<keyof AppSettings, string> = {
    defaultBarWeightKg: 'default_bar_weight_kg',
    weightIncrementKg: 'weight_increment_kg',
    keepScreenOn: 'keep_screen_on',
    overlayInBackground: 'overlay_in_background',
    restVibrate: 'rest_vibrate',
    restSound: 'rest_sound',
  }
  const fields = (Object.keys(columns) as (keyof AppSettings)[]).filter((key) => key in patch)
  if (fields.length === 0) return

  await db.exec(
    `UPDATE app_settings
        SET ${fields.map((f) => `${columns[f]} = ?`).join(', ')}, updated_at = ?
      WHERE id = 1`,
    [
      ...fields.map((f) => {
        const value = patch[f]
        // The booleans are stored as 0/1 under a CHECK; the weights are reals.
        return typeof value === 'boolean' ? (value ? 1 : 0) : (value ?? null)
      }),
      Date.now(),
    ],
  )
}

/**
 * The plates owned, heaviest first.
 *
 * `count` is the total across both sides and `platesFor` halves it, so the
 * shape here is exactly `PlateStock` and there is no mapping layer to drift.
 */
export function listPlateInventory(db: Db): Promise<{ kg: number; count: number }[]> {
  return db.query<{ kg: number; count: number }>(
    `SELECT weight_kg AS "kg", count
       FROM plate_inventory
      WHERE deleted_at IS NULL
      ORDER BY weight_kg DESC`,
  )
}

// ---------------------------------------------------------------- templates

export interface TemplateSummary {
  id: number
  name: string
  orderIndex: number
  exerciseCount: number
  /** Most recent session of this workout, by template link OR by name - the
   *  imported history predates templates and carries only the name. */
  lastUsedDate: string | null
}

export function listTemplates(db: Db): Promise<TemplateSummary[]> {
  return db.query<TemplateSummary>(
    `SELECT t.id,
            t.name,
            t.order_index AS "orderIndex",
            COUNT(te.id) AS "exerciseCount",
            (SELECT MAX(s.local_date) FROM sessions s
              WHERE s.deleted_at IS NULL
                AND (s.template_id = t.id OR s.name = t.name)) AS "lastUsedDate"
       FROM templates t
       LEFT JOIN template_exercises te
              ON te.template_id = t.id AND te.deleted_at IS NULL
      WHERE t.deleted_at IS NULL
      GROUP BY t.id
      ORDER BY t.order_index, t.name`,
  )
}

/**
 * Which workout is up next.
 *
 * The programme rotates A/B/A/B *rolling*, deliberately not pinned to weekdays,
 * so "next" is whichever template was performed least recently - miss a week
 * and you resume where you left off rather than skipping a day. A template
 * never performed sorts first; `order_index` breaks ties.
 */
export async function nextTemplate(db: Db): Promise<TemplateSummary | null> {
  const templates = await listTemplates(db)
  return (
    [...templates].sort(
      (a, b) =>
        (a.lastUsedDate ?? '').localeCompare(b.lastUsedDate ?? '') ||
        a.orderIndex - b.orderIndex,
    )[0] ?? null
  )
}

export interface TemplateExerciseRow {
  exerciseId: number
  name: string
  orderIndex: number
  targetSets: number | null
  /** Rep target is a range: "2 x 5-8". Equal min and max means a fixed target. */
  targetRepMin: number | null
  targetRepMax: number | null
  /** Template override, else the exercise's history-seeded default. */
  restS: number | null
  notes: string | null
  trackingType: TrackingType
  loadMode: LoadMode
  implementCount: number
  preferredUnit: Unit
  baseWeightKg: number | null
  /** How weight is added. Null until the equipment seeder knows; no chips then. */
  loading: Loading | null
  /** Per-exercise drag-handle step. Null means fall back to the setting. */
  incrementKg: number | null
  /** Free text, often null. Feed it to `muscleMark`, which degrades safely. */
  primaryMuscle: string | null
}

export function listTemplateExercises(
  db: Db,
  templateId: number,
): Promise<TemplateExerciseRow[]> {
  return db.query<TemplateExerciseRow>(
    `SELECT te.exercise_id AS "exerciseId",
            e.name,
            te.order_index AS "orderIndex",
            te.target_sets AS "targetSets",
            te.target_rep_min AS "targetRepMin",
            te.target_rep_max AS "targetRepMax",
            COALESCE(te.rest_s, e.default_rest_s) AS "restS",
            te.notes,
            e.tracking_type AS "trackingType",
            e.default_load_mode AS "loadMode",
            e.implement_count AS "implementCount",
            e.preferred_unit AS "preferredUnit",
            ${BASE_WEIGHT_KG} AS "baseWeightKg",
            e.loading,
            e.default_increment_kg AS "incrementKg",
            e.primary_muscle AS "primaryMuscle"
       FROM template_exercises te
       JOIN exercises e ON e.id = te.exercise_id
      WHERE te.template_id = ?
        AND te.deleted_at IS NULL
        AND e.deleted_at IS NULL
      ORDER BY te.order_index`,
    [templateId],
  )
}

/**
 * What THIS session is doing, as opposed to what its template says.
 *
 * Same row shape as `listTemplateExercises` on purpose: `ActiveSession` swaps
 * one hook for the other and nothing else changes. The difference is that these
 * rows are editable - swapping an exercise, cutting one or raising `target_sets`
 * with `Add set` writes here, and the programme is untouched.
 */
export function listSessionExercises(
  db: Db,
  sessionId: number,
): Promise<TemplateExerciseRow[]> {
  return db.query<TemplateExerciseRow>(
    `SELECT se.exercise_id AS "exerciseId",
            e.name,
            se.order_index AS "orderIndex",
            se.target_sets AS "targetSets",
            se.target_rep_min AS "targetRepMin",
            se.target_rep_max AS "targetRepMax",
            se.rest_s AS "restS",
            se.notes,
            e.tracking_type AS "trackingType",
            e.default_load_mode AS "loadMode",
            e.implement_count AS "implementCount",
            e.preferred_unit AS "preferredUnit",
            ${BASE_WEIGHT_KG} AS "baseWeightKg",
            e.loading,
            e.default_increment_kg AS "incrementKg",
            e.primary_muscle AS "primaryMuscle"
       FROM session_exercises se
       JOIN exercises e ON e.id = se.exercise_id
      WHERE se.session_id = ?
        AND se.deleted_at IS NULL
        AND e.deleted_at IS NULL
      ORDER BY se.order_index`,
    [sessionId],
  )
}

/**
 * Change how many sets THIS session is asking for.
 *
 * The whole point of the snapshot: `2/2 sets` becomes `2/3` and the programme is
 * untouched. The reference app declares an extra set before performing it, which
 * is what keeps the fraction meaningful - see `docs/PROGRESSION.md`.
 *
 * Clamped at the number already performed, not at zero. Lowering the target
 * below the sets that exist would render `3/2`, and the sets are the facts here;
 * the target is the intention.
 */
export async function setPlannedSets(
  db: Db,
  sessionId: number,
  exerciseId: number,
  targetSets: number,
): Promise<number> {
  return db.transaction(async (tx) => {
    const performed = await tx.queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM sets
        WHERE session_id = ? AND exercise_id = ? AND deleted_at IS NULL`,
      [sessionId, exerciseId],
    )
    const floor = performed?.n ?? 0
    const next = Math.max(floor, Math.round(targetSets))

    await tx.exec(
      `UPDATE session_exercises SET target_sets = ?, updated_at = ?
        WHERE session_id = ? AND exercise_id = ? AND deleted_at IS NULL`,
      [next, Date.now(), sessionId, exerciseId],
    )
    return next
  })
}

/**
 * Add an exercise to this workout, at the end.
 *
 * Targets come from the exercise's own defaults rather than being invented: rest
 * from `default_rest_s`, which is seeded per exercise from five years of actual
 * gaps between sets. Rep targets are left null, which `setSlots` reads as "no
 * target", so it can never be complete and never blocks the summary wrongly -
 * the user decides when an unplanned exercise is done.
 */
export async function addSessionExercise(
  db: Db,
  sessionId: number,
  exerciseId: number,
  targetSets: number | null = null,
): Promise<void> {
  const now = Date.now()
  await db.exec(
    `INSERT INTO session_exercises
       (session_id, exercise_id, order_index, target_sets, rest_s, created_at, updated_at)
     SELECT ?, ?,
            COALESCE((SELECT MAX(order_index) + 1 FROM session_exercises
                       WHERE session_id = ? AND deleted_at IS NULL), 0),
            ?, e.default_rest_s, ?, ?
       FROM exercises e
      WHERE e.id = ? AND e.deleted_at IS NULL`,
    [sessionId, exerciseId, sessionId, targetSets, now, now, exerciseId],
  )
}

/**
 * Take an exercise out of this workout.
 *
 * **Soft delete, and it does not touch the sets.** Anything already logged
 * against it stays logged: it was performed, and a plan change is not a reason
 * to lose a fact. The summary reads `sets`, so those sets still appear there.
 */
export async function removeSessionExercise(
  db: Db,
  sessionId: number,
  exerciseId: number,
): Promise<void> {
  const now = Date.now()
  await db.exec(
    `UPDATE session_exercises SET deleted_at = ?, updated_at = ?
      WHERE session_id = ? AND exercise_id = ? AND deleted_at IS NULL`,
    [now, now, sessionId, exerciseId],
  )
}

/**
 * Swap one exercise for another, keeping its position and targets.
 *
 * The machine was busy, not the plan wrong - so `Replace` keeps the sets, reps
 * and rest and changes only which movement they apply to.
 */
export async function replaceSessionExercise(
  db: Db,
  sessionId: number,
  exerciseId: number,
  withExerciseId: number,
): Promise<void> {
  await db.exec(
    `UPDATE session_exercises SET exercise_id = ?, updated_at = ?
      WHERE session_id = ? AND exercise_id = ? AND deleted_at IS NULL`,
    [withExerciseId, Date.now(), sessionId, exerciseId],
  )
}

/**
 * Write a new order for the whole list.
 *
 * Takes every id and renumbers from zero rather than nudging one row up or down.
 * A pairwise swap has to read the neighbour first, and two of them racing would
 * leave two rows sharing an `order_index`; one batch of the whole list cannot.
 */
export async function reorderSessionExercises(
  db: Db,
  sessionId: number,
  exerciseIds: number[],
): Promise<void> {
  if (exerciseIds.length === 0) return
  const now = Date.now()
  await db.batch(
    exerciseIds.map((exerciseId, order) => ({
      sql: `UPDATE session_exercises SET order_index = ?, updated_at = ?
             WHERE session_id = ? AND exercise_id = ? AND deleted_at IS NULL`,
      params: [order, now, sessionId, exerciseId],
    })),
  )
}

// --------------------------------------------------------- editing the plan

/**
 * Which list is being edited: the programme, or one performance of it.
 *
 * The two tables are the same shape on purpose - `session_exercises` is a copy
 * `startSession` takes - so the editor above them is one component and the
 * writes below them are one function. The reference app mounts the same
 * per-exercise editor in the live workout and in the template, and that is what
 * stops the two drifting.
 *
 * The table name is chosen from this closed union in code and never
 * interpolated from an argument; every id still binds positionally.
 */
export type PlanScope =
  | { table: 'session_exercises'; id: number }
  | { table: 'template_exercises'; id: number }

export const sessionPlan = (sessionId: number): PlanScope => ({
  table: 'session_exercises',
  id: sessionId,
})
export const templatePlan = (templateId: number): PlanScope => ({
  table: 'template_exercises',
  id: templateId,
})

/** The owning column, derived from the table rather than carried beside it. */
const ownerColumn = (scope: PlanScope) =>
  scope.table === 'session_exercises' ? 'session_id' : 'template_id'

export interface ExercisePlanPatch {
  targetSets?: number | null
  targetRepMin?: number | null
  targetRepMax?: number | null
  restS?: number | null
}

/**
 * Edit what an exercise is asking for: sets, rep range and rest.
 *
 * The rep-range columns have existed and been populated since migration 0002
 * and nothing could edit them, which was the whole gap this closes.
 *
 * `max < min` is refused here rather than left to the CHECK, so the caller has
 * something to say to the user. The CHECK stays as the backstop: this is the
 * readable error, not the guarantee.
 */
export async function setExercisePlan(
  db: Db,
  scope: PlanScope,
  exerciseId: number,
  patch: ExercisePlanPatch,
): Promise<void> {
  const { targetRepMin, targetRepMax } = patch
  if (targetRepMin != null && targetRepMax != null && targetRepMax < targetRepMin) {
    throw new Error(`rep range ${targetRepMin}-${targetRepMax} ends below where it starts`)
  }

  const columns: Record<keyof ExercisePlanPatch, string> = {
    targetSets: 'target_sets',
    targetRepMin: 'target_rep_min',
    targetRepMax: 'target_rep_max',
    restS: 'rest_s',
  }
  // Only what was passed. An absent key means leave it alone, which is not the
  // same as an explicit null meaning clear it.
  const fields = (Object.keys(columns) as (keyof ExercisePlanPatch)[]).filter(
    (key) => key in patch,
  )
  if (fields.length === 0) return

  const now = Date.now()
  await db.exec(
    `UPDATE ${scope.table}
        SET ${fields.map((f) => `${columns[f]} = ?`).join(', ')}, updated_at = ?
      WHERE ${ownerColumn(scope)} = ? AND exercise_id = ? AND deleted_at IS NULL`,
    [...fields.map((f) => patch[f] ?? null), now, scope.id, exerciseId],
  )
}

/**
 * Add an exercise to a template, at the end.
 *
 * Mirrors `addSessionExercise`, including inheriting the exercise's own
 * `default_rest_s` and leaving the rep range null. A template row with no rep
 * target is honest: it says the programme has not decided yet.
 */
export async function addTemplateExercise(
  db: Db,
  templateId: number,
  exerciseId: number,
  targetSets: number | null = null,
): Promise<void> {
  const now = Date.now()
  await db.exec(
    `INSERT INTO template_exercises
       (template_id, exercise_id, order_index, target_sets, rest_s, created_at, updated_at)
     SELECT ?, ?,
            COALESCE((SELECT MAX(order_index) + 1 FROM template_exercises
                       WHERE template_id = ? AND deleted_at IS NULL), 0),
            ?, e.default_rest_s, ?, ?
       FROM exercises e
      WHERE e.id = ? AND e.deleted_at IS NULL`,
    [templateId, exerciseId, templateId, targetSets, now, now, exerciseId],
  )
}

/**
 * Take an exercise out of a template.
 *
 * **Soft delete, never a hard one.** `seedPlanTemplates` writes soft deletes
 * too, and every read in this file filters `deleted_at IS NULL`; a hard delete
 * would also take the row out from under any historical query that ever wants
 * to know what the programme used to say.
 */
export async function removeTemplateExercise(
  db: Db,
  templateId: number,
  exerciseId: number,
): Promise<void> {
  const now = Date.now()
  await db.exec(
    `UPDATE template_exercises SET deleted_at = ?, updated_at = ?
      WHERE template_id = ? AND exercise_id = ? AND deleted_at IS NULL`,
    [now, now, templateId, exerciseId],
  )
}

/** Swap one exercise for another, keeping its position, sets, reps and rest. */
export async function replaceTemplateExercise(
  db: Db,
  templateId: number,
  exerciseId: number,
  withExerciseId: number,
): Promise<void> {
  await db.exec(
    `UPDATE template_exercises SET exercise_id = ?, updated_at = ?
      WHERE template_id = ? AND exercise_id = ? AND deleted_at IS NULL`,
    [withExerciseId, Date.now(), templateId, exerciseId],
  )
}

/**
 * Write a new order for the whole template.
 *
 * Renumbered from zero in one batch for the same reason the session version is:
 * a pairwise swap has to read its neighbour first, and two racing would leave
 * two rows sharing an `order_index`.
 */
export async function reorderTemplateExercises(
  db: Db,
  templateId: number,
  exerciseIds: number[],
): Promise<void> {
  if (exerciseIds.length === 0) return
  const now = Date.now()
  await db.batch(
    exerciseIds.map((exerciseId, order) => ({
      sql: `UPDATE template_exercises SET order_index = ?, updated_at = ?
             WHERE template_id = ? AND exercise_id = ? AND deleted_at IS NULL`,
      params: [order, now, templateId, exerciseId],
    })),
  )
}

// ---------------------------------------------------------------- exercises

export interface ExerciseSummary {
  id: number
  name: string
  trackingType: TrackingType
  loadMode: LoadMode
  defaultRestS: number | null
  implementCount: number
  preferredUnit: Unit
  baseWeightKg: number | null
  loading: Loading | null
  primaryMuscle: string | null
  lastPerformedAtUtc: number | null
  setCount: number
}

/**
 * Picker source: 86 exercises, ordered by most recently performed.
 *
 * `NULLS LAST` is spelled out as an `IS NULL` sort key rather than the 3.30+
 * syntax, so this does not depend on which SQLite the device happens to ship.
 */
export function searchExercises(
  db: Db,
  term = '',
  limit = 50,
): Promise<ExerciseSummary[]> {
  const like = `%${term.trim()}%`
  return db.query<ExerciseSummary>(
    `SELECT e.id,
            e.name,
            e.tracking_type AS "trackingType",
            e.default_load_mode AS "loadMode",
            e.default_rest_s AS "defaultRestS",
            e.implement_count AS "implementCount",
            e.preferred_unit AS "preferredUnit",
            ${BASE_WEIGHT_KG} AS "baseWeightKg",
            e.loading,
            e.default_increment_kg AS "incrementKg",
            e.primary_muscle AS "primaryMuscle",
            MAX(s.performed_at_utc) AS "lastPerformedAtUtc",
            COUNT(s.id) AS "setCount"
       FROM exercises e
       LEFT JOIN sets s ON s.exercise_id = e.id AND s.deleted_at IS NULL
      WHERE e.deleted_at IS NULL AND e.name LIKE ?
      GROUP BY e.id
      ORDER BY MAX(s.performed_at_utc) IS NULL,
               MAX(s.performed_at_utc) DESC,
               e.name
      LIMIT ?`,
    [like, limit],
  )
}

// ----------------------------------------------------------------- sessions

export interface SessionRow {
  id: number
  name: string | null
  startedAtUtc: number
  endedAtUtc: number | null
  localDate: string
  templateId: number | null
  notes: string | null
}

const SESSION_COLUMNS = `id,
       name,
       started_at_utc AS "startedAtUtc",
       ended_at_utc AS "endedAtUtc",
       local_date AS "localDate",
       template_id AS "templateId",
       notes`

/** The in-progress workout, if there is one. Drives resume on cold start. */
export function activeSession(db: Db): Promise<SessionRow | null> {
  return db.queryOne<SessionRow>(
    `SELECT ${SESSION_COLUMNS}
       FROM sessions
      WHERE ended_at_utc IS NULL AND deleted_at IS NULL
      ORDER BY started_at_utc DESC
      LIMIT 1`,
  )
}

/**
 * One session by id, in progress or not.
 *
 * `activeSession` cannot serve the summary screen: the whole point of that
 * screen is that `Finish workout` ends the session while it is still on screen,
 * and an "active session" read would go null underneath it. It is also how a
 * past session is opened from Home.
 */
export function sessionById(db: Db, sessionId: number): Promise<SessionRow | null> {
  return db.queryOne<SessionRow>(
    `SELECT ${SESSION_COLUMNS}
       FROM sessions
      WHERE id = ? AND deleted_at IS NULL`,
    [sessionId],
  )
}

export interface StartSessionInput {
  name?: string | null
  templateId?: number | null
  startedAtUtc?: number
  localDate?: string
}

/**
 * Begin a workout.
 *
 * Refuses while one is already in progress rather than silently opening a
 * second: two live sessions would split a workout's sets in half, and the
 * resume-on-cold-start path could only ever pick one of them.
 */
export async function startSession(
  db: Db,
  input: StartSessionInput = {},
): Promise<number> {
  return db.transaction(async (tx) => {
    const open = await activeSession(tx)
    if (open) {
      throw new Error(
        `session ${open.id} is still in progress (started ${open.localDate}) - end or discard it first`,
      )
    }
    const now = Date.now()
    const startedAt = input.startedAtUtc ?? now
    const { lastInsertId } = await tx.exec(
      `INSERT INTO sessions (name, started_at_utc, local_date, template_id, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'native', ?, ?)`,
      [
        input.name ?? null,
        startedAt,
        input.localDate ?? localDateOf(new Date(startedAt)),
        input.templateId ?? null,
        now,
        now,
      ],
    )

    /**
     * Snapshot the template into `session_exercises`.
     *
     * One INSERT ... SELECT rather than a row at a time: it is one bridge
     * crossing whatever the template's length, and it is inside the same
     * transaction as the session row, so a session can never exist with half a
     * plan attached to it.
     *
     * `rest_s` resolves through the exercise default here, exactly as migration
     * 0005's backfill does. A snapshot that stored null would re-resolve later
     * against a default that had since changed, which is the opposite of what a
     * snapshot is for.
     */
    if (input.templateId != null) {
      await tx.exec(
        `INSERT INTO session_exercises
           (session_id, exercise_id, order_index, target_sets,
            target_rep_min, target_rep_max, rest_s, notes, created_at, updated_at)
         SELECT ?, te.exercise_id, te.order_index, te.target_sets,
                te.target_rep_min, te.target_rep_max,
                COALESCE(te.rest_s, e.default_rest_s), te.notes, ?, ?
           FROM template_exercises te
           JOIN exercises e ON e.id = te.exercise_id AND e.deleted_at IS NULL
          WHERE te.template_id = ? AND te.deleted_at IS NULL
          ORDER BY te.order_index`,
        [lastInsertId, now, now, input.templateId],
      )
    }

    return lastInsertId
  })
}

export async function endSession(
  db: Db,
  sessionId: number,
  endedAtUtc = Date.now(),
): Promise<void> {
  await db.exec(
    `UPDATE sessions SET ended_at_utc = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL`,
    [endedAtUtc, Date.now(), sessionId],
  )
}

/**
 * Throw a session away, sets and all.
 *
 * Soft delete, so an accidental discard is recoverable in SQL and the partial
 * unique indexes stop treating the name as taken.
 */
export async function discardSession(db: Db, sessionId: number): Promise<void> {
  const now = Date.now()
  await db.batch([
    {
      sql: `UPDATE sets SET deleted_at = ?, updated_at = ?
             WHERE session_id = ? AND deleted_at IS NULL`,
      params: [now, now, sessionId],
    },
    {
      // The plan snapshot goes with the session it belonged to. Leaving it live
      // would keep rows pointing at a discarded parent for good.
      sql: `UPDATE session_exercises SET deleted_at = ?, updated_at = ?
             WHERE session_id = ? AND deleted_at IS NULL`,
      params: [now, now, sessionId],
    },
    {
      sql: `UPDATE sessions SET deleted_at = ?, updated_at = ?
             WHERE id = ? AND deleted_at IS NULL`,
      params: [now, now, sessionId],
    },
  ])
}

// --------------------------------------------------------------------- sets

/** A logged set, in the shape the UI renders. */
export interface PerformedSet {
  id: number
  sessionId: number
  exerciseId: number
  exerciseName: string
  /** Free text, often null. Feed it to `muscleMark`, which degrades safely. */
  primaryMuscle: string | null
  orderIndex: number
  setIndex: number
  performedAtUtc: number | null
  weightKg: number | null
  enteredValue: number | null
  enteredUnit: Unit | null
  loadMode: LoadMode
  reps: number | null
  durationS: number | null
  distanceM: number | null
  baseWeightKg: number | null
  setType: SetType
  notes: string | null
}

const SET_COLUMNS = `s.id,
       s.session_id AS "sessionId",
       s.exercise_id AS "exerciseId",
       e.name AS "exerciseName",
       e.primary_muscle AS "primaryMuscle",
       s.order_index AS "orderIndex",
       s.set_index AS "setIndex",
       s.performed_at_utc AS "performedAtUtc",
       s.weight_kg AS "weightKg",
       s.entered_value AS "enteredValue",
       s.entered_unit AS "enteredUnit",
       s.load_mode AS "loadMode",
       s.reps,
       s.duration_s AS "durationS",
       s.distance_m AS "distanceM",
       s.base_weight_kg AS "baseWeightKg",
       s.set_type AS "setType",
       s.notes`

export function listSessionSets(db: Db, sessionId: number): Promise<PerformedSet[]> {
  return db.query<PerformedSet>(
    `SELECT ${SET_COLUMNS}
       FROM sets s
       JOIN exercises e ON e.id = s.exercise_id
      WHERE s.session_id = ? AND s.deleted_at IS NULL
      ORDER BY s.order_index`,
    [sessionId],
  )
}

export interface LogSetInput {
  sessionId: number
  exerciseId: number
  weightKg?: number | null
  /** What was actually typed, kept for faithful display of history. */
  enteredValue?: number | null
  enteredUnit?: Unit | null
  /** Omit to inherit the exercise's default - which is how `assistance`
   *  exercises avoid being silently logged as `total`. */
  loadMode?: LoadMode | null
  reps?: number | null
  durationS?: number | null
  distanceM?: number | null
  /** Omit to snapshot the exercise's default machine base. */
  baseWeightKg?: number | null
  equipmentId?: number | null
  setType?: SetType
  notes?: string | null
  performedAtUtc?: number
}

/**
 * Log one set. The two-tap operation the whole app is built around.
 *
 * Both positions are computed inside the INSERT rather than read first:
 *
 * - `order_index` is the position within the SESSION, so supersets interleave
 *   in the order they actually happened.
 * - `set_index` is the position within the EXERCISE - the export's `Set Order`.
 *
 * Doing it in SQL keeps this one statement, and makes the numbering correct
 * even when the previous set was undone a moment earlier.
 */
export async function logSet(db: Db, input: LogSetInput): Promise<number> {
  const { weightKg, reps, durationS, distanceM } = input
  if (
    weightKg == null &&
    reps == null &&
    durationS == null &&
    distanceM == null
  ) {
    // Same rule as the sets_has_payload_ck constraint, raised here so the
    // message names the caller's mistake instead of a CHECK violation.
    throw new Error('logSet: a set must record weight, reps, duration or distance')
  }

  const now = Date.now()
  const { sessionId, exerciseId } = input
  const { lastInsertId } = await db.exec(
    `INSERT INTO sets (
        session_id, exercise_id, order_index, set_index, performed_at_utc,
        weight_kg, entered_value, entered_unit, load_mode,
        reps, duration_s, distance_m,
        base_weight_kg, equipment_id, set_type, notes,
        source, created_at, updated_at)
     VALUES (
        ?, ?,
        (SELECT COALESCE(MAX(order_index) + 1, 0) FROM sets
          WHERE session_id = ? AND deleted_at IS NULL),
        (SELECT COALESCE(MAX(set_index) + 1, 0) FROM sets
          WHERE session_id = ? AND exercise_id = ? AND deleted_at IS NULL),
        ?, ?, ?, ?,
        COALESCE(?, (SELECT default_load_mode FROM exercises WHERE id = ?)),
        ?, ?, ?,
        COALESCE(?, (SELECT ${BASE_WEIGHT_KG} FROM exercises e WHERE e.id = ?)),
        ?, ?, ?,
        'native', ?, ?)`,
    [
      sessionId,
      exerciseId,
      sessionId,
      sessionId,
      exerciseId,
      input.performedAtUtc ?? now,
      weightKg ?? null,
      input.enteredValue ?? null,
      input.enteredUnit ?? null,
      input.loadMode ?? null,
      exerciseId,
      reps ?? null,
      durationS ?? null,
      distanceM ?? null,
      input.baseWeightKg ?? null,
      exerciseId,
      input.equipmentId ?? null,
      input.setType ?? 'working',
      input.notes ?? null,
      now,
      now,
    ],
  )
  return lastInsertId
}

/**
 * Undo the most recent set of a session. Returns the id removed, or null.
 *
 * Soft delete: the row stays, so `source = 'native'` still guards re-import and
 * a mis-tap is recoverable. Because `logSet` derives its indices from live rows
 * only, the next set logged reuses the freed position.
 */
export function undoLastSet(db: Db, sessionId: number): Promise<number | null> {
  return db.transaction(async (tx) => {
    const row = await tx.queryOne<{ id: number }>(
      `SELECT id FROM sets
        WHERE session_id = ? AND deleted_at IS NULL
        ORDER BY order_index DESC, id DESC
        LIMIT 1`,
      [sessionId],
    )
    if (!row) return null
    const now = Date.now()
    await tx.exec('UPDATE sets SET deleted_at = ?, updated_at = ? WHERE id = ?', [
      now,
      now,
      row.id,
    ])
    return row.id
  })
}

export interface UpdateSetInput {
  weightKg?: number | null
  enteredValue?: number | null
  enteredUnit?: Unit | null
  reps?: number | null
  durationS?: number | null
  distanceM?: number | null
  setType?: SetType
  notes?: string | null
}

const PATCHABLE = {
  weightKg: 'weight_kg',
  enteredValue: 'entered_value',
  enteredUnit: 'entered_unit',
  reps: 'reps',
  durationS: 'duration_s',
  distanceM: 'distance_m',
  setType: 'set_type',
  notes: 'notes',
} as const

/**
 * Correct any set, not just the last one.
 *
 * Read, merge, write, inside one transaction. A single UPDATE with `COALESCE`
 * would be shorter but could never *clear* a field, and clearing is a real
 * edit: `bodyweight` gives weight as optional precisely because `Chinup` and
 * `Chest Dip` appear both weighted and unweighted in the same history. So an
 * absent key means "leave alone" and an explicit `null` means "clear", which is
 * why this reads `in` rather than checking for `undefined`.
 *
 * The merged row is checked against the same payload rule `logSet` enforces, so
 * an edit that would empty a set is refused by name instead of arriving as a
 * CHECK violation.
 */
export async function updateSet(
  db: Db,
  setId: number,
  patch: UpdateSetInput,
): Promise<void> {
  const keys = (Object.keys(PATCHABLE) as (keyof UpdateSetInput)[]).filter(
    (k) => k in patch,
  )
  if (keys.length === 0) return

  await db.transaction(async (tx) => {
    const current = await tx.queryOne<PerformedSet>(
      `SELECT ${SET_COLUMNS}
         FROM sets s
         JOIN exercises e ON e.id = s.exercise_id
        WHERE s.id = ? AND s.deleted_at IS NULL`,
      [setId],
    )
    if (!current) throw new Error(`updateSet: set ${setId} not found`)

    const merged = { ...current, ...patch }
    if (
      merged.weightKg == null &&
      merged.reps == null &&
      merged.durationS == null &&
      merged.distanceM == null
    ) {
      throw new Error('updateSet: a set must record weight, reps, duration or distance')
    }

    const assignments = keys.map((k) => `${PATCHABLE[k]} = ?`).join(', ')
    await tx.exec(
      `UPDATE sets SET ${assignments}, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
      [...keys.map((k) => patch[k] ?? null), Date.now(), setId],
    )
  })
}

/**
 * Soft delete one set and close the gap it leaves in that exercise's numbering.
 *
 * `undoLastSet` needs no renumbering because `logSet` derives `set_index` from
 * `MAX + 1` over live rows, so popping the tail frees the position naturally.
 * Deleting from the MIDDLE is different: it would leave `0, 2` behind, and
 * `PROJECT.md` records that 2,247 of the 2,248 imported groups are exactly
 * `0..n-1`. Holes would be a new thing in the data rather than a UI detail, so
 * the remaining sets are renumbered in the same transaction as the delete.
 *
 * `order_index` is deliberately left alone. It is the position within the
 * SESSION and exists so supersets interleave truthfully; it is an ordering key,
 * not a count, and a gap in it means nothing to any reader.
 */
export async function deleteSet(db: Db, setId: number): Promise<boolean> {
  return db.transaction(async (tx) => {
    const row = await tx.queryOne<{ sessionId: number; exerciseId: number }>(
      `SELECT session_id AS "sessionId", exercise_id AS "exerciseId"
         FROM sets WHERE id = ? AND deleted_at IS NULL`,
      [setId],
    )
    if (!row) return false

    const now = Date.now()
    await tx.exec('UPDATE sets SET deleted_at = ?, updated_at = ? WHERE id = ?', [
      now,
      now,
      setId,
    ])

    // One statement, no loop. `ROW_NUMBER()` is the same window-function family
    // as the `DENSE_RANK()` that `DbSmoke` already proved this device's SQLite
    // supports.
    await tx.exec(
      `UPDATE sets
          SET set_index = (
                SELECT rn FROM (
                  SELECT id, ROW_NUMBER() OVER (ORDER BY set_index, id) - 1 AS rn
                    FROM sets
                   WHERE session_id = ? AND exercise_id = ? AND deleted_at IS NULL
                ) ranked WHERE ranked.id = sets.id
              ),
              updated_at = ?
        WHERE session_id = ? AND exercise_id = ? AND deleted_at IS NULL`,
      [row.sessionId, row.exerciseId, now, row.sessionId, row.exerciseId],
    )
    return true
  })
}

// ------------------------------------------------------------------ history

export interface LastPerformance {
  exerciseId: number
  sessionId: number
  localDate: string
  startedAtUtc: number
  sets: PerformedSet[]
}

/** How many past sessions the logging screen stacks up per exercise. */
export const RECENT_SESSIONS = 3

/**
 * Recent sessions for each of `exerciseIds`, most recent first - the
 * highest-value feature in the logging screen, and the source of every prefill.
 *
 * Still **one statement for the whole template**, which is the rule that
 * matters: `DENSE_RANK` ranks whole sessions per exercise, and widening the
 * filter from `= 1` to `<= ?` costs nothing extra on the bridge. The tiebreak
 * on `ses.id` matters because two sessions can share a `started_at_utc` and
 * both would otherwise rank 1.
 *
 * More than one session because the logging screen stacks them as cards and
 * highlights the row matching the set being performed - see
 * `docs/PROGRESSION.md`. Callers wanting only the previous session take `[0]`.
 */
export async function recentPerformance(
  db: Db,
  exerciseIds: number[],
  opts: { excludeSessionId?: number; sessions?: number } = {},
): Promise<Map<number, LastPerformance[]>> {
  if (exerciseIds.length === 0) return new Map()
  const limit = Math.max(1, opts.sessions ?? RECENT_SESSIONS)

  const rows = await db.query<
    PerformedSet & { localDate: string; startedAtUtc: number; rnk: number }
  >(
    `SELECT * FROM (
        SELECT ${SET_COLUMNS},
               ses.local_date AS "localDate",
               ses.started_at_utc AS "startedAtUtc",
               DENSE_RANK() OVER (
                 PARTITION BY s.exercise_id
                 ORDER BY ses.started_at_utc DESC, ses.id DESC
               ) AS rnk
          FROM sets s
          JOIN sessions ses ON ses.id = s.session_id
          JOIN exercises e ON e.id = s.exercise_id
         WHERE s.exercise_id IN (${placeholders(exerciseIds.length)})
           AND s.session_id <> ?
           AND s.deleted_at IS NULL
           AND ses.deleted_at IS NULL
      )
      WHERE rnk <= ?
      ORDER BY "exerciseId", rnk, "setIndex", "orderIndex"`,
    [...exerciseIds, opts.excludeSessionId ?? NO_SESSION, limit],
  )

  return foldByExercise(rows)
}

/**
 * Ranked set rows into whole sessions, per exercise.
 *
 * Relies on the rows arriving grouped by rank, which both callers order for.
 * Shared so the exercise detail screen and the logging screen fold their
 * history the same way rather than twice.
 */
function foldByExercise(
  rows: (PerformedSet & { localDate: string; startedAtUtc: number })[],
): Map<number, LastPerformance[]> {
  const byExercise = new Map<number, LastPerformance[]>()
  for (const row of rows) {
    const list = byExercise.get(row.exerciseId) ?? []
    if (list.length === 0) byExercise.set(row.exerciseId, list)
    // The session being filled is always the last one appended.
    let entry = list.at(-1)
    if (!entry || entry.sessionId !== row.sessionId) {
      entry = {
        exerciseId: row.exerciseId,
        sessionId: row.sessionId,
        localDate: row.localDate,
        startedAtUtc: row.startedAtUtc,
        sets: [],
      }
      list.push(entry)
    }
    entry.sets.push(row)
  }
  return byExercise
}

/**
 * One exercise's whole history, newest session first.
 *
 * **Paged by rank, not by row.** A row limit would cut a session in half and
 * render it as though that was all that was performed; ranking whole sessions
 * means `Load more` can only ever add complete ones. Same `DENSE_RANK` window
 * function as `recentPerformance`, which is the one thing about the device's
 * SQLite that had to be proved rather than assumed.
 */
export async function exerciseHistory(
  db: Db,
  exerciseId: number,
  opts: { sessions: number; skip?: number } = { sessions: 10 },
): Promise<LastPerformance[]> {
  const skip = Math.max(0, opts.skip ?? 0)
  const to = skip + Math.max(1, opts.sessions)

  const rows = await db.query<PerformedSet & { localDate: string; startedAtUtc: number }>(
    `SELECT * FROM (
        SELECT ${SET_COLUMNS},
               ses.local_date AS "localDate",
               ses.started_at_utc AS "startedAtUtc",
               DENSE_RANK() OVER (
                 PARTITION BY s.exercise_id
                 ORDER BY ses.started_at_utc DESC, ses.id DESC
               ) AS rnk
          FROM sets s
          JOIN sessions ses ON ses.id = s.session_id
          JOIN exercises e ON e.id = s.exercise_id
         WHERE s.exercise_id = ?
           AND s.deleted_at IS NULL
           AND ses.deleted_at IS NULL
      )
      WHERE rnk > ? AND rnk <= ?
      ORDER BY rnk, "setIndex", "orderIndex"`,
    [exerciseId, skip, to],
  )

  return foldByExercise(rows).get(exerciseId) ?? []
}

export interface ExerciseDetailRow {
  id: number
  name: string
  primaryMuscle: string | null
  trackingType: TrackingType
  loadMode: LoadMode
  modality: string | null
  loading: string | null
  baseWeightKg: number | null
  incrementKg: number | null
  defaultRestS: number | null
  implementCount: number
  preferredUnit: Unit
  guidance: string | null
}

/** Everything the detail screen says about an exercise before its history. */
export function exerciseDetail(db: Db, exerciseId: number): Promise<ExerciseDetailRow | null> {
  return db.queryOne<ExerciseDetailRow>(
    `SELECT id,
            name,
            primary_muscle AS "primaryMuscle",
            tracking_type AS "trackingType",
            default_load_mode AS "loadMode",
            modality,
            loading,
            default_base_weight_kg AS "baseWeightKg",
            default_increment_kg AS "incrementKg",
            default_rest_s AS "defaultRestS",
            implement_count AS "implementCount",
            preferred_unit AS "preferredUnit",
            guidance
       FROM exercises
      WHERE id = ? AND deleted_at IS NULL`,
    [exerciseId],
  )
}

export interface ExerciseStats {
  totalSets: number
  sessionCount: number
  firstDate: string | null
  lastDate: string | null
  /** Heaviest set, ignoring assistance rows entirely. */
  bestWeightKg: number | null
  /** Lightest ASSISTANCE, which is the hardest such set. Null unless assisted. */
  leastAssistKg: number | null
  bestReps: number | null
  volumeKg: number | null
}

/**
 * What five years of one exercise came to, in one statement.
 *
 * **`assistance` inverts and is therefore split rather than branched over.** A
 * higher number on an Assisted Chinup is an easier set, so a single "best
 * weight" reads backwards for the 420 imported sets that record assistance.
 * Two columns, one of which is always null, lets the screen say the true thing
 * for either kind without the SQL having to know which it is looking at.
 */
export function exerciseStats(db: Db, exerciseId: number): Promise<ExerciseStats | null> {
  return db.queryOne<ExerciseStats>(
    `SELECT COUNT(s.id) AS "totalSets",
            COUNT(DISTINCT s.session_id) AS "sessionCount",
            MIN(ses.local_date) AS "firstDate",
            MAX(ses.local_date) AS "lastDate",
            MAX(CASE WHEN s.load_mode = 'assistance' THEN NULL ELSE s.weight_kg END)
              AS "bestWeightKg",
            MIN(CASE WHEN s.load_mode = 'assistance' THEN s.weight_kg END)
              AS "leastAssistKg",
            MAX(s.reps) AS "bestReps",
            ${VOLUME_KG} AS "volumeKg"
       FROM sets s
       JOIN sessions ses ON ses.id = s.session_id
      WHERE s.exercise_id = ?
        AND s.deleted_at IS NULL
        AND ses.deleted_at IS NULL`,
    [exerciseId],
  )
}

export interface Prefill {
  weightKg: number | null
  reps: number | null
  durationS: number | null
  distanceM: number | null
  /** Where the numbers came from, so the UI can say so. */
  source: 'current-session' | 'last-session' | 'none'
}

const EMPTY_PREFILL: Prefill = {
  weightKg: null,
  reps: null,
  durationS: null,
  distanceM: null,
  source: 'none',
}

/**
 * What the entry fields should already contain when an exercise is opened.
 *
 * Previous set of this exercise in *this* session first - that is what a second
 * or third set repeats. Otherwise the first set of the last session, which is
 * where a new exercise starts. Never a blank field: an empty form is a tap.
 */
export function prefillFor(
  sets: PerformedSet[],
  exerciseId: number,
  previous?: LastPerformance,
): Prefill {
  const inSession = sets
    .filter((s) => s.exerciseId === exerciseId)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .at(-1)

  const from = inSession ?? previous?.sets[0]
  if (!from) return EMPTY_PREFILL

  return {
    weightKg: from.weightKg,
    reps: from.reps,
    durationS: from.durationS,
    distanceM: from.distanceM,
    source: inSession ? 'current-session' : 'last-session',
  }
}

// ------------------------------------------------------- history and totals

/**
 * Volume, as one SQL expression, defined once.
 *
 * **`assistance` sets contribute nothing rather than being summed.** 420 sets in
 * the imported history record machine assistance, where a *higher* number is an
 * easier set, so adding them would make getting stronger read as decline. This
 * is the same rule `sessionTotals` in `logic/session.ts` applies in TypeScript,
 * and the two are held together by a conformance test in `repo.test.ts` rather
 * than by hoping - a screen totalling a list of sessions cannot pull every set
 * across the bridge to reuse the pure version.
 *
 * Expects the sets table aliased `s`.
 */
const VOLUME_KG = `SUM(CASE
          WHEN s.load_mode = 'assistance' THEN 0
          WHEN s.weight_kg IS NULL OR s.reps IS NULL THEN 0
          ELSE s.weight_kg * s.reps END)`

/** Finished sessions only. The live workout is not part of its own history. */
const FINISHED = `ses.ended_at_utc IS NOT NULL AND ses.deleted_at IS NULL`

export interface SessionHistoryRow extends SessionRow {
  setCount: number
  exerciseCount: number
  /** Null only for a session with no surviving sets - see the LEFT JOIN. */
  volumeKg: number | null
}

/**
 * Past workouts, newest first, with what each one came to.
 *
 * `LEFT JOIN` so a session whose sets were all deleted still lists rather than
 * silently disappearing; its counts come back zero and its volume null.
 *
 * Paged rather than unbounded: there are 343 sessions today and Home shows five
 * of them. The caller grows `limit` instead of chasing a cursor, because the
 * database is a local file and re-reading 50 rows costs less than the code to
 * avoid it would.
 */
export function listSessionHistory(
  db: Db,
  opts: { limit: number; offset?: number } = { limit: 20 },
): Promise<SessionHistoryRow[]> {
  return db.query<SessionHistoryRow>(
    `SELECT ses.id,
            ses.name,
            ses.started_at_utc AS "startedAtUtc",
            ses.ended_at_utc AS "endedAtUtc",
            ses.local_date AS "localDate",
            ses.template_id AS "templateId",
            ses.notes,
            COUNT(s.id) AS "setCount",
            COUNT(DISTINCT s.exercise_id) AS "exerciseCount",
            ${VOLUME_KG} AS "volumeKg"
       FROM sessions ses
       LEFT JOIN sets s ON s.session_id = ses.id AND s.deleted_at IS NULL
      WHERE ${FINISHED}
      GROUP BY ses.id
      ORDER BY ses.started_at_utc DESC, ses.id DESC
      LIMIT ? OFFSET ?`,
    [opts.limit, opts.offset ?? 0],
  )
}

export interface HistoryStats {
  sessions: number
  sets: number
  volumeKg: number | null
  /** Summed session durations, in ms. Null before anything is finished. */
  trainedMs: number | null
  thisWeek: number
  /** Sessions in the last 28 days, which the UI divides by four. */
  last28: number
  firstDate: string | null
  lastDate: string | null
}

/**
 * Everything Home says about training as a whole, in one statement.
 *
 * **Scalar subqueries, deliberately not a join.** Joining sets to sessions
 * repeats each session once per set, so `COUNT(*)` over that would report sets
 * where it claims sessions and `SUM(ended - started)` would multiply every
 * duration by the number of sets in it. Each subquery below stands alone and can
 * be read on its own terms.
 *
 * Both date boundaries are computed by the caller (`logic/dates.ts`) and passed
 * as parameters. `local_date` is a string here, so date arithmetic belongs where
 * there is a calendar rather than in SQLite's date functions.
 */
export function historyStats(
  db: Db,
  bounds: { weekStart: string; fourWeeksAgo: string },
): Promise<HistoryStats | null> {
  return db.queryOne<HistoryStats>(
    `SELECT
       (SELECT COUNT(*) FROM sessions ses WHERE ${FINISHED}) AS "sessions",
       (SELECT COUNT(*) FROM sets s
          JOIN sessions ses ON ses.id = s.session_id
         WHERE s.deleted_at IS NULL AND ${FINISHED}) AS "sets",
       (SELECT ${VOLUME_KG} FROM sets s
          JOIN sessions ses ON ses.id = s.session_id
         WHERE s.deleted_at IS NULL AND ${FINISHED}) AS "volumeKg",
       (SELECT SUM(ses.ended_at_utc - ses.started_at_utc) FROM sessions ses
         WHERE ${FINISHED}) AS "trainedMs",
       (SELECT COUNT(*) FROM sessions ses
         WHERE ${FINISHED} AND ses.local_date >= ?) AS "thisWeek",
       (SELECT COUNT(*) FROM sessions ses
         WHERE ${FINISHED} AND ses.local_date >= ?) AS "last28",
       (SELECT MIN(ses.local_date) FROM sessions ses WHERE ${FINISHED}) AS "firstDate",
       (SELECT MAX(ses.local_date) FROM sessions ses WHERE ${FINISHED}) AS "lastDate"`,
    [bounds.weekStart, bounds.fourWeeksAgo],
  )
}

export interface MuscleSetCount {
  /** Free text straight from the column, including null - see `muscleMark`. */
  muscle: string | null
  sets: number
}

/**
 * Sets per muscle group since a date, biggest first.
 *
 * Sets rather than volume: the groups being compared are loaded in completely
 * different ranges, so a leg day would outweigh everything else on volume and
 * say nothing about balance. Counting sets is the comparison actually being
 * made - how much work went where.
 *
 * Four of the 87 exercises are deliberately unclassified, so a null group is a
 * real row here and the UI buckets it rather than guessing.
 */
export function setsByMuscle(db: Db, since: string): Promise<MuscleSetCount[]> {
  return db.query<MuscleSetCount>(
    `SELECT e.primary_muscle AS "muscle",
            COUNT(*) AS "sets"
       FROM sets s
       JOIN sessions ses ON ses.id = s.session_id
       JOIN exercises e ON e.id = s.exercise_id
      WHERE s.deleted_at IS NULL
        AND e.deleted_at IS NULL
        AND ${FINISHED}
        AND ses.local_date >= ?
      GROUP BY e.primary_muscle
      ORDER BY "sets" DESC`,
    [since],
  )
}
