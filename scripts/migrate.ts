/**
 * Node-side migration runner.
 *
 * Takes a file copy of the database before touching it. That rule is firm:
 * a bad migration against the imported history is the worst outcome available.
 */
import Database from 'better-sqlite3'
import { readFileSync, existsSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  applyMigrations,
  splitStatements,
  type Executor,
  type MigrationFile,
} from '../src/db/migrations.ts'

const DRIZZLE_DIR = 'drizzle'

export function loadMigrations(dir = DRIZZLE_DIR): MigrationFile[] {
  const journalPath = join(dir, 'meta', '_journal.json')
  if (!existsSync(journalPath)) {
    throw new Error(`no migration journal at ${journalPath} — run npm run db:generate`)
  }
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number; tag: string }[]
  }

  // The journal is the source of truth for order; the .sql files are content.
  const files = new Set(readdirSync(dir).filter((f) => f.endsWith('.sql')))

  return journal.entries.map((entry) => {
    const name = `${entry.tag}.sql`
    if (!files.has(name)) {
      throw new Error(`journal references ${name} but it is missing from ${dir}/`)
    }
    return {
      index: entry.idx,
      tag: entry.tag,
      statements: splitStatements(readFileSync(join(dir, name), 'utf8')),
    }
  })
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

export function nodeExecutor(db: Database.Database): Executor {
  return {
    exec: async (sql) => {
      db.exec(sql)
    },
    all: async (sql, params = []) =>
      db.prepare(sql).all(...(params as never[])) as never,
  }
}

export async function migrate(dbPath: string): Promise<void> {
  mkdirSync(dirname(dbPath), { recursive: true })

  const backup = backupBeforeMigrate(dbPath)
  if (backup) console.log(`backed up -> ${backup}`)

  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  try {
    const applied = await applyMigrations(nodeExecutor(db), loadMigrations(), (m) =>
      console.log(`  ${m}`),
    )
    console.log(applied > 0 ? `applied ${applied} migration(s)` : 'nothing to do')
  } finally {
    db.close()
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
