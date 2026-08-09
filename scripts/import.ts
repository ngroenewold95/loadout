/**
 * Progression CSV -> SQLite.
 *
 * Drop-and-rebuild: 6,140 rows insert in well under a second, so there is no
 * upsert machinery and no half-applied-import failure mode. Each run writes a
 * fresh database file.
 *
 * REFUSES TO RUN once any natively-logged set exists. After cutover a
 * destructive re-import would silently delete real workouts.
 *
 *   npm run import [csvPath]
 */
import Database from 'better-sqlite3'
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { parseCsv, toRecords } from '../src/logic/csv.ts'
import { mapExport, COLUMNS } from '../src/logic/progression.ts'
import { fromKg } from '../src/logic/units.ts'
import { loadMigrations } from './migrate.ts'
import { applyMigrations } from '../src/db/migrations.ts'
import { openNodeDb } from '../src/db/node.ts'
import { seedPlanTemplates } from '../src/db/seedPlan.ts'

const csvPath = process.argv[2] ?? 'Examples/2026-07-22_08-05-17.csv'
const dbPath = process.argv[3] ?? 'db/loadout.sqlite'

// ---------------------------------------------------------------- guard rail
if (existsSync(dbPath)) {
  const existing = new Database(dbPath, { readonly: true })
  try {
    const hasSets = existing
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sets'")
      .get()
    if (hasSets) {
      const { n } = existing
        .prepare("SELECT COUNT(*) n FROM sets WHERE source = 'native'")
        .get() as { n: number }
      if (n > 0) {
        console.error(
          `\nRefusing to import: ${dbPath} already contains ${n} natively-logged set(s).\n` +
            `Cutover has happened. Re-importing would delete real workouts.\n` +
            `If you genuinely mean to start over, move that file aside first.\n`,
        )
        process.exit(1)
      }
    }
  } finally {
    existing.close()
  }
  rmSync(dbPath, { force: true })
  rmSync(`${dbPath}-wal`, { force: true })
  rmSync(`${dbPath}-shm`, { force: true })
}

// ------------------------------------------------------------------- parse
const raw = readFileSync(csvPath, 'utf8')
const sha = createHash('sha256').update(raw).digest('hex')
const parsed = parseCsv(raw)
const records = toRecords(parsed)
const mapped = mapExport(records)

console.log(`source     ${csvPath}`)
console.log(`sha256     ${sha}`)
console.log(`rows       ${records.length}`)
console.log(`sessions   ${mapped.sessions.length}`)
console.log(`exercises  ${mapped.exercises.length}`)

// ------------------------------------------------------------------ migrate
mkdirSync('db', { recursive: true })
const handle = openNodeDb(dbPath)
await applyMigrations(handle, loadMigrations())
// Bulk insert stays on the synchronous better-sqlite3 handle: 6,140 prepared
// statements inside one transaction, which is a laptop-only luxury.
const db = handle.raw

// ------------------------------------------------------------------- insert
const now = Date.now()
const file = basename(csvPath)

const insertExercise = db.prepare(
  `INSERT INTO exercises (name, tracking_type, default_load_mode, preferred_unit, implement_count, created_at, updated_at)
   VALUES (?, ?, ?, 'lb', ?, ?, ?)`,
)
const insertSession = db.prepare(
  `INSERT INTO sessions (name, started_at_utc, ended_at_utc, local_date, notes, source, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, 'progression_csv', ?, ?)`,
)
const insertSet = db.prepare(
  `INSERT INTO sets (session_id, exercise_id, order_index, set_index, performed_at_utc,
                     weight_kg, entered_value, entered_unit, load_mode, reps, duration_s,
                     distance_m, rpe, set_type, completed, notes, source, source_file,
                     source_line, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'progression_csv', ?, ?, ?, ?)`,
)

const exerciseIds = new Map<string, number>()
const sessionIds = new Map<string, number>()

