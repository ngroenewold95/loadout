/**
 * Repo tests run against the real schema on better-sqlite3 in memory.
 *
 * Not a mock: the migrations under test are the ones that ship, so the STRICT
 * tables and CHECK constraints are live and a query that would fail on the
 * phone fails here too. The only thing these cannot prove is the bridge.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openNodeDb, type NodeDb } from './node.ts'
import { applyMigrations } from './migrations.ts'
import { loadMigrations } from '../../scripts/migrate.ts'
import {
  activeSession,
  addSessionExercise,
  discardSession,
  addTemplateExercise,
  removeTemplateExercise,
  replaceTemplateExercise,
  reorderTemplateExercises,
  setExercisePlan,
  sessionPlan,
  templatePlan,
  exerciseDetail,
  exerciseHistory,
  exerciseSessionsFor,
  exerciseStats,
  removeSessionExercise,
  reorderSessionExercises,
  replaceSessionExercise,
  endSession,
  deleteSet,
  historyStats,
  recentPerformance,
  setsByMuscle,
  setsByMuscleDay,
  updateSet,
  listSessionExercises,
  listSessionHistory,
  listSessionSets,
  listTemplates,
  listTemplateExercises,
  localDateOf,
  logSet,
  nextTemplate,
  prefillFor,
  previousSessionTotals,
  searchExercises,
  sessionById,
  sessionVolumes,
  setPlannedSets,
  setSessionNotes,
  startSession,
  undoLastSet,
} from './repo.ts'
import { sessionTotals } from '../logic/session.ts'

const MIGRATIONS = loadMigrations()

let db: NodeDb

async function seedExercise(
  name: string,
  opts: { loadMode?: string; restS?: number; base?: number } = {},
): Promise<number> {
  const now = Date.now()
  const { lastInsertId } = await db.exec(
    `INSERT INTO exercises (name, default_load_mode, default_rest_s, default_base_weight_kg, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, opts.loadMode ?? 'total', opts.restS ?? null, opts.base ?? null, now, now],
  )
  return lastInsertId
}

/** A finished session in the past, with its sets, bypassing the active-session guard. */
async function seedHistory(
  exerciseId: number,
  localDate: string,
  sets: {
    weightKg: number | null
    reps: number | null
    loadMode?: string
    setType?: string
  }[],
  name = 'Day 1',
): Promise<number> {
  const startedAt = Date.parse(`${localDate}T17:00:00Z`)
  const now = Date.now()
  const { lastInsertId: sessionId } = await db.exec(
    `INSERT INTO sessions (name, started_at_utc, ended_at_utc, local_date, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'native', ?, ?)`,
    [name, startedAt, startedAt + 3_600_000, localDate, now, now],
  )
  for (const [i, s] of sets.entries()) {
    await db.exec(
      `INSERT INTO sets (session_id, exercise_id, order_index, set_index, performed_at_utc,
                         weight_kg, reps, load_mode, set_type, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'native', ?, ?)`,
      [
        sessionId,
        exerciseId,
        i,
        i,
        startedAt + i * 180_000,
        s.weightKg,
        s.reps,
        s.loadMode ?? 'total',
        s.setType ?? 'working',
        now,
        now,
      ],
    )
  }
  return sessionId
}

beforeEach(async () => {
  db = openNodeDb(':memory:')
  await applyMigrations(db, MIGRATIONS)
})

afterEach(async () => {
  await db.close()
})

describe('migrations', () => {
  it('applies once and is idempotent', async () => {
    const again = await applyMigrations(db, MIGRATIONS)
    expect(again).toBe(0)
    const rows = await db.query<{ idx: number }>('SELECT idx FROM __migrations')
    expect(rows.map((r) => r.idx)).toEqual(MIGRATIONS.map((m) => m.index))
  })

  it('created the tables the repo queries', async () => {
    const names = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    expect(names.map((n) => n.name)).toEqual(
      expect.arrayContaining(['exercises', 'sessions', 'sets', 'templates', 'template_exercises']),
    )
  })
})

describe('transactions', () => {
  it('rolls the whole thing back on throw', async () => {
    const id = await seedExercise('Squat')
    await expect(
      db.transaction(async (tx) => {
        await tx.exec('UPDATE exercises SET name = ? WHERE id = ?', ['Changed', id])
        throw new Error('nope')
      }),
    ).rejects.toThrow('nope')

    const row = await db.queryOne<{ name: string }>(
      'SELECT name FROM exercises WHERE id = ?',
      [id],
    )
    expect(row?.name).toBe('Squat')
  })

  it('nests via savepoints - inner rollback leaves outer work intact', async () => {
    const id = await seedExercise('Squat')
    await db.transaction(async (tx) => {
      await tx.exec('UPDATE exercises SET notes = ? WHERE id = ?', ['outer', id])
      await expect(
        tx.transaction(async (inner) => {
          await inner.exec('UPDATE exercises SET notes = ? WHERE id = ?', ['inner', id])
          throw new Error('inner fails')
        }),
      ).rejects.toThrow('inner fails')
    })

    const row = await db.queryOne<{ notes: string }>(
      'SELECT notes FROM exercises WHERE id = ?',
      [id],
    )
    expect(row?.notes).toBe('outer')
  })

  it('serialises callers that arrive during a transaction', async () => {
    const id = await seedExercise('Squat')
    const order: string[] = []

    const tx = db.transaction(async (t) => {
      order.push('tx-start')
      await t.exec('UPDATE exercises SET notes = ? WHERE id = ?', ['tx', id])
      order.push('tx-end')
    })
    // Queued behind the transaction, not interleaved into it.
    const read = db.queryOne<{ notes: string }>(
      'SELECT notes FROM exercises WHERE id = ?',
      [id],
    ).then((r) => {
      order.push('read')
      return r
    })

    await tx
    expect((await read)?.notes).toBe('tx')
    expect(order).toEqual(['tx-start', 'tx-end', 'read'])
  })
})

describe('sessions', () => {
  it('starts, resumes and ends', async () => {
    expect(await activeSession(db)).toBeNull()

    const id = await startSession(db, { name: 'Day 1' })
    const open = await activeSession(db)
    expect(open?.id).toBe(id)
    expect(open?.name).toBe('Day 1')
    expect(open?.localDate).toBe(localDateOf())

    await endSession(db, id)
    expect(await activeSession(db)).toBeNull()
  })

  it('refuses a second session while one is in progress', async () => {
    await startSession(db, { name: 'Day 1' })
    await expect(startSession(db, { name: 'Day 2' })).rejects.toThrow('still in progress')
  })

  it('writes and clears the workout note, storing blank as null', async () => {
    const id = await startSession(db, { name: 'Day 1' })

    await setSessionNotes(db, id, '  shoulder felt fine  ')
    expect((await sessionById(db, id))?.notes).toBe('shoulder felt fine')

    // A note nobody typed and a note somebody cleared are the same thing.
    await setSessionNotes(db, id, '   ')
    expect((await sessionById(db, id))?.notes).toBeNull()
  })

  it('discards a session and its sets together', async () => {
    const ex = await seedExercise('Squat')
    const id = await startSession(db)
    await logSet(db, { sessionId: id, exerciseId: ex, weightKg: 100, reps: 5 })

    await discardSession(db, id)

    expect(await activeSession(db)).toBeNull()
    expect(await listSessionSets(db, id)).toEqual([])
    // Soft, not hard - the rows are still there to recover.
    const kept = await db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM sets')
    expect(kept?.n).toBe(1)
  })
})

