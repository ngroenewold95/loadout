/**
 * Spike harness for the database layer.
 *
 * The repo tests prove the SQL against better-sqlite3 on the laptop. They
 * cannot prove the three things that only differ on device: that statements
 * route to the right plugin call, that a transaction really holds across
 * async bridge crossings, and that the device's SQLite has the window function
 * `lastPerformance` depends on.
 *
 * Every check cleans up after itself with a hard delete, so running it does not
 * leave `source = 'native'` rows behind - those are the rows that permanently
 * block a re-import.
 *
 * Delete once the logging loop owns the database.
 */
import { useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { getDb } from '../db/open.ts'
import {
  discardSession,
  lastPerformance,
  listSessionSets,
  logSet,
  startSession,
  undoLastSet,
} from '../db/repo.ts'

const MARKER = '__smoke__'

interface Check {
  name: string
  ok: boolean
  detail: string
}

async function runChecks(): Promise<Check[]> {
  const checks: Check[] = []
  const record = async (name: string, fn: () => Promise<string>) => {
    try {
      checks.push({ name, ok: true, detail: await fn() })
    } catch (e) {
      checks.push({ name, ok: false, detail: (e as Error).message })
    }
  }

  const db = await getDb()

  await record('platform', async () => Capacitor.getPlatform())

  await record('migrations', async () => {
    const rows = await db.query<{ idx: number; tag: string }>(
      'SELECT idx, tag FROM __migrations ORDER BY idx',
    )
    if (rows.length === 0) throw new Error('none applied')
    return rows.map((r) => r.tag).join(', ')
  })

  await record('tables', async () => {
    const rows = await db.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'",
    )
    return `${rows[0].n} tables`
  })

  // Everything below hangs off this exercise, so it is created first and
  // deleted last. `lastInsertId` over the bridge is itself under test here.
  let exerciseId = 0
  await record('insert + lastInsertId', async () => {
    const now = Date.now()
    const { lastInsertId } = await db.exec(
      `INSERT INTO exercises (name, default_load_mode, created_at, updated_at)
       VALUES (?, 'assistance', ?, ?)`,
      [`${MARKER} Assisted Chinup`, now, now],
    )
    if (!lastInsertId) throw new Error('no rowid returned')
    exerciseId = lastInsertId
    return `id ${lastInsertId}`
  })

  await record('transaction rollback', async () => {
    await db
      .transaction(async (tx) => {
        await tx.exec('UPDATE exercises SET notes = ? WHERE id = ?', ['dirty', exerciseId])
        throw new Error('deliberate')
      })
      .catch(() => {})
    const row = await db.queryOne<{ notes: string | null }>(
      'SELECT notes FROM exercises WHERE id = ?',
      [exerciseId],
    )
    if (row?.notes != null) throw new Error(`rollback left notes = ${row.notes}`)
    return 'reverted'
  })

  await record('savepoint nesting', async () => {
    await db.transaction(async (tx) => {
      await tx.exec('UPDATE exercises SET notes = ? WHERE id = ?', ['outer', exerciseId])
      await tx
        .transaction(async (inner) => {
          await inner.exec('UPDATE exercises SET notes = ? WHERE id = ?', ['inner', exerciseId])
          throw new Error('deliberate')
        })
        .catch(() => {})
    })
    const row = await db.queryOne<{ notes: string | null }>(
      'SELECT notes FROM exercises WHERE id = ?',
      [exerciseId],
    )
    if (row?.notes !== 'outer') throw new Error(`expected outer, got ${row?.notes}`)
    return 'inner rolled back, outer kept'
  })

  // Two finished sessions, so `lastPerformance` has to pick between them.
  const seeded: number[] = []
  await record('batch insert (one crossing)', async () => {
    const now = Date.now()
    const day = 86_400_000
    for (const [i, date] of ['2026-08-01', '2026-08-06'].entries()) {
      const startedAt = now - (2 - i) * day
      const { lastInsertId: sessionId } = await db.exec(
        `INSERT INTO sessions (name, started_at_utc, ended_at_utc, local_date, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'native', ?, ?)`,
        [`${MARKER} Day ${i + 1}`, startedAt, startedAt + 3_600_000, date, now, now],
      )
      seeded.push(sessionId)
      await db.batch(
        [0, 1].map((n) => ({
          sql: `INSERT INTO sets (session_id, exercise_id, order_index, set_index, performed_at_utc,
                                  weight_kg, reps, load_mode, set_type, source, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'assistance', 'working', 'native', ?, ?)`,
          params: [
            sessionId,
            exerciseId,
            n,
            n,
            startedAt + n * 180_000,
            9.07 + i,
            8 - n,
            now,
            now,
          ],
        })),
      )
    }
    const rows = await db.query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM sets WHERE exercise_id = ?',
      [exerciseId],
    )
    if (rows[0].n !== 4) throw new Error(`expected 4 sets, got ${rows[0].n}`)
    return '4 sets via executeSet'
  })

  // The real risk: DENSE_RANK OVER (PARTITION BY ...) needs SQLite 3.25+.
  await record('lastPerformance (window fn)', async () => {
    const result = await lastPerformance(db, [exerciseId])
    const entry = result.get(exerciseId)
    if (!entry) throw new Error('no previous performance found')
    if (entry.localDate !== '2026-08-06') {
      throw new Error(`picked ${entry.localDate}, expected the newer 2026-08-06`)
    }
    if (entry.sets.length !== 2) throw new Error(`${entry.sets.length} sets, expected 2`)
    return `${entry.localDate}, ${entry.sets.length} sets`
  })

  await record('logSet + undo', async () => {
    const sessionId = await startSession(db, { name: `${MARKER} live` })
    seeded.push(sessionId)
    await logSet(db, { sessionId, exerciseId, weightKg: 9.07, reps: 8 })
    const second = await logSet(db, { sessionId, exerciseId, weightKg: 9.07, reps: 6 })

    const undone = await undoLastSet(db, sessionId)
    if (undone !== second) throw new Error(`undo removed ${undone}, expected ${second}`)

    // Position must be reused, not skipped.
    await logSet(db, { sessionId, exerciseId, weightKg: 9.07, reps: 7 })
    const sets = await listSessionSets(db, sessionId)
    const shape = sets.map((s) => `${s.orderIndex}/${s.setIndex}:${s.reps}`).join(' ')
    if (shape !== '0/0:8 1/1:7') throw new Error(`positions were ${shape}`)

    // Inherited from the exercise, never assumed 'total'.
    if (sets[0].loadMode !== 'assistance') {
      throw new Error(`load_mode was ${sets[0].loadMode}`)
    }
    await discardSession(db, sessionId)
    return shape
  })

  await record('cleanup', async () => {
    // Hard delete: soft-deleted native rows would still block a re-import.
    await db.batch([
      { sql: 'DELETE FROM sets WHERE exercise_id = ?', params: [exerciseId] },
      { sql: 'DELETE FROM sessions WHERE name LIKE ?', params: [`${MARKER}%`] },
      { sql: 'DELETE FROM exercises WHERE id = ?', params: [exerciseId] },
    ])
    // Scoped to this run's marker, NOT to an empty database - the device now
    // carries the imported history, and asserting emptiness would both fail
    // here and imply this panel is entitled to delete real workouts.
    const rows = await db.query<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM exercises WHERE name LIKE ?)
            + (SELECT COUNT(*) FROM sessions WHERE name LIKE ?) AS n`,
      [`${MARKER}%`, `${MARKER}%`],
    )
    if (rows[0].n !== 0) throw new Error(`${rows[0].n} smoke row(s) left behind`)
    return 'smoke rows removed'
  })

  await record('imported history intact', async () => {
    const rows = await db.query<{ sets: number; sessions: number; exercises: number }>(
      `SELECT (SELECT COUNT(*) FROM sets) AS sets,
              (SELECT COUNT(*) FROM sessions) AS sessions,
              (SELECT COUNT(*) FROM exercises) AS exercises`,
    )
    const { sets, sessions, exercises } = rows[0]
    return `${sets} sets, ${sessions} sessions, ${exercises} exercises`
  })

  return checks
}

export function DbSmoke() {
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    setChecks(null)
    try {
      setChecks(await runChecks())
    } catch (e) {
      setChecks([{ name: 'fatal', ok: false, detail: (e as Error).message }])
    } finally {
      setBusy(false)
    }
  }

  const failed = checks?.filter((c) => !c.ok).length ?? 0

  return (
    <div className="flex flex-col gap-3">
      <button
        className="rounded-xl bg-neutral-800 px-4 py-4 text-base font-medium active:bg-neutral-700 disabled:opacity-50"
        onClick={run}
        disabled={busy}
      >
        {busy ? 'running…' : 'Run database checks'}
      </button>

      {checks && (
        <div className="rounded-xl bg-neutral-900 p-3 text-xs leading-5">
          <p className={failed === 0 ? 'text-emerald-400' : 'text-red-400'}>
            {failed === 0 ? `all ${checks.length} checks passed` : `${failed} FAILED`}
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {checks.map((c) => (
              <li key={c.name} className="flex gap-2 wrap-break-word">
                <span className={c.ok ? 'text-emerald-400' : 'text-red-400'}>
                  {c.ok ? 'ok' : 'FAIL'}
                </span>
                <span className="text-neutral-300">{c.name}</span>
                <span className="text-neutral-500">{c.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
