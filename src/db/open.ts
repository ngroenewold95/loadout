/**
 * The app's single database handle.
 *
 * Migrations run once, before the first query, and every caller awaits the same
 * promise. Opening twice would give two connections to one file and make the
 * transaction serialisation in `driver.ts` a lie.
 */
import { openCapacitorDb } from './capacitor.ts'
import { bundledMigrations } from './migrationFiles.ts'
import { applyMigrations } from './migrations.ts'
import type { Db } from './driver.ts'

let handle: Promise<Db> | null = null

export function getDb(): Promise<Db> {
  handle ??= (async () => {
    const db = await openCapacitorDb()
    const applied = await applyMigrations(db, bundledMigrations(), (m) =>
      console.info(`[db] ${m}`),
    )
    if (applied > 0) console.info(`[db] applied ${applied} migration(s)`)
    return db
  })()
  return handle
}
