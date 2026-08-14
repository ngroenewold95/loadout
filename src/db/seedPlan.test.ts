/**
 * The plan seed is only useful if every name in it resolves to a real exercise.
 * A typo there would surface as an empty template on the phone, mid-workout.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openNodeDb, type NodeDb } from './node.ts'
import { applyMigrations } from './migrations.ts'
import { loadMigrations } from '../../scripts/migrate.ts'
import { seedPlanTemplates } from './seedPlan.ts'
import { listTemplates, listTemplateExercises, nextTemplate } from './repo.ts'
import { PLAN, NEW_EXERCISES } from '../logic/plan.ts'

const MIGRATIONS = loadMigrations()

/** Every exercise the plan expects to already exist. */
const PRE_EXISTING = [
  ...new Set(PLAN.flatMap((d) => d.exercises.map((e) => e.exercise))),
].filter((name) => !NEW_EXERCISES.some((n) => n.name === name))

let db: NodeDb

beforeEach(async () => {
  db = openNodeDb(':memory:')
  await applyMigrations(db, MIGRATIONS)
  const now = Date.now()
  await db.batch(
    PRE_EXISTING.map((name) => ({
      sql: 'INSERT INTO exercises (name, created_at, updated_at) VALUES (?, ?, ?)',
      params: [name, now, now],
    })),
  )
})

afterEach(async () => {
  await db.close()
})

describe('seedPlanTemplates', () => {
  it('writes both days with their exercises in order', async () => {
    const result = await seedPlanTemplates(db)
    expect(result.missing).toEqual([])
    expect(result.templates).toEqual(PLAN.map((d) => d.name))

    const templates = await listTemplates(db)
    expect(templates.map((t) => [t.name, t.exerciseCount])).toEqual(
      PLAN.map((d) => [d.name, d.exercises.length]),
    )

    for (const [i, day] of PLAN.entries()) {
      const rows = await listTemplateExercises(db, templates[i].id)
      expect(rows.map((r) => r.name)).toEqual(day.exercises.map((e) => e.exercise))
      expect(rows.map((r) => [r.targetRepMin, r.targetRepMax])).toEqual(
        day.exercises.map((e) => [e.repMin, e.repMax]),
      )
      expect(rows.map((r) => r.restS)).toEqual(day.exercises.map((e) => e.restS))
    }
  })

  it('creates the exercises the plan introduces', async () => {
    const result = await seedPlanTemplates(db)
    expect(result.createdExercises).toEqual(NEW_EXERCISES.map((e) => e.name))

    const row = await db.queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM exercises WHERE name = ?',
      [NEW_EXERCISES[0].name],
    )
    expect(row?.n).toBe(1)
  })

  it('is safe to re-run - replaces rather than duplicating', async () => {
    await seedPlanTemplates(db)
    await seedPlanTemplates(db)

    const templates = await listTemplates(db)
    expect(templates.map((t) => t.name)).toEqual(PLAN.map((d) => d.name))
    // The superseded rows are soft-deleted, not stacked on top of each other.
    const live = await db.queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM template_exercises WHERE deleted_at IS NULL',
    )
    expect(live?.n).toBe(PLAN.reduce((n, d) => n + d.exercises.length, 0))
  })

  it('names an unknown exercise instead of seeding a broken template', async () => {
    await db.exec('DELETE FROM exercises WHERE name = ?', [PRE_EXISTING[0]])
    await expect(seedPlanTemplates(db)).rejects.toThrow(PRE_EXISTING[0])

    // The failed seed left nothing behind.
    expect(await listTemplates(db)).toEqual([])
  })
})

describe('nextTemplate', () => {
  it('picks the day performed least recently - rolling, not by weekday', async () => {
    await seedPlanTemplates(db)
    const [dayA, dayB] = await listTemplates(db)

    // Nothing performed yet: the first day is up.
    expect((await nextTemplate(db))?.name).toBe(dayA.name)

    const now = Date.now()
    await db.exec(
      `INSERT INTO sessions (name, started_at_utc, ended_at_utc, local_date, template_id, source, created_at, updated_at)
       VALUES (?, ?, ?, '2026-08-08', ?, 'native', ?, ?)`,
      [dayA.name, now, now, dayA.id, now, now],
    )
    expect((await nextTemplate(db))?.name).toBe(dayB.name)

    await db.exec(
      `INSERT INTO sessions (name, started_at_utc, ended_at_utc, local_date, template_id, source, created_at, updated_at)
       VALUES (?, ?, ?, '2026-08-09', ?, 'native', ?, ?)`,
      [dayB.name, now, now, dayB.id, now, now],
    )
    expect((await nextTemplate(db))?.name).toBe(dayA.name)
  })

  it('returns null when there are no templates', async () => {
    expect(await nextTemplate(db)).toBeNull()
  })
})