const run = db.transaction(() => {
  for (const ex of mapped.exercises) {
    // Two-handed dumbbell lifts log the pair total, so the UI must render
    // "2 x 100 lb". Single-arm variants move one bell.
    const isDumbbell = /\bDumbbell\b/.test(ex.name)
    const isUnilateral = /Single-Arm|Single Leg|Bulgarian/i.test(ex.name)
    const implements_ = isDumbbell && !isUnilateral ? 2 : 1
    const info = insertExercise.run(
      ex.name,
      ex.trackingType,
      ex.loadMode,
      implements_,
      now,
      now,
    )
    exerciseIds.set(ex.name, Number(info.lastInsertRowid))
  }

  for (const s of mapped.sessions) {
    const info = insertSession.run(
      s.name,
      s.startedAtUtc,
      s.endedAtUtc,
      s.localDate,
      s.notes,
      now,
      now,
    )
    sessionIds.set(s.key, Number(info.lastInsertRowid))
  }

  for (const st of mapped.sets) {
    insertSet.run(
      sessionIds.get(st.sessionKey)!,
      exerciseIds.get(st.exerciseName)!,
      st.orderIndex,
      st.setIndex,
      st.performedAtUtc,
      st.weightKg,
      st.enteredValue,
      st.enteredUnit,
      st.loadMode,
      st.reps,
      st.durationS,
      st.distanceM,
      st.rpe,
      st.setType,
      st.notes,
      file,
      st.sourceLine,
      now,
      now,
    )
  }
})
run()

// ------------------------------------------------- derived defaults + templates
/**
 * Seed `default_rest_s` from what actually happened.
 *
 * Rest is recoverable from the gaps between consecutive set timestamps within
 * an exercise. Measured across the whole export: p10 110 s, median 169 s,
 * p90 249 s. Real numbers beat a guessed 90 s default.
 */
const restRows = db
  .prepare(
    `SELECT exercise_id, gap FROM (
       SELECT s.exercise_id,
              s.performed_at_utc - LAG(s.performed_at_utc) OVER (
                PARTITION BY s.session_id, s.exercise_id ORDER BY s.performed_at_utc
              ) AS gap
       FROM sets s WHERE s.performed_at_utc IS NOT NULL
     ) WHERE gap IS NOT NULL AND gap > 0 AND gap < 1200000`,
  )
  .all() as { exercise_id: number; gap: number }[]

const gapsBy = new Map<number, number[]>()
for (const { exercise_id, gap } of restRows) {
  const arr = gapsBy.get(exercise_id)
  if (arr) arr.push(gap)
  else gapsBy.set(exercise_id, [gap])
}
const setRest = db.prepare('UPDATE exercises SET default_rest_s = ? WHERE id = ?')
db.transaction(() => {
  for (const [id, gaps] of gapsBy) {
    gaps.sort((a, b) => a - b)
    const medianS = Math.round(gaps[Math.floor(gaps.length / 2)] / 1000)
    // Snap to 15 s so the UI shows sane round numbers.
    setRest.run(Math.max(30, Math.round(medianS / 15) * 15), id)
  }
})()

/**
 * Seed the templates from the CURRENT programme, not from history.
 *
 * These used to be reverse-engineered from the most recent Day 1 / Day 2 /
 * Day 3 sessions. That split has been retired: the history stays valid as
 * history, but the programme going forward is the A/B rotation in
 * `src/logic/plan.ts`. 20 of its 21 exercises already carry years of sets, so
 * the last-session panel is populated from the first workout.
 *
 * After cutover the database owns the templates and the in-app editor edits
 * them - this only ever runs on a rebuilt, pre-cutover database.
 */
const seeded = await seedPlanTemplates(handle)
console.log(
  `\nseeded ${seeded.templates.length} template(s) from the plan: ${seeded.templates.join(', ')}`,
)
if (seeded.createdExercises.length > 0) {
  console.log(`  created new exercise(s): ${seeded.createdExercises.join(', ')}`)
}

// ------------------------------------------------------------ reconciliation
console.log('\nreconciliation')
console.log('─'.repeat(64))

