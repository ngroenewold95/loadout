/**
 * Migration application, shared by Node and device.
 *
 * Deliberately does NOT use `drizzle-orm`'s migrator: that imports `node:fs`
 * and cannot run in a WebView. drizzle-kit generates the SQL; this applies it.
 *
 * The `__migrations` table is ours. Do not also enable drizzle's
 * `__drizzle_migrations` - two systems each believing they own the schema is
 * the quiet failure mode.
 */

import type { Db } from './driver.ts'

export interface MigrationFile {
  /** Numeric prefix, e.g. 0 for `0000_init.sql`. Defines apply order. */
  index: number
  tag: string
  statements: string[]
}

/** drizzle-kit separates statements with this marker. */
export const STATEMENT_BREAKPOINT = '--> statement-breakpoint'

export function splitStatements(sql: string): string[] {
  return sql
    .split(STATEMENT_BREAKPOINT)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

const CREATE_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS __migrations (
  idx INTEGER PRIMARY KEY,
  tag TEXT NOT NULL,
  applied_at INTEGER NOT NULL
) STRICT`

export async function appliedMigrations(db: Db): Promise<Set<number>> {
  await db.exec(CREATE_MIGRATIONS_TABLE)
  const rows = await db.query<{ idx: number }>('SELECT idx FROM __migrations')
  return new Set(rows.map((r) => r.idx))
}

/** Migrations not yet recorded, in apply order. */
export async function pendingMigrations(
  db: Db,
  files: MigrationFile[],
): Promise<MigrationFile[]> {
  const done = await appliedMigrations(db)
  return files.filter((f) => !done.has(f.index)).sort((a, b) => a.index - b.index)
}

/**
 * Apply every migration not yet recorded, in index order.
 *
 * Each migration runs inside a transaction so a failure part-way leaves the
 * database on the previous version rather than half-upgraded.
 *
 * **The caller takes the file-level backup**, because only the caller knows
 * where the file is: `scripts/migrate.ts` copies it on the laptop, and
 * `open.ts` calls `backupBeforeMigrate` on device. An earlier comment here
 * claimed the plugin made a native copy on device - it does not, and
 * `PROJECT.md` records that correction.
 */
export async function applyMigrations(
  db: Db,
  files: MigrationFile[],
  log: (msg: string) => void = () => {},
): Promise<number> {
  const pending = await pendingMigrations(db, files)

  if (pending.length === 0) {
    log('schema up to date')
    return 0
  }

  // Foreign keys OFF for the duration, and it MUST be set out here, outside any
  // transaction. This is SQLite's documented procedure for rebuilding a table,
  // and every part of it is load-bearing:
  //
  //  - drizzle-kit already emits `PRAGMA foreign_keys=OFF` inside the migration,
  //    but `PROJECT.md` records that the pragma is a **no-op inside a
  //    transaction**, which is exactly where we run the statements. Harmless
  //    while only `template_exercises` was rebuilt, since nothing references it.
  //    It stops being harmless the moment a PARENT is rebuilt: 0004 rebuilds
  //    `exercises`, and `DROP TABLE exercises` with rows in `sets`,
  //    `template_exercises` and `exercise_aliases` fails outright.
  //  - `defer_foreign_keys` does NOT rescue it. Measured: the pragma reads back
  //    as 1 and the DROP still fails with SQLITE_CONSTRAINT_FOREIGNKEY, because
  //    the implicit DELETE a DROP performs is checked immediately regardless.
  //    An earlier fix here assumed otherwise and did not work.
  //
  // Turning enforcement off does not mean giving up the guarantee: each
  // migration re-checks the whole database with `foreign_key_check` before it
  // commits, so a migration that genuinely orphans a row still fails and rolls
  // back. Verified in `migrations.test.ts`, in both directions.
  await db.exec('PRAGMA foreign_keys = OFF')
  try {
    for (const file of pending) {
      log(`applying ${file.tag} (${file.statements.length} statements)`)
      try {
        await db.transaction(async (tx) => {
          for (const stmt of file.statements) await tx.exec(stmt)

          const violations = await tx.query('PRAGMA foreign_key_check')
          if (violations.length > 0) {
            throw new Error(
              `left ${violations.length} orphaned row(s) behind: ` +
                JSON.stringify(violations.slice(0, 5)),
            )
          }

          await tx.exec(
            'INSERT INTO __migrations (idx, tag, applied_at) VALUES (?, ?, ?)',
            [file.index, file.tag, Date.now()],
          )
        })
      } catch (err) {
        throw new Error(`migration ${file.tag} failed: ${(err as Error).message}`, {
          cause: err,
        })
      }
    }
  } finally {
    // Restored even when a migration threw, so the caller never carries on
    // against an unenforced database.
    await db.exec('PRAGMA foreign_keys = ON')
  }

  return pending.length
}
