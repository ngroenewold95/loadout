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
  removeSessionExercise,
  reorderSessionExercises,
  replaceSessionExercise,
  endSession,
  deleteSet,
  historyStats,
  recentPerformance,
  setsByMuscle,
  updateSet,
  listSessionExercises,
  listSessionHistory,
  listSessionSets,
  listTemplates,
  listTemplateExercises,
  localDateOf,
  logSet,
  prefillFor,
  searchExercises,
  setPlannedSets,
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
  sets: { weightKg: number | null; reps: number | null; loadMode?: string }[],
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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'working', 'native', ?, ?)`,
      [
        sessionId,
        exerciseId,
        i,
        i,
        startedAt + i * 180_000,
        s.weightKg,
        s.reps,
        s.loadMode ?? 'total',
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
