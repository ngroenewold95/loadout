/**
 * A file-level copy of the database, taken before migrations apply.
 *
 * `PROJECT.md` records that an earlier version of the plan believed the
 * Capacitor plugin's `addUpgradeStatement` covered this. It does not: we run our
 * own `__migrations` ratchet, so nothing native ever copies the file. Until this
 * existed, `open.ts` applied pending migrations on device with **no safety net
 * at all**, while the Node runner in `scripts/migrate.ts` has always taken a
 * copy first.
 *
 * `VACUUM INTO` rather than a byte copy, for the reason already established in
 * `PROJECT.md`: it writes a compact, fully checkpointed single file, so there is
 * no `-wal` alongside it to forget.
 *
 * **What this does and does not protect.** It protects against a migration that
 * corrupts or half-writes the schema - the threat that matters most now, since
 * migration 0001 already had to be hand-fixed after drizzle-kit emitted broken
 * SQL. It does **not** protect against uninstall, because these copies live in
 * the same app-private directory as the database. The synced-folder export is a
 * separate piece of work.
 */
import type { Db } from './driver.ts'

/** `YYYYMMDD-HHmmss`, UTC so a fixed `Date` gives the same name on any machine. */
function stamp(now: Date): string {
  const p = (n: number, width = 2) => String(n).padStart(width, '0')
  return (
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`
  )
}

/**
 * Where the copy goes, derived from the live database's own path.
 *
 * Pure, so the naming is testable without a device. The path comes from the
 * plugin's `getUrl()` rather than being reconstructed from the app id, which
 * would silently break if the id ever changed - and `PROJECT.md` notes the id is
 * baked in at `cap init` precisely because changing it orphans the database.
 *
 * The name carries the migration it is protecting against, so a directory of
 * these reads as a history rather than a pile. `VACUUM INTO` refuses to
 * overwrite an existing file, which is why the timestamp is there too: a retry
 * after a crash writes a second file instead of failing.
 */
export function backupTarget(databaseUrl: string, nextIndex: number, now: Date): string {
  const path = decodeURIComponent(databaseUrl.replace(/^file:\/\//, ''))
    // `file:///C:/x` strips to `/C:/x`, which is not a path Windows accepts.
    // The device is always POSIX; this only keeps the Node tests honest about
    // feeding in a real `file:` URL the way `getUrl()` hands one over.
    .replace(/^\/([A-Za-z]:\/)/, '$1')
  const cut = path.lastIndexOf('/')
  const dir = cut === -1 ? '' : path.slice(0, cut + 1)
  const file = path.slice(cut + 1)
  const base = file.replace(/\.db$/i, '')
  return `${dir}${base}.backup-${stamp(now)}-before-${String(nextIndex).padStart(4, '0')}.db`
}

/** Double single quotes - the only escaping a SQLite string literal needs. */
function quote(literal: string): string {
  return `'${literal.replace(/'/g, "''")}'`
}

/**
 * Copy the database, and return where it went.
 *
 * The path is **inlined into the SQL rather than bound**, which is the one
 * deliberate exception to the positional-parameter rule in `CLAUDE.md`. Two
 * reasons: SQLite's `VACUUM INTO` takes a filename expression that the Capacitor
 * plugin cannot parameterise (it routes `VACUUM` through `execute()`, which
 * takes no values), and the string is the plugin's own path rather than
 * anything a user typed. It is still quoted properly.
 *
 * Cannot run inside a transaction, so callers must not wrap it in one.
 */
export async function backupBeforeMigrate(
  db: Db,
  databaseUrl: string,
  nextIndex: number,
  now: Date = new Date(),
): Promise<string> {
  const target = backupTarget(databaseUrl, nextIndex, now)
  await db.exec(`VACUUM INTO ${quote(target)}`)
  return target
}
