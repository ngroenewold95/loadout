# loadout

Personal Android workout logger. Single user, offline-first, no server.

Replaces Progression, importing ~5 years of history (6,206 sets, 343 sessions,
2021-07-06 to 2026-08-13).

## Stack

Capacitor + React + Vite + TypeScript + Tailwind, SQLite on device via
`@capacitor-community/sqlite`. Drizzle is a **laptop tool only** - it generates
the schema and numbered migrations; the device runs plain SQL, because
`drizzle-orm`'s migrator imports `node:fs` and its proxy driver misaligns
name-keyed result rows on joins.

**See [docs/PROJECT.md](docs/PROJECT.md)** for the plan, the measured findings
about the source data and the device, and next steps. Read it before touching
the schema or the importer - the export has several non-obvious behaviours,
each of which silently corrupts history if forgotten.

## The constraint

Logging a set must take about two taps. Everything else is negotiable.

## Commands

```bash
npm run dev        # Vite dev server
npm run build      # typecheck + build
npm run lint       # oxlint
npm run import     # rebuild db/ from the Progression CSV (refuses after cutover)
```

## Data safety

- `Examples/` is gitignored and holds the only copy of the source export.
- Migrations are numbered and never edited once applied.
- The device backs up via `VACUUM INTO` to a synced folder on launch and after
  each session - app-private storage does not survive uninstall.