describe('logSet', () => {
  it('numbers order_index by session and set_index by exercise', async () => {
    const squat = await seedExercise('Squat')
    const bench = await seedExercise('Bench Press')
    const session = await startSession(db)

    await logSet(db, { sessionId: session, exerciseId: squat, weightKg: 100, reps: 5 })
    await logSet(db, { sessionId: session, exerciseId: bench, weightKg: 60, reps: 8 })
    await logSet(db, { sessionId: session, exerciseId: squat, weightKg: 100, reps: 5 })

    const sets = await listSessionSets(db, session)
    expect(sets.map((s) => [s.exerciseName, s.orderIndex, s.setIndex])).toEqual([
      ['Squat', 0, 0],
      ['Bench Press', 1, 0],
      ['Squat', 2, 1],
    ])
  })

  it('reuses the position freed by an undo', async () => {
    const squat = await seedExercise('Squat')
    const session = await startSession(db)

    await logSet(db, { sessionId: session, exerciseId: squat, weightKg: 100, reps: 5 })
    const second = await logSet(db, { sessionId: session, exerciseId: squat, weightKg: 100, reps: 4 })

    expect(await undoLastSet(db, session)).toBe(second)
    await logSet(db, { sessionId: session, exerciseId: squat, weightKg: 100, reps: 6 })

    const sets = await listSessionSets(db, session)
    expect(sets.map((s) => [s.orderIndex, s.setIndex, s.reps])).toEqual([
      [0, 0, 5],
      [1, 1, 6],
    ])
  })

  it('returns null undoing an empty session', async () => {
    const session = await startSession(db)
    expect(await undoLastSet(db, session)).toBeNull()
  })

  /**
   * The assistance rule from the import: a higher number is an EASIER set.
   * If a natively-logged set fell back to 'total', PR detection would read that
   * exercise backwards from cutover onwards.
   */
  it('inherits the exercise default load mode rather than assuming total', async () => {
    const assisted = await seedExercise('Assisted Chinup', { loadMode: 'assistance' })
    const session = await startSession(db)
    await logSet(db, { sessionId: session, exerciseId: assisted, weightKg: 20, reps: 8 })

    const [set] = await listSessionSets(db, session)
    expect(set.loadMode).toBe('assistance')
  })

  it('snapshots the exercise base weight at log time', async () => {
    const press = await seedExercise('Machine Chest Press', { base: 20 })
    const session = await startSession(db)
    await logSet(db, { sessionId: session, exerciseId: press, weightKg: 100, reps: 10 })

    // Re-measuring the machine later must not rewrite what was already logged.
    await db.exec('UPDATE exercises SET default_base_weight_kg = 30 WHERE id = ?', [press])

    const [set] = await listSessionSets(db, session)
    expect(set.baseWeightKg).toBe(20)
  })

  it('accepts a reps-only set - 274 imported rows have no weight', async () => {
    const dip = await seedExercise('Chest Dip')
    const session = await startSession(db)
    await logSet(db, { sessionId: session, exerciseId: dip, reps: 12 })

    const [set] = await listSessionSets(db, session)
    expect(set.weightKg).toBeNull()
    expect(set.reps).toBe(12)
  })

  it('rejects a set that records nothing', async () => {
    const dip = await seedExercise('Chest Dip')
    const session = await startSession(db)
    await expect(logSet(db, { sessionId: session, exerciseId: dip })).rejects.toThrow(
      /weight, reps, duration or distance/,
    )
  })
})

/**
 * The previous session only, which is what most of these assertions are about.
 * Ranking is the thing under test; the stacking is covered separately below.
 */
const recent = async (
  handle: NodeDb,
  ids: number[],
  opts: { excludeSessionId?: number } = {},
) =>
  new Map(
    [...(await recentPerformance(handle, ids, opts))].map(([id, list]) => [id, list[0]]),
  )

describe('recentPerformance', () => {
  it('returns the most recent session per exercise, in one query', async () => {
    const squat = await seedExercise('Squat')
    const bench = await seedExercise('Bench Press')

    await seedHistory(squat, '2026-07-01', [{ weightKg: 100, reps: 5 }])
    await seedHistory(squat, '2026-07-15', [
      { weightKg: 105, reps: 5 },
      { weightKg: 105, reps: 4 },
    ])
    await seedHistory(bench, '2026-07-10', [{ weightKg: 60, reps: 8 }])

    const result = await recent(db, [squat, bench])

    expect(result.get(squat)?.localDate).toBe('2026-07-15')
    expect(result.get(squat)?.sets.map((s) => s.reps)).toEqual([5, 4])
    expect(result.get(bench)?.localDate).toBe('2026-07-10')
  })

  it('excludes the session being logged, so today does not shadow last time', async () => {
    const squat = await seedExercise('Squat')
    await seedHistory(squat, '2026-07-15', [{ weightKg: 105, reps: 5 }])

    const today = await startSession(db)
    await logSet(db, { sessionId: today, exerciseId: squat, weightKg: 110, reps: 3 })

    const result = await recent(db, [squat], { excludeSessionId: today })
    expect(result.get(squat)?.localDate).toBe('2026-07-15')
    expect(result.get(squat)?.sets.map((s) => s.weightKg)).toEqual([105])
  })

  it('ignores soft-deleted sets and sessions', async () => {
    const squat = await seedExercise('Squat')
    await seedHistory(squat, '2026-07-01', [{ weightKg: 100, reps: 5 }])
    const discarded = await seedHistory(squat, '2026-07-15', [{ weightKg: 105, reps: 5 }])
    await discardSession(db, discarded)

    const result = await recent(db, [squat])
    expect(result.get(squat)?.localDate).toBe('2026-07-01')
  })

  it('is empty for an exercise never performed, and for no exercises at all', async () => {
    const fresh = await seedExercise('Zercher Squat')
    expect((await recent(db, [fresh])).size).toBe(0)
    expect((await recent(db, [])).size).toBe(0)
  })

  it('stacks several sessions, most recent first', async () => {
    const squat = await seedExercise('Squat')
    await seedHistory(squat, '2026-06-01', [{ weightKg: 95, reps: 5 }])
    await seedHistory(squat, '2026-07-01', [{ weightKg: 100, reps: 5 }])
    await seedHistory(squat, '2026-07-15', [{ weightKg: 105, reps: 5 }])

    const list = (await recentPerformance(db, [squat])).get(squat)
    expect(list?.map((s) => s.localDate)).toEqual(['2026-07-15', '2026-07-01', '2026-06-01'])
  })

  it('keeps each session whole rather than merging their sets', async () => {
    const squat = await seedExercise('Squat')
    await seedHistory(squat, '2026-07-01', [{ weightKg: 100, reps: 5 }])
    await seedHistory(squat, '2026-07-15', [
      { weightKg: 105, reps: 5 },
      { weightKg: 105, reps: 4 },
    ])

    const list = (await recentPerformance(db, [squat])).get(squat)
    expect(list?.map((s) => s.sets.length)).toEqual([2, 1])
    expect(list?.[0].sets.map((s) => s.reps)).toEqual([5, 4])
  })

  it('leaves warm-ups out of the history cards', async () => {
    const squat = await seedExercise('Squat')
    await seedHistory(squat, '2026-07-15', [
      { weightKg: 60, reps: 10, setType: 'warmup' },
      { weightKg: 105, reps: 5 },
      { weightKg: 105, reps: 4 },
    ])

    // The card numbers its rows 1 and 2 and lights the one matching the set
    // about to be done, so a warm-up in there would put every row out of step
    // with today's slots.
    const list = (await recentPerformance(db, [squat])).get(squat)
    expect(list?.[0].sets.map((s) => s.reps)).toEqual([5, 4])
  })

  it('honours the session limit', async () => {
    const squat = await seedExercise('Squat')
    for (const d of ['2026-05-01', '2026-06-01', '2026-07-01', '2026-07-15']) {
      await seedHistory(squat, d, [{ weightKg: 100, reps: 5 }])
    }
    const list = (await recentPerformance(db, [squat], { sessions: 2 })).get(squat)
    expect(list?.map((s) => s.localDate)).toEqual(['2026-07-15', '2026-07-01'])
  })
})

