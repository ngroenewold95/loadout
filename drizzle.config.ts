import { defineConfig } from 'drizzle-kit'

/**
 * `dialect: 'sqlite'` with no driver emits plain numbered .sql files plus
 * meta/_journal.json — which is exactly what we want, because the device
 * applies them itself via the Capacitor plugin's upgrade mechanism.
 *
 * Use `generate` only, never `push`: drizzle-kit does not introspect the WHERE
 * clause of a partial index, so `push` proposes a drop-and-recreate of the
 * live-row unique indexes on every run.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
})
