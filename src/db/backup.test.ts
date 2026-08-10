/**
 * The naming is pure and tested directly. The copy itself is tested for real:
 * `VACUUM INTO` is plain SQLite, so better-sqlite3 running the shipped
 * migrations proves the statement works and that the copy is a usable database.
 *
 * What this cannot prove is that the plugin routes `VACUUM` to `execute()`
 * rather than `run()` on device. That is `capacitor.ts`'s `NON_DML` regex, and
 * it belongs in the on-device smoke checks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openNodeDb, type NodeDb } from './node.ts'
import { applyMigrations } from './migrations.ts'
import { loadMigrations } from '../../scripts/migrate.ts'
import { backupBeforeMigrate, backupTarget } from './backup.ts'

const AT = new Date(Date.UTC(2026, 7, 9, 10, 45, 0))

describe('backupTarget', () => {
  const ANDROID = 'file:///data/user/0/com.groenewold.loadout/databases/loadoutSQLite.db'

  it('keeps the copy beside the database it copies', () => {
    expect(backupTarget(ANDROID, 3, AT)).toBe(
      '/data/user/0/com.groenewold.loadout/databases/' +
        'loadoutSQLite.backup-20260809-104500-before-0003.db',
    )
  })

  it('names the migration it is protecting against, zero padded', () => {
    expect(backupTarget(ANDROID, 0, AT)).toContain('before-0000.db')
    expect(backupTarget(ANDROID, 12, AT)).toContain('before-0012.db')
  })

  it('accepts a bare path as readily as a file: URL', () => {
    const bare = '/data/databases/loadoutSQLite.db'
    expect(backupTarget(bare, 3, AT)).toBe(
      '/data/databases/loadoutSQLite.backup-20260809-104500-before-0003.db',
    )
  })

  it('decodes a percent-encoded path', () => {
    const encoded = 'file:///data/my%20apps/loadoutSQLite.db'
    expect(backupTarget(encoded, 1, AT)).toBe(
      '/data/my apps/loadoutSQLite.backup-20260809-104500-before-0001.db',
    )
  })

  it('is stable across time zones, because the stamp is UTC', () => {
    // Same instant, different local offsets in the source literal.
    const a = backupTarget(ANDROID, 3, new Date('2026-08-09T10:45:00Z'))
    const b = backupTarget(ANDROID, 3, new Date('2026-08-09T06:45:00-04:00'))
    expect(a).toBe(b)
  })

  it('distinguishes two attempts at the same migration', () => {
    const first = backupTarget(ANDROID, 3, new Date(Date.UTC(2026, 7, 9, 10, 45, 0)))
    const second = backupTarget(ANDROID, 3, new Date(Date.UTC(2026, 7, 9, 10, 45, 1)))
    expect(first).not.toBe(second)
  })
})

describe('backupBeforeMigrate', () => {
  let dir: string
  let db: NodeDb

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'loadout-backup-'))
    db = openNodeDb(join(dir, 'loadoutSQLite.db'))
    await applyMigrations(db, loadMigrations())
  })

  afterEach(async () => {
    await db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes a copy that is itself a usable database', async () => {
    const now = Date.now()
    await db.exec(
      `INSERT INTO exercises (name, created_at, updated_at) VALUES (?, ?, ?)`,
      ['Trap Bar Deadlift', now, now],
    )

    const target = await backupBeforeMigrate(db, pathToFileURL(join(dir, 'loadoutSQLite.db')).href, 3, AT)
    expect(existsSync(target)).toBe(true)

    const copy = openNodeDb(target)
    const rows = await copy.query<{ name: string }>('SELECT name FROM exercises')
    expect(rows.map((r) => r.name)).toEqual(['Trap Bar Deadlift'])
    await copy.close()
  })

  it('checkpoints, so there is no -wal beside the copy to forget', async () => {
    const target = await backupBeforeMigrate(db, join(dir, 'loadoutSQLite.db'), 3, AT)
    expect(existsSync(`${target}-wal`)).toBe(false)
    expect(existsSync(`${target}-shm`)).toBe(false)
  })

  it('refuses to overwrite an existing copy rather than destroying it', async () => {
    const url = join(dir, 'loadoutSQLite.db')
    await backupBeforeMigrate(db, url, 3, AT)
    await expect(backupBeforeMigrate(db, url, 3, AT)).rejects.toThrow()
  })

  it('survives a path containing a quote', async () => {
    const odd = openNodeDb(join(dir, "o'brien.db"))
    await applyMigrations(odd, loadMigrations())
    const target = await backupBeforeMigrate(odd, join(dir, "o'brien.db"), 1, AT)
    expect(existsSync(target)).toBe(true)
    await odd.close()
  })
})