describe('updateSet', () => {
  it('edits a set that is not the last one', async () => {
    const squat = await seedExercise('Squat')
    const session = await startSession(db)
    const first = await logSet(db, {
      sessionId: session,
      exerciseId: squat,
      weightKg: 100,
      reps: 5,
    })
    await logSet(db, { sessionId: session, exerciseId: squat, weightKg: 100, reps: 5 })

    await updateSet(db, first, { weightKg: 102.5, reps: 6 })

    const sets = await listSessionSets(db, session)
    expect(sets.map((s) => [s.weightKg, s.reps])).toEqual([
      [102.5, 6],
      [100, 5],
    ])
  })

  it('clears a field on an explicit null, but leaves absent keys alone', async () => {
    const chinup = await seedExercise('Chinup')
    const session = await startSession(db)
    const id = await logSet(db, {
      sessionId: session,
      exerciseId: chinup,
      weightKg: 10,
      reps: 8,
    })

    // Bodyweight chinups after a weighted set: the weight goes away, reps stay.
    await updateSet(db, id, { weightKg: null })

    const [set] = await listSessionSets(db, session)
    expect(set.weightKg).toBeNull()
    expect(set.reps).toBe(8)
  })

  it('refuses an edit that would leave the set with no payload', async () => {
    const squat = await seedExercise('Squat')
    const session = await startSession(db)
    const id = await logSet(db, {
      sessionId: session,
      exerciseId: squat,
      weightKg: 100,
      reps: 5,
    })

    await expect(updateSet(db, id, { weightKg: null, reps: null })).rejects.toThrow(
      /must record/,
    )
    const [set] = await listSessionSets(db, session)
    expect(set.weightKg).toBe(100)
  })

  it('does nothing for an empty patch, and refuses an unknown set', async () => {
    const squat = await seedExercise('Squat')
    const session = await startSession(db)
    const id = await logSet(db, {
      sessionId: session,
      exerciseId: squat,
      weightKg: 100,
      reps: 5,
    })
    await expect(updateSet(db, id, {})).resolves.toBeUndefined()
    await expect(updateSet(db, 999_999, { reps: 3 })).rejects.toThrow(/not found/)
  })
})

describe('deleteSet', () => {
  it('closes the gap in set_index rather than leaving a hole', async () => {
    const squat = await seedExercise('Squat')
    const session = await startSession(db)
    const ids: number[] = []
    for (const reps of [5, 4, 3]) {
      ids.push(await logSet(db, { sessionId: session, exerciseId: squat, weightKg: 100, reps }))
    }

    expect(await deleteSet(db, ids[1])).toBe(true)

    const sets = await listSessionSets(db, session)
    expect(sets.map((s) => s.reps)).toEqual([5, 3])
    // PROJECT.md: 2,247 of 2,248 imported groups are exactly 0..n-1.
    expect(sets.map((s) => s.setIndex)).toEqual([0, 1])
  })

  it('leaves order_index alone, so superset interleaving survives', async () => {
    const squat = await seedExercise('Squat')
    const press = await seedExercise('Overhead Press')
    const session = await startSession(db)
    const a = await logSet(db, { sessionId: session, exerciseId: squat, weightKg: 100, reps: 5 })
    await logSet(db, { sessionId: session, exerciseId: press, weightKg: 40, reps: 8 })
    await logSet(db, { sessionId: session, exerciseId: squat, weightKg: 100, reps: 4 })

    await deleteSet(db, a)

    const sets = await listSessionSets(db, session)
    // The press stays between where the squats were, which is what order_index
    // is for. A gap in it is meaningless to any reader.
    expect(sets.map((s) => s.exerciseId)).toEqual([press, squat])
    expect(sets.map((s) => s.orderIndex)).toEqual([1, 2])
  })

  it('renumbers only the affected exercise', async () => {
    const squat = await seedExercise('Squat')
    const press = await seedExercise('Overhead Press')
    const session = await startSession(db)
    const s1 = await logSet(db, { sessionId: session, exerciseId: squat, weightKg: 100, reps: 5 })
    await logSet(db, { sessionId: session, exerciseId: squat, weightKg: 100, reps: 4 })
    await logSet(db, { sessionId: session, exerciseId: press, weightKg: 40, reps: 8 })
    await logSet(db, { sessionId: session, exerciseId: press, weightKg: 40, reps: 7 })

    await deleteSet(db, s1)

    const sets = await listSessionSets(db, session)
    const bySet = (id: number) => sets.filter((s) => s.exerciseId === id).map((s) => s.setIndex)
    expect(bySet(squat)).toEqual([0])
    expect(bySet(press)).toEqual([0, 1])
  })

  it('is a soft delete, so source = native still guards re-import', async () => {
    const squat = await seedExercise('Squat')
    const session = await startSession(db)
    const id = await logSet(db, {
      sessionId: session,
      exerciseId: squat,
      weightKg: 100,
      reps: 5,
    })
    await deleteSet(db, id)

    const [row] = await db.query<{ deletedAt: number | null; source: string }>(
      'SELECT deleted_at AS "deletedAt", source FROM sets WHERE id = ?',
      [id],
    )
    expect(row.deletedAt).not.toBeNull()
    expect(row.source).toBe('native')
  })

  it('reports a set that is already gone rather than throwing', async () => {
    expect(await deleteSet(db, 999_999)).toBe(false)
  })

  it('lets the next logged set reuse the freed position', async () => {
    const squat = await seedExercise('Squat')
    const session = await startSession(db)
    const id = await logSet(db, {
      sessionId: session,
      exerciseId: squat,
      weightKg: 100,
      reps: 5,
    })
    await deleteSet(db, id)
    await logSet(db, { sessionId: session, exerciseId: squat, weightKg: 100, reps: 5 })

    const sets = await listSessionSets(db, session)
    expect(sets.map((s) => s.setIndex)).toEqual([0])
  })
})

