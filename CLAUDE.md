# loadout

Personal Android workout logger. Read `docs/PROJECT.md` first: it is the living
document and the handoff point for a cold start.

## Writing rules

- **Never use em dashes anywhere** (the U+2014 character). Not in
  documentation, not in code, not in comments, not in commit messages, not in
  UI strings, not in chat replies. Use a plain ASCII hyphen, a comma, a colon,
  or two sentences instead.
- **En dashes (U+2013) are fine.** Ranges like `5–8` read well and the source
  plan already uses them.
- Check before finishing. This must return nothing:

  ```bash
  git ls-files -z | LC_ALL=C xargs -0 grep -n $'\xe2\x80\x94'
  ```

  Three things earlier versions of this command got wrong, all verified:
  `grep -P` fails outright in this Git Bash locale ("supports only unibyte and
  UTF-8 locales"), so a byte pattern is used instead; filtering by
  `--include='*.ts'` and friends missed `.gitignore`, which had two em dashes
  in it for months; and `Examples/` had to be excluded by hand. Driving it from
  `git ls-files` fixes all three at once - it covers every tracked file
  whatever its extension, and skips everything gitignored, which is exactly the
  set we author.
- Keep prose plain. State what was measured; say so explicitly when something
  is unverified.

## Project rules

- `docs/PROJECT.md` records what was *learned*, not what is planned. Update it
  when a fact changes, and keep the "Corrections" section honest.
- Migrations are append-only and never edited once applied. **Read every
  `drizzle-kit generate` output before applying it** - it emits broken SQL for
  a table rebuild every time, not occasionally: the `INSERT ... SELECT` reads
  the newly added columns from the old table. Hand-fix them to `NULL`.
- **A table rebuild that touches a parent needs `foreign_keys = OFF` outside
  the transaction.** drizzle's own `PRAGMA foreign_keys=OFF` is a no-op inside
  one, and `defer_foreign_keys` does not help. The runner handles this; do not
  undo it. Any migration touching rows must be proved by
  `src/db/migrations.test.ts`, which migrates a database **with rows in it** -
  an empty one cannot fail this way.
- All SQL lives in `src/db/repo.ts`. Positional `?` parameters only, never
  `?N`. Every read filters `deleted_at IS NULL` explicitly.
- No query inside a loop: on device each call crosses the JS/native bridge.
- Never compare weights with `===`. Use `weightsEqual` from `src/logic/units.ts`.
- **The launcher icons are generated, not drawn.** `android/.../mipmap-*` PNGs
  come out of `node scripts/make-icons.mjs`, whose geometry mirrors
  `design/icons/e12-e8-longest-bar.svg`. Edit the geometry and re-run; hand
  edits to the PNGs are lost on the next run. There is no rasteriser installed
  here, which is why that script exists at all.
- `Examples/` and `db/` are gitignored and hold the only copy of personal data,
  including medical notes. Nothing derived from them may be committed or
  packaged as an Android asset.
