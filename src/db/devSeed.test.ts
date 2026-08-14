/**
 * The dev seed's job is to make the screens that read the past render something,
 * so the tests check exactly that: history the prefill chain can use, and a
 * guard that stops it running twice or running anywhere but a browser.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openNodeDb, type NodeDb } from './node.ts'
import { applyMigrations } from './migrations.ts'
import { loadMigrations } from '../../scripts/migrate.ts'
import { seedDevData } from './devSeed.ts'
import { listTemplates, recentPerformance, RECENT_SESSIONS, prefillFor } from './repo.ts'
import { PLAN, NEW_EXERCISES } from '../logic/plan.ts'

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

describe('seedDevData', () => {
  it('seeds templates and history into an empty database', async () => {
    const result = await seedDevData(db)
    expect(result).not.toBeNull()

    const templates = await listTemplates(db)
    expect(templates.map((t) => t.name)).toEqual(PLAN.map((d) => d.name))
    // Every template reads as performed, which is what Home shows.
    expect(templates.every((t) => t.lastUsedDate != null)).toBe(true)
  })

  it('gives every planned exercise enough history to fill the cards', async () => {
    await seedDevData(db)

    const ids = await db.query<{ id: number }>(
      'SELECT id FROM exercises WHERE deleted_at IS NULL',
    )
    const history = await recentPerformance(
      db,
      ids.map((r) => r.id),
    )

    for (const day of PLAN) {
      for (const planned of day.exercises) {
        const row = await db.queryOne<{ id: number }>(
          'SELECT id FROM exercises WHERE name = ? AND deleted_at IS NULL',
          [planned.exercise],
        )
        const sessions = history.get(row!.id) ?? []
        // The logging screen stacks RECENT_SESSIONS cards; a seed that only
        // filled one would leave the stage 7 work untestable in a browser.
        expect(sessions.length).toBe(RECENT_SESSIONS)
        expect(sessions[0].sets.length).toBe(planned.sets)
      }
    }
  })

  it('prefills from the most recent session, which is the heaviest', async () => {
    await seedDevData(db)
    const row = await db.queryOne<{ id: number }>(
      'SELECT id FROM exercises WHERE name = ? AND deleted_at IS NULL',
      ['Trap Bar Deadlift'],
    )
    const history = await recentPerformance(db, [row!.id])
    const sessions = history.get(row!.id)!

    const fill = prefillFor([], row!.id, sessions[0])
    expect(fill.source).toBe('last-session')
    expect(fill.weightKg).not.toBeNull()
    // Load climbs toward the present, so the newest session is the top one.
    expect(fill.weightKg!).toBeGreaterThan(sessions[1].sets[0].weightKg!)
  })

  it('refuses to run twice', async () => {
    expect(await seedDevData(db)).not.toBeNull()
    // A reload must not stack a second run of fabricated sessions on the first.
    expect(await seedDevData(db)).toBeNull()
  })
})