describe('prefillFor', () => {
  it('repeats the previous set of this session once one exists', async () => {
    const squat = await seedExercise('Squat')
    await seedHistory(squat, '2026-07-15', [{ weightKg: 105, reps: 5 }])
    const previous = (await recent(db, [squat])).get(squat)

    const session = await startSession(db)
    expect(prefillFor([], squat, previous)).toMatchObject({
      weightKg: 105,
      reps: 5,
      source: 'last-session',
    })

    await logSet(db, { sessionId: session, exerciseId: squat, weightKg: 110, reps: 4 })
    const sets = await listSessionSets(db, session)
    expect(prefillFor(sets, squat, previous)).toMatchObject({
      weightKg: 110,
      reps: 4,
      source: 'current-session',
    })
  })

  it('reports "none" rather than guessing for a brand new exercise', () => {
    expect(prefillFor([], 999, undefined).source).toBe('none')
  })

  it('never repeats a warm-up', async () => {
    const squat = await seedExercise('Squat')
    await seedHistory(squat, '2026-07-15', [{ weightKg: 105, reps: 5 }])
    const previous = (await recent(db, [squat])).get(squat)

    const session = await startSession(db)
    const warmup = await logSet(db, {
      sessionId: session,
      exerciseId: squat,
      weightKg: 60,
      reps: 10,
    })
    await updateSet(db, warmup, { setType: 'warmup' })

    // With only a warm-up logged the bar falls back to last session, which is
    // where a first working set has always come from. Opening at 60 would be
    // the one number on the screen certain to be wrong.
    const sets = await listSessionSets(db, session)
    expect(prefillFor(sets, squat, previous)).toMatchObject({
      weightKg: 105,
      reps: 5,
      source: 'last-session',
    })
  })
})

describe('session plan snapshot', () => {
  /** A template with one exercise, and a session started from it. */
  async function seedStarted(targetSets = 2): Promise<{
    sessionId: number
    exerciseId: number
    templateId: number
  }> {
    const exerciseId = await seedExercise('Squat', { restS: 180 })
    const now = Date.now()
    const { lastInsertId: templateId } = await db.exec(
      'INSERT INTO templates (name, order_index, created_at, updated_at) VALUES (?, 0, ?, ?)',
      ['Day 1', now, now],
    )
    await db.exec(
      `INSERT INTO template_exercises (template_id, exercise_id, order_index, target_sets,
                                       target_rep_min, target_rep_max, rest_s, created_at, updated_at)
       VALUES (?, ?, 0, ?, 5, 8, NULL, ?, ?)`,
      [templateId, exerciseId, targetSets, now, now],
    )
    const sessionId = await startSession(db, { templateId, name: 'Day 1' })
    return { sessionId, exerciseId, templateId }
  }

  it('copies the template when the session starts', async () => {
    const { sessionId } = await seedStarted()
    const [row] = await listSessionExercises(db, sessionId)
    expect(row).toMatchObject({
      name: 'Squat',
      targetSets: 2,
      targetRepMin: 5,
      targetRepMax: 8,
      // Resolved through the exercise default, not left as the template's null.
      restS: 180,
    })
  })

  it('raises the target without touching the template', async () => {
    const { sessionId, exerciseId, templateId } = await seedStarted()

    await setPlannedSets(db, sessionId, exerciseId, 3)
    const [session] = await listSessionExercises(db, sessionId)
    expect(session.targetSets).toBe(3)

    // The whole reason this table exists: the programme is unchanged.
    const [template] = await listTemplateExercises(db, templateId)
    expect(template.targetSets).toBe(2)
  })

  it('will not lower the target below the sets already performed', async () => {
    const { sessionId, exerciseId } = await seedStarted()
    await logSet(db, { sessionId, exerciseId, weightKg: 100, reps: 5 })
    await logSet(db, { sessionId, exerciseId, weightKg: 100, reps: 5 })

    // Otherwise the header would read `2/1 sets`. The sets are facts; the
    // target is only the intention.
    const next = await setPlannedSets(db, sessionId, exerciseId, 1)
    expect(next).toBe(2)
    const [row] = await listSessionExercises(db, sessionId)
    expect(row.targetSets).toBe(2)
  })

  it('adds an exercise at the end, with its own rest default', async () => {
    const { sessionId } = await seedStarted()
    const bench = await seedExercise('Bench Press', { restS: 210 })

    await addSessionExercise(db, sessionId, bench)
    const rows = await listSessionExercises(db, sessionId)
    expect(rows.map((r) => r.name)).toEqual(['Squat', 'Bench Press'])
    expect(rows[1].restS).toBe(210)
    // No rep target: nothing decided one, so `setSlots` treats it as open and
    // it can never be wrongly declared complete.
    expect(rows[1].targetRepMin).toBeNull()
  })

  it('removing an exercise keeps the sets already logged against it', async () => {
    const { sessionId, exerciseId } = await seedStarted()
    await logSet(db, { sessionId, exerciseId, weightKg: 100, reps: 5 })

    await removeSessionExercise(db, sessionId, exerciseId)
    expect(await listSessionExercises(db, sessionId)).toEqual([])
    // The set was performed. A plan change is not a reason to lose a fact, and
    // the summary still has to show it.
    expect(await listSessionSets(db, sessionId)).toHaveLength(1)
  })

  it('replace keeps the position and the targets', async () => {
    const { sessionId, exerciseId } = await seedStarted(3)
    const bench = await seedExercise('Bench Press')

    await replaceSessionExercise(db, sessionId, exerciseId, bench)
    const [row] = await listSessionExercises(db, sessionId)
    // The machine was busy, not the plan wrong.
    expect(row).toMatchObject({ name: 'Bench Press', targetSets: 3, targetRepMax: 8 })
  })

  it('reorder renumbers the whole list from zero', async () => {
    const { sessionId, exerciseId } = await seedStarted()
    const bench = await seedExercise('Bench Press')
    const row = await seedExercise('Barbell Row')
    await addSessionExercise(db, sessionId, bench)
    await addSessionExercise(db, sessionId, row)

    await reorderSessionExercises(db, sessionId, [row, exerciseId, bench])
    const rows = await listSessionExercises(db, sessionId)
    expect(rows.map((r) => r.name)).toEqual(['Barbell Row', 'Squat', 'Bench Press'])
    expect(rows.map((r) => r.orderIndex)).toEqual([0, 1, 2])
  })

  it('discarding a session takes its plan with it', async () => {
    const { sessionId } = await seedStarted()
    await discardSession(db, sessionId)
    expect(await listSessionExercises(db, sessionId)).toEqual([])
  })
})

