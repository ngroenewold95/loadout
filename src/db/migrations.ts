/**
 * Migration application, shared by Node and device.
 *
 * Deliberately does NOT use `drizzle-orm`'s migrator: that imports `node:fs`
 * and cannot run in a WebView. drizzle-kit generates the SQL; this applies it.
 *
 * The `__migrations` table is ours. Do not also enable drizzle's
 * `__drizzle_migrations` — two systems each believing they own the schema is
 * the quiet failure mode.
 */

export interface MigrationFile {
  /** Numeric prefix, e.g. 0 for `0000_init.sql`. Defines apply order. */
  index: number
  tag: string
  statements: string[]
}

/** Minimal executor so this works over better-sqlite3 and the Capacitor bridge. */
export interface Executor {
  exec(sql: string): Promise<void>
  all<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>
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

export async function appliedMigrations(db: Executor): Promise<Set<number>> {
  await db.exec(CREATE_MIGRATIONS_TABLE)
  const rows = await db.all<{ idx: number }>('SELECT idx FROM __migrations')
  return new Set(rows.map((r) => r.idx))
}

/**
 * Apply every migration not yet recorded, in index order.
 *
 * Each migration runs inside a transaction so a failure part-way leaves the
 * database on the previous version rather than half-upgraded. The caller is
 * responsible for taking a file-level backup first — see `backupBeforeMigrate`
 * in the Node runner, and the plugin's native copy on device.
 */
export async function applyMigrations(
  db: Executor,
  files: MigrationFile[],
  log: (msg: string) => void = () => {},
): Promise<number> {
  const done = await appliedMigrations(db)
  const pending = files
    .filter((f) => !done.has(f.index))
    .sort((a, b) => a.index - b.index)

  if (pending.length === 0) {
    log('schema up to date')
    return 0
  }

  for (const file of pending) {
    log(`applying ${file.tag} (${file.statements.length} statements)`)
    await db.exec('BEGIN')
    try {
      for (const stmt of file.statements) await db.exec(stmt)
      await db.exec(
        `INSERT INTO __migrations (idx, tag, applied_at) VALUES (${file.index}, '${file.tag.replace(/'/g, "''")}', ${Date.now()})`,
      )
      await db.exec('COMMIT')
    } catch (err) {
      await db.exec('ROLLBACK')
      throw new Error(`migration ${file.tag} failed: ${(err as Error).message}`, {
        cause: err,
      })
    }
  }

  return pending.length
}
