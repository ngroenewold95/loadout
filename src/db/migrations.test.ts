/**
 * Migrations, applied to a database that already has rows in it.
 *
 * `repo.test.ts` migrates an empty database, which proves the SQL parses but
 * not that it preserves anything. That distinction matters for 0004: it is a
 * create-new / copy / drop / rename rebuild of `exercises`, and `exercises` is
 * a PARENT table - `sets`, `template_exercises` and `exercise_aliases` all
 * point at it. Migration 0001 did the same dance safely only because
 * `template_exercises` is referenced by nothing.
 *
 * Two specific hazards are under test here, both recorded in `PROJECT.md`:
 *
 * - drizzle-kit's `INSERT ... SELECT` reading new columns from the old table
 *   (0004 was hand-fixed for exactly this)
 * - `PRAGMA foreign_keys=OFF` being a **no-op inside a transaction**, which is
 *   where the migration runner puts it, so the DROP happens with enforcement
 *   still on and children still present
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openNodeDb, type NodeDb } from './node.ts'
import { applyMigrations } from './migrations.ts'
import { loadMigrations } from '../../scripts/migrate.ts'

const ALL = loadMigrations()
const upTo = (index: number) => ALL.filter((f) => f.index <= index)

const EXERCISES_REBUILD = 4

let db: NodeDb

beforeEach(() => {
  db = openNodeDb(':memory:')
})

afterEach(async () => {
  await db.close()
})

/** An exercise with one of every kind of child row pointing at it. */
async function seedDependents(): Promise<number> {
  const now = Date.now()
  const { lastInsertId: exerciseId } = await db.exec(
    `INSERT INTO exercises (name, modality, default_base_weight_kg, created_at, updated_at)
     VALUES ('Trap Bar Deadlift', 'barbell', 29.48, ?, ?)`,
    [now, now],
  )
  await db.exec(
    `INSERT INTO exercise_aliases (exercise_id, alias, created_at, updated_at)
     VALUES (?, 'Trap bar DL', ?, ?)`,
    [exerciseId, now, now],
  )
  const { lastInsertId: templateId } = await db.exec(
    `INSERT INTO templates (name, order_index, created_at, updated_at)
     VALUES ('Day A - Trap Bar', 0, ?, ?)`,
    [now, now],
  )
  await db.exec(
    `INSERT INTO template_exercises
       (template_id, exercise_id, order_index, target_sets, created_at, updated_at)
     VALUES (?, ?, 0, 2, ?, ?)`,
    [templateId, exerciseId, now, now],
  )
  const { lastInsertId: sessionId } = await db.exec(
    `INSERT INTO sessions (name, started_at_utc, local_date, created_at, updated_at)
     VALUES ('Day A - Trap Bar', ?, '2026-08-09', ?, ?)`,
    [now, now, now],
  )
  await db.exec(
    `INSERT INTO sets
       (session_id, exercise_id, order_index, set_index, weight_kg, reps, created_at, updated_at)
     VALUES (?, ?, 0, 0, 100, 5, ?, ?)`,
    [sessionId, exerciseId, now, now],
  )
  return exerciseId
}

describe('migration 0004, rebuilding a parent table that has children', () => {
  it('applies over existing rows without tripping foreign keys', async () => {
    await applyMigrations(db, upTo(EXERCISES_REBUILD - 1))
    const exerciseId = await seedDependents()

    // The real assertion. `PRAGMA foreign_keys=OFF` inside the runner's
    // transaction does nothing, so this DROP runs with children present.
    //
    // The count is derived rather than written out: it used to be a literal 1,
    // which meant this test failed the moment a later migration was added, for
    // a reason that had nothing to do with what it is testing.
    const pending = ALL.length - upTo(EXERCISES_REBUILD - 1).length
    await expect(applyMigrations(db, ALL)).resolves.toBe(pending)

    const [row] = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM exercises')
    expect(row.n).toBe(1)
    const [set] = await db.query<{ exerciseId: number }>(
      'SELECT exercise_id AS "exerciseId" FROM sets',
    )
    expect(set.exerciseId).toBe(exerciseId)
  })

  it('leaves no dangling child rows behind', async () => {
    await applyMigrations(db, upTo(EXERCISES_REBUILD - 1))
    await seedDependents()
    await applyMigrations(db, ALL)

    for (const table of ['sets', 'template_exercises', 'exercise_aliases']) {
      const [row] = await db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)
      expect(row.n, `${table} lost its row`).toBe(1)
    }
    const orphans = await db.query<{ n: number }>('PRAGMA foreign_key_check')
    expect(orphans).toEqual([])
  })

  it('preserves the columns it copied, and starts the new ones empty', async () => {
    await applyMigrations(db, upTo(EXERCISES_REBUILD - 1))
    await seedDependents()
    await applyMigrations(db, ALL)

    const [row] = await db.query<{
      name: string
      modality: string | null
      base: number | null
      loading: string | null
      increment: number | null
    }>(
      `SELECT name, modality,
              default_base_weight_kg AS base,
              loading,
              default_increment_kg AS increment
         FROM exercises`,
    )
    expect(row.name).toBe('Trap Bar Deadlift')
    expect(row.modality).toBe('barbell')
    expect(row.base).toBe(29.48)
    // Hand-fixed to NULL; the generated SQL read these from the old table.
    expect(row.loading).toBeNull()
    expect(row.increment).toBeNull()
  })

  it('keeps the partial unique index, so a deleted name can be reused', async () => {
    await applyMigrations(db, ALL)
    const now = Date.now()
    await db.exec(
      `INSERT INTO exercises (name, created_at, updated_at, deleted_at) VALUES ('Squat', ?, ?, ?)`,
      [now, now, now],
    )
    await expect(
      db.exec(`INSERT INTO exercises (name, created_at, updated_at) VALUES ('Squat', ?, ?)`, [
        now,
        now,
      ]),
    ).resolves.toBeTruthy()
  })

  it('enforces the new loading CHECK', async () => {
    await applyMigrations(db, ALL)
    const now = Date.now()
    await expect(
      db.exec(
        `INSERT INTO exercises (name, loading, created_at, updated_at) VALUES ('Bad', 'pins', ?, ?)`,
        [now, now],
      ),
    ).rejects.toThrow()
    await expect(
      db.exec(
        `INSERT INTO exercises (name, loading, created_at, updated_at) VALUES ('Good', 'stack', ?, ?)`,
        [now, now],
      ),
    ).resolves.toBeTruthy()
  })
})

