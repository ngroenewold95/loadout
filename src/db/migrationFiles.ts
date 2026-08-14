/**
 * The numbered migrations, bundled into the app.
 *
 * The Node runner reads `drizzle/meta/_journal.json` and treats it as the
 * source of truth for order. There is no filesystem on the device, so here the
 * SQL is inlined at build time and order comes from the numeric filename
 * prefix - the same ordering drizzle-kit encodes in the journal. `db:generate`
 * writes both, and `scripts/migrate.ts` fails loudly if they ever disagree.
 */
import { splitStatements, type MigrationFile } from './migrations.ts'
import journal from '../../drizzle/meta/_journal.json'

const sources = import.meta.glob('/drizzle/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export function bundledMigrations(): MigrationFile[] {
  const files = Object.entries(sources)
    .map(([path, sql]) => {
      const tag = path.split('/').pop()!.replace(/\.sql$/, '')
      const index = Number(tag.slice(0, tag.indexOf('_')))
      if (!Number.isInteger(index)) {
        throw new Error(`migration ${tag} has no numeric prefix`)
      }
      return { index, tag, statements: splitStatements(sql) }
    })
    .sort((a, b) => a.index - b.index)

  /**
   * The glob must agree with the journal.
   *
   * **Not written in response to a real failure** - say so plainly, because
   * this file is otherwise full of things that were. It is a cheap guard against
   * the worst shape a build mistake could take here: the glob is resolved by the
   * bundler while everything that verifies migrations on the laptop - the Node
   * tests, `scripts/migrate.ts`, `db:generate` - reads the journal from the
   * filesystem instead. A bundle that silently omitted a migration would
   * therefore pass every check and then report "schema up to date" on device,
   * running queries against columns that are not there.
   *
   * The journal is a separate entry in the module graph from the glob, so the
   * two disagreeing is exactly the discrepancy this can see.
   */
  const missing = journal.entries
    .filter((entry) => !files.some((f) => f.tag === entry.tag))
    .map((entry) => entry.tag)

  if (missing.length > 0) {
    throw new Error(
      `bundled migrations are missing ${missing.join(', ')} - the journal lists ` +
        `them but the build did not inline them. Rebuild, and if that does not ` +
        `fix it, delete node_modules/.vite first.`,
    )
  }

  return files
}
