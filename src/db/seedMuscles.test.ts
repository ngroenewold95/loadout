/**
 * The badge is only useful if it is right, and it is only right if every
 * exercise in the current programme carries a group. A `?` circle on a template
 * row is the failure this suite exists to catch.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openNodeDb, type NodeDb } from './node.ts'
import { applyMigrations } from './migrations.ts'
import { loadMigrations } from '../../scripts/migrate.ts'
import { seedExerciseMuscles } from './seedMuscles.ts'
import { seedPlanTemplates } from './seedPlan.ts'
import { listTemplates, listTemplateExercises } from './repo.ts'
import { MUSCLE_BY_EXERCISE } from '../logic/exerciseMuscles.ts'
import { MUSCLES, muscleBadge } from '../logic/muscles.ts'
import { NEW_EXERCISES, PLAN } from '../logic/plan.ts'

const MIGRATIONS = loadMigrations()

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

describe('the muscle table itself', () => {
  it('only uses groups that have a colour', () => {
    for (const [name, muscle] of Object.entries(MUSCLE_BY_EXERCISE)) {
      if (muscle === null) continue
      expect(MUSCLES, `${name} maps to an unknown group`).toContain(muscle)
    }
  })

  it('gives every exercise in the current programme a real group', () => {
    for (const day of PLAN) {
      for (const { exercise } of day.exercises) {
        expect(MUSCLE_BY_EXERCISE[exercise], `${exercise} is unmapped`).toBeTruthy()
      }
    }
  })
})

describe('seedExerciseMuscles', () => {
  it('fills every blank and reports nothing unmapped', async () => {
    const result = await seedExerciseMuscles(db)
    expect(result.unmapped).toEqual([])
    expect(result.withGroup).toBe(PRE_EXISTING.length)

    const rows = await db.query<{ name: string; primary_muscle: string }>(
      'SELECT name, primary_muscle FROM exercises',
    )
    for (const row of rows) {
      expect(row.primary_muscle, `${row.name} was left blank`).toBe(
        MUSCLE_BY_EXERCISE[row.name],
      )
    }
  })

  it('never overwrites a group already set by hand', async () => {
    await db.exec('UPDATE exercises SET primary_muscle = ? WHERE name = ?', [
      'abs',
      'Trap Bar Deadlift',
    ])
    await seedExerciseMuscles(db)

    const row = await db.queryOne<{ m: string }>(
      'SELECT primary_muscle AS m FROM exercises WHERE name = ?',
      ['Trap Bar Deadlift'],
    )
    expect(row?.m).toBe('abs')
  })

  it('reports an exercise the table says nothing about', async () => {
    const now = Date.now()
    await db.exec(
      'INSERT INTO exercises (name, created_at, updated_at) VALUES (?, ?, ?)',
      ['Sled Push', now, now],
    )
    const result = await seedExerciseMuscles(db)
    expect(result.unmapped).toEqual(['Sled Push'])
  })

  it('is safe to run twice', async () => {
    const first = await seedExerciseMuscles(db)
    const second = await seedExerciseMuscles(db)
    expect(second.withGroup).toBe(first.withGroup)
  })
})

describe('the badge reaches the template rows', () => {
  it('gives every exercise on both days a coloured circle, never "?"', async () => {
    await seedPlanTemplates(db)
    await seedExerciseMuscles(db)

    const templates = await listTemplates(db)
    for (const template of templates) {
      for (const row of await listTemplateExercises(db, template.id)) {
        const badge = muscleBadge(row.primaryMuscle)
        expect(badge.initial, `${row.name} rendered as unknown`).not.toBe('?')
      }
    }
  })

  it('covers Pallof Press, which the plan created rather than imported', async () => {
    await seedPlanTemplates(db)
    await seedExerciseMuscles(db)

    const row = await db.queryOne<{ m: string | null }>(
      'SELECT primary_muscle AS m FROM exercises WHERE name = ?',
      ['Pallof Press'],
    )
    expect(row?.m).toBe('abs')
  })
})