describe('templates and picker', () => {
  it('lists templates with their exercise count and last use', async () => {
    const squat = await seedExercise('Squat', { restS: 180 })
    const now = Date.now()
    const { lastInsertId: templateId } = await db.exec(
      'INSERT INTO templates (name, order_index, created_at, updated_at) VALUES (?, 0, ?, ?)',
      ['Day 1', now, now],
    )
    await db.exec(
      `INSERT INTO template_exercises (template_id, exercise_id, order_index, target_sets,
                                       target_rep_min, target_rep_max, created_at, updated_at)
       VALUES (?, ?, 0, 2, 5, 8, ?, ?)`,
      [templateId, squat, now, now],
    )
    // Imported history carries the name but no template link.
    await seedHistory(squat, '2026-07-15', [{ weightKg: 105, reps: 5 }], 'Day 1')

    const [template] = await listTemplates(db)
    expect(template).toMatchObject({ name: 'Day 1', exerciseCount: 1, lastUsedDate: '2026-07-15' })

    const [exercise] = await listTemplateExercises(db, templateId)
    expect(exercise).toMatchObject({
      name: 'Squat',
      targetSets: 2,
      targetRepMin: 5,
      targetRepMax: 8,
      restS: 180,
    })
  })

  it('does not count a live workout as the last time a template was done', async () => {
    const squat = await seedExercise('Squat')
    const press = await seedExercise('Press')
    const now = Date.now()
    const { lastInsertId: dayA } = await db.exec(
      'INSERT INTO templates (name, order_index, created_at, updated_at) VALUES (?, 0, ?, ?)',
      ['Day 1', now, now],
    )
    const { lastInsertId: dayB } = await db.exec(
      'INSERT INTO templates (name, order_index, created_at, updated_at) VALUES (?, 1, ?, ?)',
      ['Day 2', now, now],
    )
    await addTemplateExercise(db, dayA, squat)
    await addTemplateExercise(db, dayB, press)

    await seedHistory(squat, '2026-07-15', [{ weightKg: 105, reps: 5 }], 'Day 1')
    await seedHistory(press, '2026-07-18', [{ weightKg: 60, reps: 5 }], 'Day 2')

    // Day 1 is up next, and starting it must not change that until it is
    // finished: an unfinished session is not a session that was done.
    expect((await nextTemplate(db))?.name).toBe('Day 1')

    const sessionId = await startSession(db, { templateId: dayA, name: 'Day 1' })
    const [live] = await listTemplates(db)
    expect(live.lastUsedDate).toBe('2026-07-15')
    expect((await nextTemplate(db))?.name).toBe('Day 1')

    await endSession(db, sessionId)
    const [finished] = await listTemplates(db)
    expect(finished.lastUsedDate).toBe(localDateOf())
    expect((await nextTemplate(db))?.name).toBe('Day 2')
  })

  it('rejects a rep range whose max is below its min', async () => {
    const squat = await seedExercise('Squat')
    const now = Date.now()
    const { lastInsertId: templateId } = await db.exec(
      'INSERT INTO templates (name, order_index, created_at, updated_at) VALUES (?, 0, ?, ?)',
      ['Day 1', now, now],
    )
    await expect(
      db.exec(
        `INSERT INTO template_exercises (template_id, exercise_id, order_index,
                                         target_rep_min, target_rep_max, created_at, updated_at)
         VALUES (?, ?, 0, 8, 5, ?, ?)`,
        [templateId, squat, now, now],
      ),
    ).rejects.toThrow(/CHECK constraint/i)
  })

  it('lists finished sessions newest first, with their totals', async () => {
    const squat = await seedExercise('Squat')
    const press = await seedExercise('Press')
    await seedHistory(squat, '2026-07-01', [{ weightKg: 100, reps: 5 }])
    const recent = await seedHistory(squat, '2026-07-15', [
      { weightKg: 100, reps: 5 },
      { weightKg: 100, reps: 5 },
    ])
    await db.exec(
      `INSERT INTO sets (session_id, exercise_id, order_index, set_index,
                         weight_kg, reps, load_mode, set_type, source, created_at, updated_at)
       VALUES (?, ?, 2, 0, 40, 10, 'total', 'working', 'native', ?, ?)`,
      [recent, press, Date.now(), Date.now()],
    )

    const history = await listSessionHistory(db, { limit: 10 })
    expect(history.map((s) => s.localDate)).toEqual(['2026-07-15', '2026-07-01'])
    expect(history[0]).toMatchObject({
      setCount: 3,
      exerciseCount: 2,
      volumeKg: 100 * 5 + 100 * 5 + 40 * 10,
    })

    // Paging is limit/offset, so the second page continues rather than repeats.
    const page2 = await listSessionHistory(db, { limit: 1, offset: 1 })
    expect(page2.map((s) => s.localDate)).toEqual(['2026-07-01'])
  })

  it('keeps the live workout out of its own history', async () => {
    const squat = await seedExercise('Squat')
    const sessionId = await startSession(db, { name: 'Day 1' })
    await logSet(db, { sessionId, exerciseId: squat, weightKg: 100, reps: 5 })

    expect(await listSessionHistory(db, { limit: 10 })).toEqual([])
    await endSession(db, sessionId)
    expect(await listSessionHistory(db, { limit: 10 })).toHaveLength(1)
  })

  /**
   * The rule this pins: volume in SQL and volume in TypeScript must agree.
   *
   * `sessionTotals` is the authority - it is what the summary screen renders and
   * where the assistance argument is written down. The SQL exists only because a
   * list of sessions cannot pull every set across the bridge to reuse it, so the
   * two are held together here rather than by hoping they were written the same.
   */
  it('totals volume in SQL exactly as sessionTotals does', async () => {
    const chinup = await seedExercise('Assisted Chinup', { loadMode: 'assistance' })
    const squat = await seedExercise('Squat')
    const sessionId = await seedHistory(squat, '2026-07-15', [
      { weightKg: 100, reps: 5 },
      // Assistance INVERTS: a higher number is an easier set, so it is excluded
      // from volume rather than added to it.
      { weightKg: 25, reps: 8, loadMode: 'assistance' },
      // A bodyweight set carries no weight at all and contributes nothing.
      { weightKg: null, reps: 12 },
    ])
    await db.exec('UPDATE sets SET exercise_id = ? WHERE load_mode = ?', [
      chinup,
      'assistance',
    ])

    const [row] = await listSessionHistory(db, { limit: 1 })
    const totals = sessionTotals(await listSessionSets(db, sessionId))

    expect(row.volumeKg).toBe(totals.volumeKg)
    expect(row.volumeKg).toBe(500)
    expect(row.setCount).toBe(totals.sets)
  })

  it('leaves warm-ups out of the SQL totals, exactly as sessionTotals does', async () => {
    const squat = await seedExercise('Squat')
    const sessionId = await seedHistory(squat, '2026-07-15', [
      { weightKg: 60, reps: 10, setType: 'warmup' },
      { weightKg: 100, reps: 5 },
      { weightKg: 100, reps: 5 },
    ])

    const [row] = await listSessionHistory(db, { limit: 1 })
    const totals = sessionTotals(await listSessionSets(db, sessionId))

    expect(row.setCount).toBe(totals.sets)
    expect(row.setCount).toBe(2)
    expect(row.volumeKg).toBe(totals.volumeKg)
    expect(row.volumeKg).toBe(1000)
    // Still returned by the read the summary uses: a warm-up happened, it just
    // counts toward nothing.
    expect(await listSessionSets(db, sessionId)).toHaveLength(3)
  })

  /**
   * The one that guards the whole feature.
   *
   * Every one of the 6,209 imported rows carries `set_type = 'unknown'`, so a
   * filter written as `set_type = 'working'` would have dropped five years of
   * history out of every total on the day warm-ups shipped, silently and with
   * no error anywhere.
   */
  it('counts imported rows, which carry set_type unknown', async () => {
    const squat = await seedExercise('Squat')
    await seedHistory(squat, '2026-07-15', [
      { weightKg: 100, reps: 5, setType: 'unknown' },
      { weightKg: 100, reps: 5, setType: 'unknown' },
    ])

    const [row] = await listSessionHistory(db, { limit: 1 })
    expect(row.setCount).toBe(2)
    expect(row.volumeKg).toBe(1000)
  })

  it('reports lifetime totals and cadence from one statement', async () => {
    const squat = await seedExercise('Squat')
    await seedHistory(squat, '2026-06-01', [{ weightKg: 100, reps: 5 }])
    await seedHistory(squat, '2026-07-14', [{ weightKg: 100, reps: 5 }])
    await seedHistory(squat, '2026-07-15', [
      { weightKg: 100, reps: 5 },
      { weightKg: 100, reps: 5 },
    ])

    const stats = await historyStats(db, {
      weekStart: '2026-07-13',
      fourWeeksAgo: '2026-06-18',
    })
    expect(stats).toMatchObject({
      sessions: 3,
      sets: 4,
      volumeKg: 2000,
      thisWeek: 2,
      last28: 2,
      firstDate: '2026-06-01',
      lastDate: '2026-07-15',
    })
    // Each seeded session is an hour long, and the join-free subqueries are what
    // keep this from being multiplied by the number of sets in each.
    expect(stats?.trainedMs).toBe(3 * 3_600_000)
  })

  it('finds the previous performance of the same workout, by template or by name', async () => {
    const squat = await seedExercise('Squat')
    const now = Date.now()
    const { lastInsertId: templateId } = await db.exec(
      'INSERT INTO templates (name, order_index, created_at, updated_at) VALUES (?, 0, ?, ?)',
      ['Day 1', now, now],
    )
    // Imported history: the name only, no template link.
    await seedHistory(squat, '2026-06-01', [{ weightKg: 100, reps: 5 }], 'Day 1')
    const middle = await seedHistory(squat, '2026-07-01', [{ weightKg: 100, reps: 8 }], 'Day 1')
    const latest = await seedHistory(
      squat,
      '2026-07-15',
      [
        { weightKg: 100, reps: 5 },
        { weightKg: 100, reps: 5 },
      ],
      'Day 1',
    )
    await db.exec('UPDATE sessions SET template_id = ? WHERE id = ?', [templateId, latest])
    // A different workout entirely, which must not be the answer.
    await seedHistory(squat, '2026-07-10', [{ weightKg: 200, reps: 5 }], 'Day 2')

    expect(await previousSessionTotals(db, latest)).toEqual({
      sessionId: middle,
      localDate: '2026-07-01',
      sets: 1,
      reps: 8,
      volumeKg: 800,
    })

    // The first performance of a workout has nothing before it, and that is an
    // answer rather than a failure.
    const first = await db.queryOne<{ id: number }>(
      "SELECT id FROM sessions WHERE local_date = '2026-06-01'",
    )
    expect(await previousSessionTotals(db, first!.id)).toBeNull()
  })

  it('reports one volume row per finished session since a date', async () => {
    const squat = await seedExercise('Squat')
    const chinup = await seedExercise('Assisted Chinup', { loadMode: 'assistance' })
    await seedHistory(squat, '2026-06-01', [{ weightKg: 100, reps: 5 }])
    await seedHistory(squat, '2026-07-15', [
      { weightKg: 100, reps: 5 },
      { weightKg: 100, reps: 5 },
    ])
    // Assistance is work but not load, so it counts as a session with no volume
    // - the same rule the tiles and the share text apply.
    await seedHistory(chinup, '2026-07-20', [
      { weightKg: 20, reps: 5, loadMode: 'assistance' },
    ])
    // In progress, so not history yet.
    await startSession(db, { name: 'Day 1' })

    const rows = await sessionVolumes(db, '2026-07-01')
    expect(rows.map((r) => [r.localDate, r.volumeKg, r.setCount])).toEqual([
      ['2026-07-15', 1000, 2],
      ['2026-07-20', 0, 1],
    ])
    // Carries its own id, so a day on the calendar can open its workout.
    expect(rows.every((r) => r.sessionId > 0)).toBe(true)
  })

  it('counts sets per muscle group, keeping the unclassified separate', async () => {
    const squat = await seedExercise('Squat')
    const bike = await seedExercise('Bike')
    await db.exec('UPDATE exercises SET primary_muscle = ? WHERE id = ?', ['legs', squat])
    await seedHistory(squat, '2026-07-15', [
      { weightKg: 100, reps: 5 },
      { weightKg: 100, reps: 5 },
    ])
    await seedHistory(bike, '2026-07-15', [{ weightKg: null, reps: 20 }])

    expect(await setsByMuscle(db, '2026-07-01')).toEqual([
      { muscle: 'legs', sets: 2 },
      { muscle: null, sets: 1 },
    ])
    // The window is a filter, not a suggestion.
    expect(await setsByMuscle(db, '2026-08-01')).toEqual([])
  })

  it('counts sets per muscle per day, keeping the unclassified separate', async () => {
    const squat = await seedExercise('Squat')
    const bike = await seedExercise('Bike')
    await db.exec('UPDATE exercises SET primary_muscle = ? WHERE id = ?', ['legs', squat])
    await seedHistory(squat, '2026-07-15', [
      { weightKg: 100, reps: 5 },
      { weightKg: 100, reps: 5 },
    ])
    await seedHistory(bike, '2026-07-16', [{ weightKg: null, reps: 20 }])

    expect(await setsByMuscleDay(db, '2026-07-01')).toEqual([
      { localDate: '2026-07-15', muscle: 'legs', sets: 2 },
      { localDate: '2026-07-16', muscle: null, sets: 1 },
    ])
  })

  it('orders the picker by most recently performed, then name', async () => {
    const old = await seedExercise('Old Lift')
    const recent = await seedExercise('Recent Lift')
    await seedExercise('Never Done')
    await seedHistory(old, '2026-01-01', [{ weightKg: 50, reps: 5 }])
    await seedHistory(recent, '2026-07-15', [{ weightKg: 50, reps: 5 }])

    const all = await searchExercises(db)
    expect(all.map((e) => e.name)).toEqual(['Recent Lift', 'Old Lift', 'Never Done'])

    const found = await searchExercises(db, 'lift')
    expect(found.map((e) => e.name)).toEqual(['Recent Lift', 'Old Lift'])
  })
})

