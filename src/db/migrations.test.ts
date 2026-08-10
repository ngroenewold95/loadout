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
    await expect(applyMigrations(db, ALL)).resolves.toBe(1)

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
