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

const sources = import.meta.glob('/drizzle/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export function bundledMigrations(): MigrationFile[] {
  return Object.entries(sources)
    .map(([path, sql]) => {
      const tag = path.split('/').pop()!.replace(/\.sql$/, '')
      const index = Number(tag.slice(0, tag.indexOf('_')))
      if (!Number.isInteger(index)) {
        throw new Error(`migration ${tag} has no numeric prefix`)
      }
      return { index, tag, statements: splitStatements(sql) }
    })
    .sort((a, b) => a.index - b.index)
}