describe('exercise detail', () => {
  it('pages history by whole sessions, not by rows', async () => {
    const squat = await seedExercise('Squat')
    await seedHistory(squat, '2026-06-01', [
      { weightKg: 100, reps: 5 },
      { weightKg: 100, reps: 5 },
    ])
    await seedHistory(squat, '2026-07-01', [
      { weightKg: 105, reps: 5 },
      { weightKg: 105, reps: 5 },
      { weightKg: 105, reps: 4 },
    ])
    await seedHistory(squat, '2026-08-01', [{ weightKg: 110, reps: 5 }])

    const first = await exerciseHistory(db, squat, { sessions: 2 })
    expect(first.map((s) => s.localDate)).toEqual(['2026-08-01', '2026-07-01'])
    // The middle session has three sets. A row limit would have cut it short.
    expect(first[1].sets).toHaveLength(3)

    const next = await exerciseHistory(db, squat, { sessions: 2, skip: 2 })
    expect(next.map((s) => s.localDate)).toEqual(['2026-06-01'])
  })

  it('leaves out deleted sets and deleted sessions', async () => {
    const squat = await seedExercise('Squat')
    const kept = await seedHistory(squat, '2026-07-01', [
      { weightKg: 100, reps: 5 },
      { weightKg: 100, reps: 5 },
    ])
    const dropped = await seedHistory(squat, '2026-08-01', [{ weightKg: 110, reps: 5 }])
    await db.exec('UPDATE sessions SET deleted_at = ? WHERE id = ?', [Date.now(), dropped])
    await db.exec('UPDATE sets SET deleted_at = ? WHERE session_id = ? AND set_index = 1', [
      Date.now(),
      kept,
    ])

    const history = await exerciseHistory(db, squat, { sessions: 10 })
    expect(history).toHaveLength(1)
    expect(history[0].sets).toHaveLength(1)
  })

  it('inverts best load for an assisted exercise', async () => {
    // A higher number on an Assisted Chinup is an EASIER set, so "best" has to
    // be the least assistance. 115 lb in 2023 down to 20 lb in 2026 is progress.
    const assisted = await seedExercise('Assisted Chinup', { loadMode: 'assistance' })
    await seedHistory(assisted, '2023-01-01', [{ weightKg: 52, reps: 9, loadMode: 'assistance' }])
    await seedHistory(assisted, '2026-01-01', [{ weightKg: 9, reps: 7, loadMode: 'assistance' }])

    const stats = await exerciseStats(db, assisted)
    expect(stats?.bestWeightKg).toBeNull()
    expect(stats?.leastAssistKg).toBe(9)
    // Assistance contributes nothing to volume either, by the same argument.
    expect(stats?.volumeKg).toBe(0)
  })

  it('counts sets and sessions, and spans the whole history', async () => {
    const squat = await seedExercise('Squat')
    await seedHistory(squat, '2021-07-06', [{ weightKg: 60, reps: 5 }])
    await seedHistory(squat, '2026-08-01', [
      { weightKg: 100, reps: 5 },
      { weightKg: 100, reps: 8 },
    ])

    const stats = await exerciseStats(db, squat)
    expect(stats).toMatchObject({
      totalSets: 3,
      sessionCount: 2,
      firstDate: '2021-07-06',
      lastDate: '2026-08-01',
      bestWeightKg: 100,
      bestReps: 8,
    })
    expect(stats?.volumeKg).toBe(60 * 5 + 100 * 5 + 100 * 8)
  })

  it('reads the metadata a detail screen renders, and null guidance is fine', async () => {
    const squat = await seedExercise('Squat', { restS: 180, base: 20 })
    const detail = await exerciseDetail(db, squat)
    expect(detail).toMatchObject({
      name: 'Squat',
      defaultRestS: 180,
      baseWeightKg: 20,
      guidance: null,
    })
    expect(await exerciseDetail(db, squat + 999)).toBeNull()
  })
})