describe('migration 0005, the session plan snapshot', () => {
  const SESSION_EXERCISES = 5

  /** A template, one live session started from it, and one finished session. */
  async function seedSessions(): Promise<{ live: number; finished: number }> {
    const now = Date.now()
    const { lastInsertId: exerciseId } = await db.exec(
      `INSERT INTO exercises (name, default_rest_s, created_at, updated_at)
       VALUES ('Trap Bar Deadlift', 180, ?, ?)`,
      [now, now],
    )
    const { lastInsertId: templateId } = await db.exec(
      `INSERT INTO templates (name, order_index, created_at, updated_at)
       VALUES ('Day A - Trap Bar', 0, ?, ?)`,
      [now, now],
    )
    await db.exec(
      `INSERT INTO template_exercises
         (template_id, exercise_id, order_index, target_sets, target_rep_min,
          target_rep_max, rest_s, created_at, updated_at)
       VALUES (?, ?, 0, 2, 5, 8, NULL, ?, ?)`,
      [templateId, exerciseId, now, now],
    )
    const { lastInsertId: live } = await db.exec(
      `INSERT INTO sessions (name, started_at_utc, local_date, template_id, created_at, updated_at)
       VALUES ('Day A - Trap Bar', ?, '2026-08-13', ?, ?, ?)`,
      [now, templateId, now, now],
    )
    const { lastInsertId: finished } = await db.exec(
      `INSERT INTO sessions
         (name, started_at_utc, ended_at_utc, local_date, template_id, created_at, updated_at)
       VALUES ('Day A - Trap Bar', ?, ?, '2026-08-09', ?, ?, ?)`,
      [now, now, templateId, now, now],
    )
    return { live, finished }
  }

  it('backfills the workout that was already in progress', async () => {
    await applyMigrations(db, upTo(SESSION_EXERCISES - 1))
    const { live } = await seedSessions()
    await applyMigrations(db, ALL)

    // Without this the running workout would come back from the migration with
    // an empty exercise list, because `startSession` is what fills this table
    // and that session started before the table existed.
    const rows = await db.query<{
      exerciseId: number
      targetSets: number
      restS: number
    }>(
      `SELECT exercise_id AS "exerciseId",
              target_sets AS "targetSets",
              rest_s AS "restS"
         FROM session_exercises WHERE session_id = ?`,
      [live],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].targetSets).toBe(2)
    // Resolved through the exercise default, not copied as the template's null.
    expect(rows[0].restS).toBe(180)
  })

  it('leaves finished sessions alone', async () => {
    await applyMigrations(db, upTo(SESSION_EXERCISES - 1))
    const { finished } = await seedSessions()
    await applyMigrations(db, ALL)

    // Nothing renders an exercise list for a finished session - the summary
    // reads `sets` - so copying rows for all 343 of them is work no query does.
    const [row] = await db.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM session_exercises WHERE session_id = ?',
      [finished],
    )
    expect(row.n).toBe(0)
  })

  it('orphans nothing', async () => {
    await applyMigrations(db, upTo(SESSION_EXERCISES - 1))
    await seedSessions()
    await applyMigrations(db, ALL)

    const orphans = await db.query('PRAGMA foreign_key_check')
    expect(orphans).toEqual([])
  })

  it('enforces the rep-range CHECK', async () => {
    await applyMigrations(db, ALL)
    const { live } = await seedSessions()
    const now = Date.now()
    const insert = (min: number, max: number) =>
      db.exec(
        `INSERT INTO session_exercises
           (session_id, exercise_id, order_index, target_rep_min, target_rep_max, created_at, updated_at)
         VALUES (?, 1, 0, ?, ?, ?, ?)`,
        [live, min, max, now, now],
      )
    await expect(insert(8, 5)).rejects.toThrow()
    await expect(insert(5, 8)).resolves.toBeTruthy()
  })
})

describe('migration 0003, the settings tables', () => {
  it('allows exactly one settings row', async () => {
    await applyMigrations(db, ALL)
    const now = Date.now()
    await expect(
      db.exec('INSERT INTO app_settings (id, created_at, updated_at) VALUES (1, ?, ?)', [
        now,
        now,
      ]),
    ).resolves.toBeTruthy()
    await expect(
      db.exec('INSERT INTO app_settings (id, created_at, updated_at) VALUES (2, ?, ?)', [
        now,
        now,
      ]),
    ).rejects.toThrow()
  })

  it('rejects a plate with a non-positive weight or a negative count', async () => {
    await applyMigrations(db, ALL)
    const now = Date.now()
    const insert = (kg: number, count: number) =>
      db.exec(
        'INSERT INTO plate_inventory (weight_kg, count, created_at, updated_at) VALUES (?, ?, ?, ?)',
        [kg, count, now, now],
      )
    await expect(insert(0, 8)).rejects.toThrow()
    await expect(insert(20.41, -1)).rejects.toThrow()
    await expect(insert(20.41, 8)).resolves.toBeTruthy()
  })
})
