/**
 * The launch seeders, against the real schema.
 *
 * What these exist to prove is the property every one of them claims: running
 * twice changes nothing the first run did not, and a value already in the row
 * is never overwritten. `open.ts` calls `runSeeders` unconditionally on every
 * launch, so that claim is load-bearing rather than tidy.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openNodeDb, type NodeDb } from './node.ts'
import { applyMigrations } from './migrations.ts'
import { loadMigrations } from '../../scripts/migrate.ts'
import { runSeeders } from './seed.ts'
import { seedDefaults } from './seedDefaults.ts'
import { seedExerciseEquipment } from './seedExerciseEquipment.ts'
import { getSettings, listPlateInventory } from './repo.ts'
import { fromKg } from '../logic/units.ts'

const MIGRATIONS = loadMigrations()

let db: NodeDb

const addExercise = async (name: string, columns = '', values = '') => {
  const now = Date.now()
  const { lastInsertId } = await db.exec(
    `INSERT INTO exercises (name${columns}, created_at, updated_at)
     VALUES (?${values}, ?, ?)`,
    [name, now, now],
  )
  return lastInsertId
}

beforeEach(async () => {
  db = openNodeDb(':memory:')
  await applyMigrations(db, MIGRATIONS)
})

afterEach(async () => {
  await db.close()
})

describe('runSeeders', () => {
  it('fills blanks and reports totals', async () => {
    await addExercise('Trap Bar Deadlift')
    await addExercise('Cable Crunch')

    const report = await runSeeders(db)
    expect(report.withGroup).toBe(2)
    // Only the programme's own lifts are authored; the cable crunch is one.
    expect(report.withGuidance).toBe(2)
    expect(report.withLoading).toBe(2)
    // The trap bar has a base; a cable stack has none.
    expect(report.withBase).toBe(1)
    expect(report.plates).toBe(6)

    const [row] = await db.query<{
      muscle: string
      loading: string
      modality: string
      base: number
      guidance: string
    }>(
      `SELECT primary_muscle AS muscle, loading, modality,
              default_base_weight_kg AS base, guidance
         FROM exercises WHERE name = 'Trap Bar Deadlift'`,
    )
    expect(row).toMatchObject({ muscle: 'legs', loading: 'plates_per_side', modality: 'barbell' })
    expect(row.guidance.split('\n').length).toBeGreaterThan(1)
    expect(fromKg(row.base, 'lb')).toBeCloseTo(55, 2)
  })

  it('changes nothing on a second run', async () => {
    await addExercise('Trap Bar Deadlift')
    const first = await runSeeders(db)
    const second = await runSeeders(db)
    expect(second).toEqual(first)
    expect(await listPlateInventory(db)).toHaveLength(6)
  })

  it('never overwrites a value that is already there', async () => {
    // The import derives a base for about 30 exercises out of `Set Comment`.
    // Those are measurements and this must not stand on them.
    await addExercise(
      'Trap Bar Deadlift',
      ', primary_muscle, loading, default_base_weight_kg, guidance',
      ", 'back', 'plates_total', 30.0, 'mine'",
    )
    await runSeeders(db)

    const [row] = await db.query<{
      muscle: string
      loading: string
      base: number
      guidance: string
      modality: string
    }>(
      `SELECT primary_muscle AS muscle, loading, default_base_weight_kg AS base,
              guidance, modality
         FROM exercises WHERE name = 'Trap Bar Deadlift'`,
    )
    expect(row).toMatchObject({
      muscle: 'back',
      loading: 'plates_total',
      base: 30,
      guidance: 'mine',
    })
    // The one blank column was still filled, which is the other half of it.
    expect(row.modality).toBe('barbell')
  })

  it('leaves an exercise the tables say nothing about entirely alone', async () => {
    await addExercise('Some Lift Nobody Has Classified')
    const report = await runSeeders(db)
    expect(report.unmapped).toEqual(['Some Lift Nobody Has Classified'])

    const [row] = await db.query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM exercises
        WHERE primary_muscle IS NULL AND loading IS NULL AND guidance IS NULL`,
    )
    expect(row.n).toBe(1)
  })
})

describe('seedDefaults', () => {
  it('writes the settings row and the plates the gym has', async () => {
    await seedDefaults(db)

    const settings = await getSettings(db)
    expect(fromKg(settings!.defaultBarWeightKg!, 'lb')).toBeCloseTo(45, 2)
    expect(fromKg(settings!.weightIncrementKg!, 'lb')).toBeCloseTo(5, 2)
    // Booleans come back as booleans, not as the 0/1 SQLite stores.
    expect(settings!.overlayInBackground).toBe(true)
    expect(settings!.keepScreenOn).toBe(false)

    const plates = await listPlateInventory(db)
    expect(plates.map((p) => Math.round(fromKg(p.kg, 'lb') * 10) / 10)).toEqual([
      45, 35, 25, 10, 5, 2.5,
    ])
    // There is no 20 lb plate, which is the measurement the solver depends on.
    expect(plates.some((p) => Math.abs(fromKg(p.kg, 'lb') - 20) < 0.1)).toBe(false)
  })

  it('does not reset settings that have been changed', async () => {
    await seedDefaults(db)
    await db.exec('UPDATE app_settings SET keep_screen_on = 1 WHERE id = 1')
    await seedDefaults(db)
    expect((await getSettings(db))!.keepScreenOn).toBe(true)
  })
})

describe('seedExerciseEquipment', () => {
  it('states a machine only where a logged set proved how it loads', async () => {
    // `Machine Leg Press` reconciles from its own history; `Machine Row` does
    // not appear in the table at all, and guessing it would be the one thing
    // worse than no chips.
    await addExercise('Machine Leg Press')
    await addExercise('Machine Row')
    await seedExerciseEquipment(db)

    const rows = await db.query<{ name: string; loading: string | null; base: number | null }>(
      `SELECT name, loading, default_base_weight_kg AS base FROM exercises ORDER BY name`,
    )
    expect(rows[0]).toMatchObject({ name: 'Machine Leg Press', loading: 'plates_per_side' })
    expect(fromKg(rows[0].base!, 'lb')).toBeCloseTo(100, 2)
    expect(rows[1]).toMatchObject({ name: 'Machine Row', loading: null, base: null })
  })
})