describe('editing a template', () => {
  /** A template with two exercises on it, plus their ids. */
  async function seedTemplate(): Promise<{
    templateId: number
    squat: number
    row: number
  }> {
    const squat = await seedExercise('Squat', { restS: 240 })
    const row = await seedExercise('Machine Row', { restS: 180 })
    const now = Date.now()
    const { lastInsertId: templateId } = await db.exec(
      'INSERT INTO templates (name, order_index, created_at, updated_at) VALUES (?, 0, ?, ?)',
      ['Day A', now, now],
    )
    for (const [order, exerciseId] of [squat, row].entries()) {
      await db.exec(
        `INSERT INTO template_exercises (template_id, exercise_id, order_index, target_sets,
                                         target_rep_min, target_rep_max, created_at, updated_at)
         VALUES (?, ?, ?, 2, 5, 8, ?, ?)`,
        [templateId, exerciseId, order, now, now],
      )
    }
    return { templateId, squat, row }
  }

  it('edits sets, rep range and rest', async () => {
    const { templateId, squat } = await seedTemplate()
    await setExercisePlan(db, templatePlan(templateId), squat, {
      targetSets: 3,
      targetRepMin: 6,
      targetRepMax: 10,
      restS: 180,
    })

    const [row] = await listTemplateExercises(db, templateId)
    expect(row).toMatchObject({
      name: 'Squat',
      targetSets: 3,
      targetRepMin: 6,
      targetRepMax: 10,
      restS: 180,
    })
  })

  it('leaves out what the patch does not mention', async () => {
    // An absent key means leave it alone; an explicit null means clear it.
    const { templateId, squat } = await seedTemplate()
    await setExercisePlan(db, templatePlan(templateId), squat, { restS: 90 })
    const [kept] = await listTemplateExercises(db, templateId)
    expect(kept).toMatchObject({ targetRepMin: 5, targetRepMax: 8, restS: 90 })

    await setExercisePlan(db, templatePlan(templateId), squat, { targetRepMin: null, targetRepMax: null })
    const [cleared] = await listTemplateExercises(db, templateId)
    expect(cleared).toMatchObject({ targetRepMin: null, targetRepMax: null, restS: 90 })
  })

  it('refuses a rep range that ends below where it starts', async () => {
    const { templateId, squat } = await seedTemplate()
    await expect(
      setExercisePlan(db, templatePlan(templateId), squat, { targetRepMin: 8, targetRepMax: 5 }),
    ).rejects.toThrow(/ends below/)
  })

  it('edits a live session through the same function', async () => {
    // The reuse this stage exists for: one editor, one writer, two tables.
    const squat = await seedExercise('Squat')
    const sessionId = await startSession(db, { name: 'Day A' })
    await addSessionExercise(db, sessionId, squat, 2)

    await setExercisePlan(db, sessionPlan(sessionId), squat, { targetRepMin: 5, targetRepMax: 8 })
    const [row] = await listSessionExercises(db, sessionId)
    expect(row).toMatchObject({ targetRepMin: 5, targetRepMax: 8 })
  })

  it('appends, replaces and reorders without touching the other rows', async () => {
    const { templateId, squat, row } = await seedTemplate()
    const press = await seedExercise('Machine Chest Press', { restS: 150 })

    await addTemplateExercise(db, templateId, press)
    let rows = await listTemplateExercises(db, templateId)
    expect(rows.map((r) => r.name)).toEqual(['Squat', 'Machine Row', 'Machine Chest Press'])
    // Inherits the exercise's own rest, and gets no rep target.
    expect(rows[2]).toMatchObject({ restS: 150, targetRepMin: null, targetRepMax: null })

    const curl = await seedExercise('Machine Preacher Curl')
    await replaceTemplateExercise(db, templateId, row, curl)
    rows = await listTemplateExercises(db, templateId)
    expect(rows.map((r) => r.name)).toEqual(['Squat', 'Machine Preacher Curl', 'Machine Chest Press'])
    // Position and targets survive the swap; only the movement changed.
    expect(rows[1]).toMatchObject({ orderIndex: 1, targetSets: 2, targetRepMin: 5 })

    await reorderTemplateExercises(db, templateId, [press, squat, curl])
    rows = await listTemplateExercises(db, templateId)
    expect(rows.map((r) => r.orderIndex)).toEqual([0, 1, 2])
    expect(rows.map((r) => r.name)).toEqual(['Machine Chest Press', 'Squat', 'Machine Preacher Curl'])
  })

  it('removes softly, never hard', async () => {
    const { templateId, squat } = await seedTemplate()
    await removeTemplateExercise(db, templateId, squat)

    expect((await listTemplateExercises(db, templateId)).map((r) => r.name)).toEqual([
      'Machine Row',
    ])
    // The row is still there, which is what makes this reversible and what
    // keeps any later question about what the programme used to say answerable.
    const [raw] = await db.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM template_exercises WHERE template_id = ? AND deleted_at IS NOT NULL',
      [templateId],
    )
    expect(raw.n).toBe(1)
  })

  it('does not move a live session that was started from the template', async () => {
    // The regression this stage is most likely to cause: `session_exercises` is
    // a snapshot, so editing the programme mid-workout must change nothing.
    const { templateId, squat } = await seedTemplate()
    const sessionId = await startSession(db, { templateId, name: 'Day A' })
    const before = await listSessionExercises(db, sessionId)

    await setExercisePlan(db, templatePlan(templateId), squat, { targetSets: 5, restS: 30 })
    await removeTemplateExercise(db, templateId, squat)

    expect(await listSessionExercises(db, sessionId)).toEqual(before)
  })
})

