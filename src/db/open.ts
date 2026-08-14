/**
 * The app's single database handle.
 *
 * Migrations run once, before the first query, and every caller awaits the same
 * promise. Opening twice would give two connections to one file and make the
 * transaction serialisation in `driver.ts` a lie.
 *
 * Nothing migrates on device without a backup first - see `backup.ts` for why
 * that is this file's job rather than the migration runner's.
 */
import { Capacitor } from '@capacitor/core'
import { backupBeforeMigrate } from './backup.ts'
import { openCapacitorDb } from './capacitor.ts'
import { bundledMigrations } from './migrationFiles.ts'
import { applyMigrations, pendingMigrations } from './migrations.ts'
import type { Db } from './driver.ts'

let handle: Promise<Db> | null = null

export function getDb(): Promise<Db> {
  handle ??= (async () => {
    const { db, url } = await openCapacitorDb()
    const files = bundledMigrations()
    const pending = await pendingMigrations(db, files)

    // Web runs jeep-sqlite against a throwaway IndexedDB store with no file to
    // copy, and nothing there is worth protecting.
    if (pending.length > 0 && Capacitor.getPlatform() !== 'web') {
      if (!url) {
        // Fail closed. A half-applied migration over the only copy of five
        // years of history is worse than an app that will not open, and
        // `PROJECT.md` records that cutover is one-way.
        throw new Error(
          'refusing to migrate: the database path is unavailable, so no backup ' +
            'can be taken. Re-push db/for-device.sqlite rather than forcing this.',
        )
      }
      const target = await backupBeforeMigrate(db, url, pending[0].index)
      console.info(`[db] backed up to ${target} before ${pending.length} migration(s)`)
    }

    const applied = await applyMigrations(db, files, (m) => console.info(`[db] ${m}`))
    if (applied > 0) console.info(`[db] applied ${applied} migration(s)`)

    // Browser dev only, and - inside `seedDevData` - only into an empty
    // database. The phone's history is real and is pushed from an import;
    // nothing here may ever reach it.
    //
    // The guard is written out here rather than imported from `devSeed.ts`
    // because importing anything from that module statically would defeat the
    // dynamic import below, which is what keeps the fabricated history and the
    // plan it is built from in a chunk the device never loads. The bundler says
    // so out loud: INEFFECTIVE_DYNAMIC_IMPORT.
    if (Capacitor.getPlatform() === 'web' && import.meta.env.DEV) {
      const { seedDevData } = await import('./devSeed.ts')
      const seeded = await seedDevData(db)
      if (seeded) {
        console.info(
          `[db] dev seed: ${seeded.sessions} fabricated sessions, ${seeded.sets} sets`,
        )
      }
    }

    return db
  })()
  return handle
}
