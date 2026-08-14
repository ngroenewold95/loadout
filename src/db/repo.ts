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
import type { LoadMode, SetType, TrackingType } from './schema.ts'
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
  /** Free text, often null. Feed it to `muscleBadge`, which degrades safely. */
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
            e.default_base_weight_kg AS "baseWeightKg",
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
            e.default_base_weight_kg AS "baseWeightKg",
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
  /** Free text, often null. Feed it to `muscleBadge`, which degrades safely. */
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
        COALESCE(?, (SELECT default_base_weight_kg FROM exercises WHERE id = ?)),
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

  const byExercise = new Map<number, LastPerformance[]>()
  for (const row of rows) {
    const list = byExercise.get(row.exerciseId) ?? []
    if (list.length === 0) byExercise.set(row.exerciseId, list)
    // Rows arrive grouped by rank, so the session being filled is always the
    // last one appended.
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