describe('the base weight chain', () => {
  /** A template holding one exercise, so the resolved base can be read back. */
  async function planned(
    name: string,
    columns: string,
    values: string,
  ): Promise<number | null> {
    const now = Date.now()
    const { lastInsertId: exerciseId } = await db.exec(
      `INSERT INTO exercises (name${columns}, created_at, updated_at)
       VALUES (?${values}, ?, ?)`,
      [name, now, now],
    )
    const { lastInsertId: templateId } = await db.exec(
      'INSERT INTO templates (name, order_index, created_at, updated_at) VALUES (?, 0, ?, ?)',
      [`Day for ${name}`, now, now],
    )
    await db.exec(
      `INSERT INTO template_exercises (template_id, exercise_id, order_index, created_at, updated_at)
       VALUES (?, ?, 0, ?, ?)`,
      [templateId, exerciseId, now, now],
    )
    const [row] = await listTemplateExercises(db, templateId)
    return row.baseWeightKg
  }

  const globalBar = async (kg: number) => {
    const now = Date.now()
    await db.exec(
      `INSERT INTO app_settings (id, default_bar_weight_kg, created_at, updated_at)
       VALUES (1, ?, ?, ?)`,
      [kg, now, now],
    )
  }

  it('prefers the exercise over the global bar', async () => {
    await globalBar(20.41)
    // A trap bar is not a barbell's 45 lb, which is the case that made the
    // per-exercise override exist in the first place.
    expect(
      await planned('Trap Bar Deadlift', ", modality, default_base_weight_kg", ", 'barbell', 24.95"),
    ).toBeCloseTo(24.95, 4)
  })

  it('falls back to the global bar only for a barbell', async () => {
    await globalBar(20.41)
    expect(await planned('Barbell Squat', ', modality', ", 'barbell'")).toBeCloseTo(20.41, 4)
    // A plate-loaded sled with no recorded base must show NO base rather than
    // silently claiming a 45 lb bar it does not have.
    expect(await planned('Machine Row', ', modality', ", 'machine'")).toBeNull()
  })

  it('resolves to nothing at all when there is no settings row', async () => {
    expect(await planned('Barbell Squat', ', modality', ", 'barbell'")).toBeNull()
  })

  it('snapshots the resolved base onto the set, not the raw column', async () => {
    // The chip and the stored value have to agree, which is the whole reason
    // the chain is one expression rather than two copies.
    await globalBar(20.41)
    const now = Date.now()
    const { lastInsertId: exerciseId } = await db.exec(
      `INSERT INTO exercises (name, modality, created_at, updated_at)
       VALUES ('Barbell Squat', 'barbell', ?, ?)`,
      [now, now],
    )
    const sessionId = await startSession(db, { name: 'Day A' })
    await logSet(db, { sessionId, exerciseId, weightKg: 100, reps: 5 })

    const [set] = await listSessionSets(db, sessionId)
    expect(set.baseWeightKg).toBeCloseTo(20.41, 4)
  })
})

describe('exerciseSessionsFor', () => {
  it('answers several exercises in one statement, oldest first', async () => {
    const squat = await seedExercise('Squat')
    const press = await seedExercise('Press')
    await seedHistory(squat, '2026-06-01', [{ weightKg: 100, reps: 5 }])
    await seedHistory(squat, '2026-07-01', [
      { weightKg: 105, reps: 5 },
      { weightKg: 105, reps: 4 },
    ])
    await seedHistory(press, '2026-07-01', [{ weightKg: 60, reps: 8 }])

    const byExercise = await exerciseSessionsFor(db, [squat, press])

    // Oldest first, because a chart reads left to right.
    expect(byExercise.get(squat)?.map((r) => [r.localDate, r.bestWeightKg])).toEqual([
      ['2026-06-01', 100],
      ['2026-07-01', 105],
    ])
    expect(byExercise.get(squat)?.[1].setCount).toBe(2)
    expect(byExercise.get(press)?.map((r) => r.localDate)).toEqual(['2026-07-01'])
  })

  it('applies the limit per exercise, not across the result', async () => {
    // The whole reason for the DENSE_RANK partition: a plain LIMIT would spend
    // the allowance on whichever exercise sorted first.
    const squat = await seedExercise('Squat')
    const press = await seedExercise('Press')
    for (const d of ['2026-05-01', '2026-06-01', '2026-07-01']) {
      await seedHistory(squat, d, [{ weightKg: 100, reps: 5 }])
      await seedHistory(press, d, [{ weightKg: 60, reps: 8 }])
    }

    const byExercise = await exerciseSessionsFor(db, [squat, press], 2)
    expect(byExercise.get(squat)?.map((r) => r.localDate)).toEqual([
      '2026-06-01',
      '2026-07-01',
    ])
    expect(byExercise.get(press)).toHaveLength(2)
  })

  it('separates assistance from load, and skips warm-ups', async () => {
    const chinup = await seedExercise('Assisted Chinup', { loadMode: 'assistance' })
    await seedHistory(chinup, '2026-07-01', [
      { weightKg: 40, reps: 10, loadMode: 'assistance', setType: 'warmup' },
      { weightKg: 25, reps: 8, loadMode: 'assistance' },
      { weightKg: 30, reps: 6, loadMode: 'assistance' },
    ])

    const [row] = (await exerciseSessionsFor(db, [chinup])).get(chinup)!
    // Least assistance is the best set, and the 40 kg warm-up is not in it.
    expect(row.leastAssistKg).toBe(25)
    expect(row.bestWeightKg).toBeNull()
    expect(row.setCount).toBe(2)
  })

  it('returns an empty map for no exercises rather than reading anything', async () => {
    expect((await exerciseSessionsFor(db, [])).size).toBe(0)
  })
})
