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
import { runSeeders } from './seed.ts'
import { exportOncePerDay } from '../native/backup.ts'
import type { Db } from './driver.ts'

let handle: Promise<Db> | null = null

/**
 * The live database's path, once it is known.
 *
 * Kept here rather than re-asked because the plugin is the only thing that
 * knows it and the export needs it every time. Null on the web, where there is
 * no file at all.
 */
let databaseUrl: string | null = null

/** Where the database file is, or null before it has been opened, or on web. */
export function currentDatabaseUrl(): string | null {
  return databaseUrl
}

export function getDb(): Promise<Db> {
  handle ??= (async () => {
    const { db, url } = await openCapacitorDb()
    databaseUrl = url ?? null
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

    // Unconditional, because every seeder only fills blanks. This is how
    // metadata reaches a device that has stopped being re-imported.
    const seeded = await runSeeders(db)
    console.info(
      `[db] seeded: ${seeded.withGroup} with a group, ${seeded.withGuidance} with guidance, ` +
        `${seeded.withLoading} with a loading, ${seeded.withBase} with a base, ` +
        `${seeded.plates} plate sizes`,
    )
    if (seeded.unmapped.length > 0) {
      console.info(`[db] unmapped exercises: ${seeded.unmapped.join(', ')}`)
    }

    // A copy into the folder the user chose, at most once a day. Fire and
    // forget: app-private storage does not survive uninstall, which is the
    // threat, but an export that fails is not a reason to refuse to open.
    void exportOncePerDay(db, url ?? null)
      .then((done) => {
        if (done) console.info(`[db] exported ${done.name} (${done.bytes} bytes)`)
      })
      .catch((e: unknown) => console.warn('[db] export failed', e))

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
        // The fabricated exercises did not exist when the seeders ran a moment
        // ago, so they would otherwise have no group and no guidance until the
        // second launch. Cheap, and blanks-only like everything in there.
        await runSeeders(db)
      }
    }

    return db
  })()
  return handle
}
