# loadout

Personal Android workout logger. Read `docs/PROJECT.md` first: it is the living
document and the handoff point for a cold start.

## Writing rules

- **Never use em dashes anywhere** (the U+2014 character, and likewise U+2013
  en dashes in prose). Not in documentation, not in code, not in comments, not
  in commit messages, not in UI strings, not in chat replies. Use a plain
  ASCII hyphen, a comma, a colon, or two sentences instead.
- Check before finishing. This must return nothing (the escapes avoid writing
  the characters themselves):

  ```bash
  grep -rnP '\x{2014}|\x{2013}' --include='*.ts' --include='*.tsx' \
    --include='*.md' --include='*.java' . | grep -v node_modules
  ```
- Keep prose plain. State what was measured; say so explicitly when something
  is unverified.

## Project rules

- `docs/PROJECT.md` records what was *learned*, not what is planned. Update it
  when a fact changes, and keep the "Corrections" section honest.
- Migrations are append-only and never edited once applied. **Read every
  `drizzle-kit generate` output before applying it** - it has emitted broken
  SQL here before.
- All SQL lives in `src/db/repo.ts`. Positional `?` parameters only, never
  `?N`. Every read filters `deleted_at IS NULL` explicitly.
- No query inside a loop: on device each call crosses the JS/native bridge.
- Never compare weights with `===`. Use `weightsEqual` from `src/logic/units.ts`.
- `Examples/` and `db/` are gitignored and hold the only copy of personal data,
  including medical notes. Nothing derived from them may be committed or
  packaged as an Android asset.
