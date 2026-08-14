/**
 * The bundle must carry every migration the journal lists.
 *
 * **No such failure has happened**, and this is not written as though one had.
 * The gap it covers is structural: everything else that checks migrations reads
 * the journal off the filesystem, while the device runs whatever the bundler
 * inlined, so those two drifting apart is the one migration mistake that
 * nothing else here would notice.
 *
 * Note what this test can and cannot do. Vitest resolves `import.meta.glob`
 * fresh from disk, so it proves the pairing logic and that the journal and the
 * files agree right now; it cannot reproduce a stale bundle. The guard inside
 * `bundledMigrations` is what runs against the real bundled data on device, and
 * that is the one that would actually catch it.
 */
import { describe, it, expect } from 'vitest'
import { bundledMigrations } from './migrationFiles.ts'
import journal from '../../drizzle/meta/_journal.json'

describe('bundledMigrations', () => {
  it('carries every migration in the journal, in order', () => {
    const files = bundledMigrations()
    expect(files.map((f) => f.tag)).toEqual(journal.entries.map((e) => e.tag))
    expect(files.map((f) => f.index)).toEqual(files.map((_, i) => i))
  })

  it('gives every migration at least one statement', () => {
    // A migration that inlined as an empty string would apply cleanly, record
    // itself as done, and change nothing - the same silent failure in a
    // different disguise.
    for (const file of bundledMigrations()) {
      expect(file.statements.length, `${file.tag} is empty`).toBeGreaterThan(0)
    }
  })
})
