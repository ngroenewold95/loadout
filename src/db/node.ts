/**
 * better-sqlite3 backend - laptop only.
 *
 * Used by the import, the migration runner and every test. It never ships: the
 * device gets `capacitor.ts`. Keeping the import script and the tests on the
 * *same* `Db` interface as the phone is what makes the repo layer provable
 * without a phone attached.
 *
 * better-sqlite3 is synchronous, so the async signatures here are pure
 * adaptation. That is fine - it means the shared locking and savepoint logic in
 * `driver.ts` is exercised by the tests exactly as it will run on device.
 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createDb, type Db, type DbCore, type SqlValue } from './driver.ts'

export interface NodeDb extends Db {
  /** The synchronous handle, for Node-only bulk work (the import). App code
   *  must never reach for this - it does not exist on the device. */
  raw: Database.Database
}

const IN_MEMORY = ':memory:'

function core(raw: Database.Database): DbCore {
  const run = (sql: string, params: SqlValue[]) => {
    const info = raw.prepare(sql).run(...params)
    return {
      changes: info.changes,
      lastInsertId: Number(info.lastInsertRowid),
    }
  }

  return {
    query: async <T>(sql: string, params: SqlValue[]) =>
      raw.prepare(sql).all(...params) as T[],
    exec: async (sql, params) => run(sql, params),
    batch: async (statements) => {
      // Synchronous here, so a plain loop already costs one round trip. The
      // transaction is what matters: a half-applied batch is the failure this
      // shares with the bridge implementation.
      raw.transaction(() => {
        for (const s of statements) run(s.sql, s.params ?? [])
      })()
    },
    close: async () => {
      raw.close()
    },
  }
}

export function openNodeDb(path: string): NodeDb {
  if (path !== IN_MEMORY) mkdirSync(dirname(path), { recursive: true })

  const raw = new Database(path)
  // WAL is a no-op in memory; harmless to ask for.
  raw.pragma('journal_mode = WAL')
  raw.pragma('foreign_keys = ON')

  return Object.assign(createDb(core(raw)), { raw })
}