const check = (label: string, actual: number, expected: number, tol = 0) => {
  const ok = Math.abs(actual - expected) <= tol
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(34)} ${actual} ${ok ? '==' : '!='} ${expected}`,
  )
  return ok
}

const one = <T>(sql: string): T => db.prepare(sql).get() as T

let allOk = true
allOk = check('sets in db', one<{ n: number }>('SELECT COUNT(*) n FROM sets').n, records.length) && allOk
allOk = check('sessions in db', one<{ n: number }>('SELECT COUNT(*) n FROM sessions').n, mapped.sessions.length) && allOk
// Counted as "exercises the export produced sets for", not "rows in the table":
// seeding the current plan legitimately adds exercises with no history behind
// them (Pallof Press). This is the stronger check anyway - it proves every
// imported exercise actually got its sets attached.
allOk = check('exercises from the export', one<{ n: number }>('SELECT COUNT(DISTINCT exercise_id) n FROM sets').n, mapped.exercises.length) && allOk

// Total volume, recomputed from the CSV and from the database independently.
const csvVolume = records.reduce((sum, { record }) => {
  const w = Number(record[COLUMNS.weight])
  const r = Number(record[COLUMNS.reps])
  return sum + (Number.isFinite(w) && Number.isFinite(r) ? w * r : 0)
}, 0)
const dbVolumeKg = one<{ v: number | null }>(
  'SELECT SUM(weight_kg * reps) v FROM sets WHERE weight_kg IS NOT NULL AND reps IS NOT NULL',
).v
const dbVolumeLb = fromKg(dbVolumeKg ?? 0, 'lb')
allOk = check('total volume (lb)', Math.round(dbVolumeLb), Math.round(csvVolume), 1) && allOk

const distinctDates = one<{ n: number }>('SELECT COUNT(DISTINCT local_date) n FROM sessions').n
allOk = check('distinct local dates', distinctDates, new Set(records.map((r) => r.record[COLUMNS.date])).size) && allOk

const assisted = one<{ n: number }>("SELECT COUNT(*) n FROM sets WHERE load_mode='assistance'").n
console.log(`  info assistance sets                ${assisted}`)

const range = one<{ lo: string; hi: string }>(
  'SELECT MIN(local_date) lo, MAX(local_date) hi FROM sessions',
)
console.log(`  info date range                     ${range.lo} -> ${range.hi}`)

// Per-exercise totals catch a mis-mapping that global counts cannot.
const perExercise = db
  .prepare(
    `SELECT e.name, COUNT(*) n, COALESCE(SUM(s.reps),0) reps
     FROM sets s JOIN exercises e ON e.id = s.exercise_id
     GROUP BY e.id`,
  )
  .all() as { name: string; n: number; reps: number }[]

const csvPerExercise = new Map<string, { n: number; reps: number }>()
for (const { record } of records) {
  const k = record[COLUMNS.exercise]
  const cur = csvPerExercise.get(k) ?? { n: 0, reps: 0 }
  cur.n++
  const r = Number(record[COLUMNS.reps])
  if (Number.isFinite(r)) cur.reps += r
  csvPerExercise.set(k, cur)
}
const mismatched = perExercise.filter((row) => {
  const src = csvPerExercise.get(row.name)
  return !src || src.n !== row.n || Math.abs(src.reps - row.reps) > 0.001
})
allOk = check('per-exercise mismatches', mismatched.length, 0) && allOk
for (const m of mismatched.slice(0, 5)) console.log(`       ${m.name}`)

if (mapped.anomalies.length > 0) {
  console.log('\nanomalies')
  console.log('─'.repeat(64))
  for (const a of mapped.anomalies) {
    console.log(`  ${a.kind}: ${a.detail}${a.sessionKey ? ` [${a.sessionKey}]` : ''}${a.line ? ` (line ${a.line})` : ''}`)
  }
}

db.close()
console.log(allOk ? '\nimport OK' : '\nIMPORT FAILED RECONCILIATION')
process.exit(allOk ? 0 : 1)
