/**
 * Node-side migration runner.
 *
 * Takes a file copy of the database before touching it. That rule is firm:
 * a bad migration against the imported history is the worst outcome available.
 */
import { readFileSync, existsSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  applyMigrations,
  splitStatements,
  type MigrationFile,
} from '../src/db/migrations.ts'
import { openNodeDb } from '../src/db/node.ts'

const DRIZZLE_DIR = 'drizzle'

export function loadMigrations(dir = DRIZZLE_DIR): MigrationFile[] {
  const journalPath = join(dir, 'meta', '_journal.json')
  if (!existsSync(journalPath)) {
    throw new Error(`no migration journal at ${journalPath} - run npm run db:generate`)
  }
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number; tag: string }[]
  }

  // The journal is the source of truth for order; the .sql files are content.
  const files = new Set(readdirSync(dir).filter((f) => f.endsWith('.sql')))

  const migrations = journal.entries.map((entry) => {
    const name = `${entry.tag}.sql`
    if (!files.has(name)) {
      throw new Error(`journal references ${name} but it is missing from ${dir}/`)
    }
    files.delete(name)
    return {
      index: entry.idx,
      tag: entry.tag,
      statements: splitStatements(readFileSync(join(dir, name), 'utf8')),
    }
  })

  // The device has no journal - `src/db/migrationFiles.ts` globs the .sql files
  // and orders them by filename prefix. A file the journal does not list would
  // run on the phone and not on the laptop, which is the worst kind of drift.
  if (files.size > 0) {
    throw new Error(
      `${dir}/ contains migration(s) missing from the journal: ${[...files].join(', ')}`,
    )
  }

  return migrations
}

/** Timestamped copy alongside the database, kept forever. Cheap insurance. */
export function backupBeforeMigrate(dbPath: string): string | null {
  if (!existsSync(dbPath)) return null
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = join(dirname(dbPath), 'backups')
  mkdirSync(backupDir, { recursive: true })
  const dest = join(backupDir, `${stamp}-pre-migrate.sqlite`)
  copyFileSync(dbPath, dest)
  return dest
}

export async function migrate(dbPath: string): Promise<void> {
  mkdirSync(dirname(dbPath), { recursive: true })

  const backup = backupBeforeMigrate(dbPath)
  if (backup) console.log(`backed up -> ${backup}`)

  const db = openNodeDb(dbPath)
  try {
    const applied = await applyMigrations(db, loadMigrations(), (m) =>
      console.log(`  ${m}`),
    )
    console.log(applied > 0 ? `applied ${applied} migration(s)` : 'nothing to do')
  } finally {
    await db.close()
  }
}

// CLI entry point only. Without this guard, importing loadMigrations() or
// nodeExecutor() from another script would also run a migration as a side
// effect and leave the database handle open.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  migrate(process.argv[2] ?? 'db/loadout.sqlite').catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
