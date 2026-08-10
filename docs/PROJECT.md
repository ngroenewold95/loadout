# loadout - plan, findings, next steps

Living document, and the handoff point for a cold start. Anything stated as
fact was **measured**; anything unverified says so explicitly. Update it when
something is *learned*, not when something is planned.

Last updated: 2026-08-09

---

## What this is

Personal Android workout logger replacing Progression. Single user, offline
first, no server, no sync. Imports ~5 years of history.

**The constraint that decides everything:** logging a set must take about two
taps. A better data model does not compensate for a slower logging loop.

Reference app `workout.progression.lite` is installed on the device and is a
legitimate baseline - inspect it with `adb` when a behaviour question comes up.
Doing so has already overturned two wrong assumptions.

**Writing rule: no em dashes anywhere** - docs, code, comments, UI strings,
commit messages. See `CLAUDE.md`. This is why the templates are named
`Day A - Trap Bar` rather than with the long dash `Examples/Plan.md` uses.
**En dashes are fine**, so ranges like `5–8` may be written as such (relaxed
2026-08-09; an earlier version of this rule banned both).

---

## Current state

Working and verified on device (Pixel 7, Android 17 / API 37):

- Vite + React 19 + TS 6 + Tailwind 4 + Capacitor 8.5, app installs and runs
- Schema + migrations 0000-0004, with STRICT and CHECK constraints **proven** to
  reject bad data and partial unique indexes allowing reuse of soft-deleted names
- `npm run import` - 6,140 sets / 339 sessions / 86 exercises, **total volume
  7,463,140 lb matching exactly** between CSV and DB (round-trips 5,866 weights
  through lb→kg→lb, so the conversion is verified against real data)
- Per-exercise rest seeded from actual history; **templates seeded from the
  current programme** (see Programme below)
- **Repo layer complete and verified on device.** One `Db` interface, two
  backends, all queries in `src/db/repo.ts`
- **Rest timer complete**: floating overlay bubble, red count-up past zero,
  5-second haptic countdown, hides while the app is in front
- **Logging loop working on device against the real 6,140-set history** - home,
  A/B rotation, prefill, LOG SET, rest, undo, resume, progression cue
- **Backups before device migrations, verified on device.** The runner took its
  own `VACUUM INTO` copy, then applied 0003 and 0004 across the Capacitor
  bridge, leaving 6,140 sets and 7,463,140 lb intact with zero foreign key
  violations and enforcement restored. See Corrections for the two faults this
  shook out.
- **Palette adopted from the reference app** (`docs/PROGRESSION.md`), with
  muscle-group badges giving an exercise one identity everywhere
- 132 tests passing, typecheck and lint clean

Built but **not yet wired to any screen** - these are pure and tested, and the
UI stages below consume them:

- `platesFor` in `src/logic/plates.ts` - the inventory-aware plate solver
- `scrubSteps` / `parseWeight` / `parseReps` in `src/logic/entry.ts`
- `updateSet` / `deleteSet`, and `recentPerformance` widened to three sessions
- `app_settings` and `plate_inventory` tables, both **empty**
- `exercises.loading` and `exercises.default_increment_kg`, both **null for all
  87 rows**, so plate chips stay dormant until they are populated

Not built yet: the UI stages 3-10 below, exercise picker, template editor, the
synced-folder export.

---

## Decisions

| Area | Decision | Why |
|---|---|---|
| Stack | Capacitor + React + Vite + TS + Tailwind | Existing skill transfers; ~95% of the app is ordinary UI |
| Native language | **Java**, not Kotlin | Adding the Kotlin Gradle plugin was an unnecessary variable. Revisit if the native surface grows. |
| Storage | SQLite via `@capacitor-community/sqlite` | Relational queries, migrations as a ratchet. Not for speed - the dataset is tiny. |
| ORM | Drizzle for schema + migration generation **only** | Its runtime cannot ship to device - see below |
| State | TanStack Query for historical reads, plain store for the active session | Query invalidation fits "log a set → last-session view refreshes". A live workout is not a cached remote resource. |
| Sync | None | Conflict resolution costs more than everything else combined |
| Timer | **Foreground service + `SYSTEM_ALERT_WINDOW` overlay** | The only way to get a bubble that turns red and counts up. Matches Progression. |
| Templates | Seeded once from `src/logic/plan.ts`, then the **DB owns them** | They must be editable in-app. A file that re-seeded on launch would silently undo every edit. |

### Drizzle is a laptop tool

Three independent reasons its runtime must not ship to the device:

1. No Drizzle driver exists for `@capacitor-community/sqlite`
   ([issue #924](https://github.com/drizzle-team/drizzle-orm/issues/924), open
   since 2023). The one Capacitor/Drizzle package is v0.0.1 and peer-depends on
   a licence-gated plugin.
2. `drizzle-orm`'s migrator does `import fs from 'node:fs'`. It cannot run in a
   WebView.
3. `sqlite-proxy` reads rows **positionally**; the Capacitor plugin returns them
   keyed by column name. Every table here has `id`, `notes`, `created_at`,
   `updated_at`, `deleted_at`, so a `sets ⋈ sessions ⋈ exercises` join collapses
   duplicate keys and silently misaligns every later column - **plausible wrong
   numbers, no error.**

So: `drizzle-kit generate` produces schema types and numbered SQL. The device
runs plain SQL behind `query<T>(sql, params)` / `exec(sql, params)`.
**`generate` only, never `push`** - drizzle-kit does not introspect partial
index `WHERE` clauses ([#4688](https://github.com/drizzle-team/drizzle-orm/issues/4688))
and proposes a drop-and-recreate every run.

---

## Programme (current)

Switched 2026-08-08, replacing the `Day 1`/`Day 2`/`Day 3` split that was
reverse-engineered from history. **The old data is still valid as history; it is
just no longer the template.** Source: `Examples/Plan.md`, encoded as
`src/logic/plan.ts`.

- **Two days, A/B rolling** - explicitly *not* pinned to weekdays. `nextTemplate`
  picks whichever template was performed least recently, so a missed week
  resumes rather than skips.
- **2 sets × 5-8 reps** throughout (some 6-10, 10-15 on calves/core).
- **Progression rule: top of the range on both sets → add load.** Encoded as
  `shouldIncreaseLoad`, pure and tested. This is why `target_reps` became
  `target_rep_min` / `target_rep_max` (migrations 0001-0002) - a single number
  cannot express the goal or decide the cue.
- **Rest by band**, from the plan header: compound 240 s, machine 150 s,
  isolation/core 75 s. These override the history-seeded per-exercise defaults
  on template rows, because history came from a different programme.

**20 of the 21 exercises already existed** with years of sets behind them, so
the last-session panel is populated from the first workout. Only `Pallof Press`
was created. Verified against the real database - every row but that one shows
recent history.

Two plan names were ambiguous and resolve to the variant **actually in current
use**; both alternatives are distinct exercises that must not be merged:

| Plan says | Resolved to | Rejected |
|---|---|---|
| Hammer curl | `Incline Dumbbell Hammer Curl` (to 2026-07-22) | `Dumbbell Hammer Curl` (last used 2022) |
| Cable pushdown | `Cable Pushdown (with Bar Handle)` (2026-07-19) | `(with Rope Handle)` (2024) |

`Machine Calf Raise` (standing, Day A) and `Machine Calf Raise (Seated)`
(Day B) are both in the plan, which independently confirms the earlier decision
not to merge them.

---

## Repo layer - DONE

One interface, `Db`, in `src/db/driver.ts`. Two backends implement it:
`node.ts` (better-sqlite3 - import, scripts, every test) and `capacitor.ts`
(device, and jeep-sqlite for `npm run dev`). All SQL lives in `src/db/repo.ts`.

Four rules the layer exists to enforce:

1. **No query inside a loop.** `batch()` is one bridge crossing for N
   statements. `recentPerformance` answers a whole template in one statement -
   measured at **14.7 ms for 8 exercises** over the real 6,140-row database.
2. **Transactions are scoped to a handle, not the connection.** `transaction()`
   takes the connection and passes a `tx`; everything else queues behind it.
   The device bridge is async, so two overlapping callers would otherwise
   interleave and one would commit the other's half-written work. Nesting uses
   savepoints.
3. **Columns are aliased to camelCase in the SQL** (`AS "weightKg"`). The plugin
   returns rows keyed by name, so this gives the UI its shape with no mapping
   layer to drift.
4. **Soft delete is never implicit** - every read spells out `deleted_at IS NULL`.
   There is no base query to forget to extend.

Positional `?` only, never `?N`: the two backends bind numbered parameters
differently, so repeated values are repeated in the params array.

`logSet` derives both positions inside the INSERT - `order_index` within the
session (so supersets interleave truthfully) and `set_index` within the
exercise. Doing it in SQL keeps it one statement and makes the numbering correct
even right after an undo. It also inherits `load_mode` and `base_weight_kg` from
the exercise via `COALESCE`, which is what stops a natively-logged Assisted
Chinup being written as `total` and reading backwards forever after.

### Verified on device, not just in Node

`src/ui/DbSmoke.tsx` runs 10 checks on the phone and **all 10 pass**. It exists
because the Node tests cannot prove the three things that only differ on device:

- statements route to the right plugin call (`run` vs `execute`)
- a transaction really holds across async bridge crossings - rollback and
  savepoint nesting both confirmed
- the device's SQLite has the `DENSE_RANK() OVER (PARTITION BY ...)` that
  `recentPerformance` depends on - **it does**

It hard-deletes everything it creates, because a leftover `source = 'native'`
row would permanently block a re-import.

---

## Logging loop - WORKING

Verified on device against the real imported history, not fixtures. Sequence
confirmed by screenshot at every step:

| | |
|---|---|
| Home | "Next up" = the template performed least recently. After logging Day A it correctly advanced to Day B. |
| Opening an exercise | Target `2 × 5-8`, rest `4:00`, and **last time · 2026-07-19 · 355 × 8  355 × 8** on screen permanently |
| Prefill | 355 lb × 8 already in the fields - logging set 1 is **one tap** |
| LOG SET | Set recorded, green chip appears, and `RestTimerService` starts as a *side effect* - confirmed in `dumpsys`, never a separate tap |
| Rest | In-app bar counts down with `+30s` / `Skip`; the overlay bubble stays hidden while the app is in front |
| Progression | After two sets at the top of the range: **"Top of the range on every set - add load next time."** |
| Undo | Enables once a set exists; position is reused, not skipped |
| Resume | Cold start returns straight into the in-progress session |

The screen adapts to all four row shapes via `entryShape`. `bodyweight` gives
weight as **optional** rather than absent - `Chinup` and `Chest Dip` appear both
weighted and unweighted in the same history, so either extreme would block them.

### Things this shook out

- **HTML collapses whitespace.** Last session's sets were joined with spaces and
  rendered as `355 × 8 355 × 8` - one unreadable run. They are separate elements
  with a flex gap now. Joining display strings is the bug; the fix is layout.
- **Blind `adb input tap` at fixed coordinates is unreliable** - the layout
  shifts as the rest bar and set chips appear, and one tap meant for LOG SET hit
  *Finish workout*. Screenshot before every tap.
- The in-app bar and the overlay both render from the same absolute `endsAt`, so
  they cannot disagree, and neither needs the app to have been awake.

---

## Muscle badges - DONE

The coloured circle from `docs/PROGRESSION.md`, now rendered in the exercise
header and the strip. It exists because a template is 21 names that mostly begin
with "Machine" or "Cable", and reading them under a bar is slow.

- `logic/exerciseMuscles.ts` maps **exact exercise name -> group** for all 87.
  A flat table, not a heuristic: `Machine Fly` is chest while `Machine Rear Delt
  Fly` is shoulders, and `Machine Leg Curl` and `Nordic Curl` are legs while
  every other `Curl` is biceps. No pattern survives those.
- `db/seedMuscles.ts` **only fills blanks**, so a hand correction or a future
  exercise editor survives a re-run. Safe to call on every launch.
- **83 of 87 classified.** The 4 blanks are deliberate: cardio and general
  mobility have no single primary group, and the neutral `?` circle is the
  honest answer. Guessing would defeat the point of the colour.
- Unmapped names are **reported, not thrown** - the import prints them, because
  a `?` badge is cosmetic and should not fail a reconciling import.

**Found by looking at it on the phone:** the first `biceps` colour was a purple
chosen to sit beside `legs`, and at the 20 px strip size the two were barely
separable. They co-occur on **both** programme days, which is exactly when the
colour has to work. Biceps is now orange. The rule to keep: no two groups that
appear on the same day may be close in hue. Biceps was the one colour never
sampled from Progression, so changing it costs no measurement.

Note two groups share an initial in each direction - Chest/Calves are both `C`,
Back/Biceps both `B` - exactly as in the reference app. The colour is the
identity and the letter is the reminder, which is why the badge is never
monochrome and never letter-only.

---

## How load is made up - `loading`, bar weight, plates

Schema and solver exist and are tested; **nothing renders them yet** (stage 7).
The design is here because it is the part a cold start would otherwise
re-derive wrongly.

### `loading` is a separate axis from `modality`

`MODALITIES` has one flat `machine`, which cannot tell a Hammer Strength row
from a cable pushdown. Those are different machines to load and different
numbers to type, and **the imported history already contains the distinction**:
`"Machine weight 100" + 7x45/side` reconciles exactly to a logged 730 lb, while
`8x45` -> 460 and `10x45` -> 550 only reconcile as base plus *total* plates. So
per-side versus total is a property of the machine, not something inferable
from the number. Hence `exercises.loading` (migration 0004):

| Value | Meaning | Chips |
|---|---|---|
| `plates_per_side` | barbell, iso-lateral machines | per side |
| `plates_total` | single-pin plate-loaded sleds | total |
| `stack` | selectorised pin stack | none |
| `fixed` | dumbbells, fixed bars, bodyweight | none |

**Payoff beyond the chips:** once populated, the deferred `Set Comment` parser
stops having to "try both and report which matched". It knows which to try, and
a reconciliation failure becomes evidence that an exercise's `loading` is wrong
rather than an unresolvable ambiguity.

### Bar weight resolves in three steps, most specific first

1. an explicit value passed at log time
2. `exercises.default_base_weight_kg` - the per-exercise override
3. `app_settings.default_bar_weight_kg`, **only when `modality = 'barbell'`**

Step 3's gate is load-bearing. Progression keeps a single global
`Equipment weight: 45 Lb` with no override anywhere, which is wrong the moment a
trap bar is involved - and `Day A - Trap Bar` opens with `Trap Bar Deadlift`.
Trap bars run 45 to 75 lb and an EZ bar is nearer 15. A plate-loaded sled whose
base is unrecorded must show **no base** rather than silently assuming 45 lb.
Machines resolve at step 2, which is what `default_base_weight_kg` was built
for - see the ~30 rows in `Set Comment` carrying bases of 100 / 55 / 20 / 15 lb.

**Define the chain once**, as a single SQL expression constant in `repo.ts`,
reused by `listTemplateExercises` (so the UI draws chips from the resolved
value) and `logSet` (so the snapshot into `sets.base_weight_kg` cannot
disagree). Two hand-written copies would drift.

### The solver is inventory-aware, and says so when it cannot

Measured off Progression (`docs/PROGRESSION.md`), including the two rules that
are easy to get wrong:

- It solves against **plates actually owned**. Owned here: 2.5, 5, 10, 25, 35,
  45 lb. **There is no 20 lb plate**, and a solver that only knew denominations
  would happily propose one.
- Counts are **totals, halved per side**. Confirmed by overloading Progression's
  own calculator: an inventory of 8 caps at 4 per side.
- An unreachable target is reported as a **remainder**, rendered as a visually
  distinct dashed chip, never rounded away. The number in the database is the
  one you typed either way, so a chip row that lies is worse than none.

**The arithmetic is in integer display units, not kg.** Accumulating quantised
kg drifts exactly as `units.ts` warns: a 170 lb bar came out one 2.5 lb plate
short because the running total landed 0.0001 kg under the plate it needed. A
plate is a display-unit object anyway - a 45 is 45 lb, not 20.4117 kg.

**Open:** the 730 lb machine press in the history needs 7x45 per side, which the
configured inventory of 8 cannot reach. It correctly reports a shortfall, but a
commercial gym effectively has unlimited plates. Decide whether inventory is
per-gym, or whether an unset count means unlimited.

---

## Wireless debugging and device data

Complements the Dev loop section below, which covers the build commands.

**Wireless debugging works and is now the default** - no cable.

```bash
adb pair 192.168.4.246:<pairing-port> <6-digit-code>   # once, from the pairing dialog
adb connect 192.168.4.246:<connect-port>               # different port, main screen
```

Windows blocks adb's mDNS discovery, so `adb mdns services` returns nothing and
both ports must come from the phone's screen. The **connect** port can also be
found by scanning 30000-46000 for the one open port, which is how it was found
here (37747).

### Putting the imported history on the phone

The plugin's file is `databases/loadoutSQLite.db` under the app's private
directory. `VACUUM INTO` first - it produces a compact, fully-checkpointed
single file, so there is no `-wal` to forget:

```bash
# laptop: VACUUM INTO db/for-device.sqlite, then PRAGMA user_version = 1
adb shell am force-stop com.groenewold.loadout
adb push db/for-device.sqlite /data/local/tmp/loadout.db
adb shell "run-as com.groenewold.loadout sh -c 'rm -f databases/loadoutSQLite.db-wal databases/loadoutSQLite.db-shm; cp /data/local/tmp/loadout.db databases/loadoutSQLite.db'"
```

`user_version = 1` matters: the plugin opens at version 1 and would otherwise
see 0 and hunt for an upgrade statement that does not exist. Our `__migrations`
table remains the real schema ratchet.

**Current device state (2026-08-09):** the phone carries a **340-session**
lineage, not the canonical 339 the import produces. A pre-0003 snapshot was
pushed back deliberately so the device's own migration runner had to apply 0003
and 0004 itself rather than receiving an already-migrated file - which is what
made that verification real. Re-push `db/for-device.sqlite` to return to 339.
Check which you have with the `__migrations.applied_at` timestamps: if they all
fall within milliseconds of each other, the file was migrated on the laptop and
pushed, so the device path was never exercised.

Re-pushing is also how the device is reset after testing - logging test sets
writes real `source = 'native'` rows.

**This file must never be committed.** `sets.notes` carries the medical notes
from `Set Comment`, so it stays in gitignored `db/`. Do not package it as an
Android asset, which *is* tracked.

There is no `sqlite3` binary on the device, so inspect through the app's debug
panel rather than the shell.

---

## File map

```
src/
  logic/            pure TS, no React imports - the durable layer
    units.ts        kg/lb, quantisation, weightsEqual (never use ===)
    csv.ts          RFC4180 parser, parseClock/parseNumber/parseInteger
    progression.ts  export -> domain model; the four findings live here
    plan.ts         the current programme, as a SEED; shouldIncreaseLoad
    entry.ts        entry shapes, steppers, scrubSteps, keypad parsing
    plates.ts       inventory-aware plate solver; the `loading` axis
    muscles.ts      the eight groups and their colours; muscleBadge
    exerciseMuscles.ts  exact exercise name -> group, all 87
  db/
    schema.ts       Drizzle schema; source of truth for migrations
    migrations.ts   shared migration runner (Node + device)
    driver.ts       the Db interface: locking, savepoints, batch
    node.ts         better-sqlite3 backend - laptop only, exposes .raw
    capacitor.ts    device + jeep-sqlite backend
    migrationFiles.ts  bundles drizzle/*.sql into the app (no fs on device)
    open.ts         the app's single handle; migrates before first query
    repo.ts         EVERY query the app makes
    seedPlan.ts     plan.ts -> templates tables, one transaction
    seedMuscles.ts  fills blank primary_muscle; only ever fills blanks
    backup.ts       VACUUM INTO copy taken before device migrations
  Tests sit beside what they cover. Two carry their own weight:
    db/migrations.test.ts  migrates a database WITH ROWS IN IT - the only
                           thing that catches a parent-table rebuild failing
    logic/plates.test.ts   conformance against chip rows measured off the
                           reference app, not against an idea of a solver
  native/
    restTimer.ts    JS face of the rest-timer plugin
  state/
    queries.ts      TanStack Query over the repo; keys and invalidation
  ui/
    Home.tsx        next-up template, start a workout
    ActiveSession.tsx  THE LOGGING LOOP
    RestBar.tsx     in-app countdown; red count-up past zero
    MuscleBadge.tsx the coloured identity circle, header and strip
    TimerSpike.tsx  throwaway harness for the timer - behind `debug`
    DbSmoke.tsx     throwaway on-device check of the db layer - same
scripts/
  import.ts         CSV -> SQLite, drop-and-rebuild, reconciliation
  migrate.ts        Node migration runner, backs up first
  profile.ts        format-agnostic CSV profiler
  add-strict.mjs    post-processes drizzle output to add STRICT
drizzle/            generated SQL migrations + journal
android/app/src/main/java/com/groenewold/loadout/
  MainActivity.java      registers plugin; owns the isForeground flag
  RestTimerPlugin.java   JS-facing surface: start/extend/cancel/permissions
  RestTimerService.java  foreground service, overlay lifecycle, haptics
  TimerOverlayView.java  hand-drawn bubble: ring, M:SS, red count-up
Examples/           gitignored - the ONLY copy of the source export
db/                 gitignored - rebuildable until cutover
```

---

## Dev loop

```bash
npm run dev          # Vite dev server
npm run build        # tsc -b && vite build
npm run test         # vitest (132 tests)
npm run lint         # oxlint
npm run import       # rebuild db/ from the CSV; refuses after cutover
npm run profile      # profile any CSV's structure
npm run db:generate  # drizzle-kit generate + add STRICT
npm run db:migrate   # apply migrations to db/loadout.sqlite (backs up first)
```

Deploying to the phone:

```bash
npm run build && npx cap sync android
./android/gradlew -p android installDebug   # ~25s incremental, ~6min cold
adb shell am start -n com.groenewold.loadout/.MainActivity
```

Use `-p android` rather than `cd android`. The working directory persists
between tool calls and across the PowerShell and bash tools, so a stray `cd`
leaves later `npx cap sync android` calls failing with "android platform has
not been added yet" from inside `android/`.

**Environment gotcha:** PowerShell does not persist env vars between tool calls.
Every shell that runs Gradle needs:

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:JAVA_HOME    = "$env:ProgramFiles\Android\Android Studio\jbr"
$env:PATH        += ";$env:LOCALAPPDATA\Android\Sdk\platform-tools"
```

(They *are* set permanently at user level; this is only needed inside a fresh
non-login shell.)

Useful device commands:

```bash
adb devices -l
adb connect 192.168.4.246:<port>                      # after pairing; see above
adb shell appops set com.groenewold.loadout SYSTEM_ALERT_WINDOW allow   # grant overlay without the settings walk
adb shell pm grant com.groenewold.loadout android.permission.POST_NOTIFICATIONS
adb shell dumpsys window | grep -i mAlertWindows      # is the bubble up?
adb shell dumpsys activity services com.groenewold.loadout
adb shell am kill com.groenewold.loadout              # test process death (NOT force-stop)
adb shell screencap -p /sdcard/s.png && adb pull /sdcard/s.png
```

**PowerShell's `>` corrupts binary.** Screenshots must be pulled, not piped.
The same bites `adb exec-out ... > file.db` when reading the database out of
app-private storage: it silently inflates a 1,077,248-byte file to 1,362,876.
Use the bash tool for those, and note that Git Bash mangles remote paths in
`adb push` (`/data/local/tmp/x` becomes a Windows path), so pushes go through
PowerShell and binary reads go through bash.

---

## What we learned

### From the export (6,140 rows, 2021-07-06 → 2026-07-22)

Four things the raw file gets wrong about itself. Each would have silently
corrupted history.

**1. `Time` is the session END, not the start.**
`Time − max(Set Timestamp)` has a median of 37 s; `Time − min(Set Timestamp)` is
~59 min, i.e. the session length. Treating it as the start would shift every
session forward ~72 minutes.
→ `ended_at = Date+Time`, `started_at = ended_at − Session Duration`. Sessions
begin a median 472 s before the first logged set - Progression counts warm-up.
The `started_at ≤ first set` invariant holds in 334/339 sessions; the 5
exceptions overshoot by ≤0.7 s because Session Duration is integer-second while
Time is millisecond-precision. **Assert with ~2 s tolerance.**

**2. 420 sets record ASSISTANCE, where a higher number means an EASIER set.**
Assisted Chinup 140, Assisted Pullup 109, Chinup 44, Chest Dip 127. Assisted
Chinup runs 115 lb (2023) → 20 lb (2026) - that decline is getting stronger.
Reps confirm it: 115 lb averages 9.1 reps, 25 lb averages 6.7.
**Not inferable from the name** - `Chinup` and `Chest Dip` carry no marker.
Handled by `sets.load_mode`; PR detection must invert for `assistance`.
The rule applies only to rows that *have* a weight, so Chinup's unweighted 2025
period and Chest Dip's 53 blank rows fall out as plain bodyweight with no date
ranges needed.

**3. `Set Order` is the index within an EXERCISE, not the session.**
Max 4; 2,247/2,248 groups are exactly `0..n-1`. The export never records
exercise order - it is recovered by sorting `Set Timestamp`, which also
preserves the 12 sessions where exercises genuinely interleave as supersets.

**4. Machine base weights are already in the data, in `Set Comment` free text.**
`"Machine weight 100" + 7×45/side` reconciles exactly to the logged 730 lb.
This **proves** the "weight_kg is total load" principle against five years of
real logging. Notation is inconsistent though - `8x45` → 460 and `10x45` → 550
only reconcile as base + *total* plates, and the "per side" suffix does not
signal which. Any parser must try both and report which matched.

Smaller, all measured:

- **100% of history is lb.** One distinct `Weight Unit` value in five years.
- **RPE is 100% empty.** Column kept; no import plumbing.
- **91 rows have embedded newlines** in quoted fields - 56 in `Set Comment`,
  35 in `Workout Description`. Naive line-splitting gives 6,231 instead of 6,140.
- **Milliseconds are optional**: 27 `Time` and 4 `Set Timestamp` values lack
  them. Parse `HH:MM:SS[.mmm]`.
- **Reps are written as `"8.00"`** - parse as float, then require integrality.
- **Warm-up ramps exist** (~20 of 2,124 blocks) but are unclassifiable at
  import, hence `set_type = 'unknown'`.
- **9 of 105 distinct weights** fail bit-exact lb→kg→lb round-trip. Never
  compare weights with `=`; use `weightsEqual`, which quantises both sides
  first. A naive epsilon smaller than the storage grid fails exactly where it
  matters (stored value vs freshly computed one - the PR-detection shape).
- **`37.25 lb` is real**, so display rounding must be 0.25 lb, not 0.5.
- **Rest is derivable** from set-timestamp gaps: p10 110 s, median 169 s,
  p90 249 s. `default_rest_s` is seeded per exercise from actual history.
- **One corrupt session** (2025-12-02, left running 119 h). Detect via
  `Time` vs `max(Set Timestamp)` - *not* a duration threshold, since 68 sessions
  legitimately exceed 4,850 s.
- **The split in the export is 3-day** (`Day 1`/`Day 2`/`Day 3`, since Dec
  2024), not the A/B assumed during planning. Templates *were* seeded from it;
  **superseded on 2026-08-08** by the A/B programme in Programme (current). The
  measurement stands, it just no longer describes what is being trained.
- **Dumbbell entries are pair totals** (Incline DB Press max 200 = 2×100), while
  `Single-Arm` variants are one bell. Dumbbell Shrug and Fly double abruptly in
  Jan 2023 and were discontinued mid-2023 - flagged, not modelled.

### From the device

**A chronometer notification survives process death.** Verified with the app
process dead (`am kill`): SystemUI kept rendering the countdown from the
absolute `when` timestamp, 92 s remaining. `setWhen(endsAt)` +
`setUsesChronometer(true)` + `setChronometerCountDown(true)` is the whole
mechanism - no service, no per-second work. **This is kept as the notification
half of the timer**, alongside the overlay.

**The Android 16 status-bar chip does NOT work, despite qualifying.**
`hasPromotableCharacteristics()` returns **true** - structurally valid - but
`FLAG_PROMOTED_ONGOING` is never applied: `promoted=false, promotable=true`.
Ruled out: `IMPORTANCE_LOW` → `DEFAULT`, contentTitle present, no RemoteViews,
not colorized, not a group summary. No per-app "Live Updates" toggle appears on
this build. Untried leads if ever revisited: global Settings → Notifications →
Live Updates, and `Notification.ProgressStyle` (the feature is documented as
*progress-centric* and we post a bare chronometer).

### Corrections - recorded so they are not repeated

- `setRequestPromotedOngoing` / `setShortCriticalText` are on
  **`NotificationCompat.Builder`** (androidx core 1.17.0), *not* the platform
  `Notification.Builder`. An earlier claim that the API did not exist was wrong;
  the wrong class was inspected.
- **There is no `POST_PROMOTED_NOTIFICATIONS` permission.** Only
  `POST_NOTIFICATIONS`.
- **`am force-stop` did NOT clear notifications** on Android 17, contrary to
  guidance. Use `am kill` to test process death.
- **STRICT tables are narrower than assumed.** They reject `''` and `'abc'` in a
  REAL column (the important cases - 274 blank `Weight` fields) and `'8.5'` in
  an INTEGER column, but **accept and coerce** `'130.00'` → 130. STRICT guards
  against blank/malformed fields, not against forgetting to parse.
- **better-sqlite3 13.0.3 needs no compilation on Windows** - prebuilt N-API
  binaries ship in the tarball. The node-gyp concern applied to ≤11.x.
- **`drizzle-kit generate` emits BROKEN SQL when a table rebuild adds columns.**
  Adding a CHECK constraint forces the create-new/copy/drop/rename dance, and
  the generated `INSERT ... SELECT` **selects the newly added columns from the
  old table**, which does not have them. Migration 0001 was hand-fixed to
  `SELECT ... NULL, NULL, ...`. **Read every generated migration before
  applying it.** Not a one-off: **0004 emitted the identical fault** and needed
  the identical hand-fix, so treat it as this tool's normal output for a
  rebuild rather than as a bug that might have been fixed upstream.
- **`drizzle-kit generate` needs a TTY** when a table both gains and loses
  columns - it prompts "is this a rename?" and dies with `Interactive prompts
  require a TTY` under a piped shell. Split the change into two generates
  (add first, drop second) instead. Migrations are append-only anyway.
- **`PRAGMA foreign_keys` is a no-op inside a transaction**, and the migration
  runner wraps each migration in one. The `PRAGMA foreign_keys=OFF` that
  drizzle-kit puts around a table rebuild therefore does nothing. That was
  harmless only while `template_exercises` was the rebuilt table, since nothing
  references it. **Migration 0004 rebuilds `exercises`, a parent**, and
  `DROP TABLE exercises` with rows in `sets`, `template_exercises` and
  `exercise_aliases` fails outright with `SQLITE_CONSTRAINT_FOREIGNKEY`.
- **`PRAGMA defer_foreign_keys` does NOT rescue that.** Measured directly: the
  pragma reads back as `1` inside the transaction and the `DROP` still fails,
  because the implicit `DELETE` a `DROP TABLE` performs is checked immediately
  whatever the deferral setting. A fix that relied on it looked plausible and
  did not work.
  → The runner now sets `PRAGMA foreign_keys = OFF` **outside** the transaction
  and restores it in a `finally`, which is SQLite's documented table-rebuild
  procedure. The guarantee is kept by running **`PRAGMA foreign_key_check`
  inside each migration before it commits**, so a migration that genuinely
  orphans a row still fails and rolls back. Both directions are covered by
  `migrations.test.ts`.
- **Module side effects bite.** `scripts/migrate.ts` ran a migration merely by
  being imported, holding the DB open and causing `EBUSY` on delete. CLI entry
  points are now guarded with `import.meta.url === pathToFileURL(argv[1]).href`.

---

## How Progression does it (measured)

Inspected live with its timer running. This settled the architecture question
and **reversed an earlier recommendation.**

This section is about **process architecture**. The reference app's **UI and
run-a-workout flow** were measured separately on 2026-08-09 and live in
`docs/PROGRESSION.md` - pager instead of a tap strip, pre-created set slots,
positionally aligned history, a drag-scrub with a configurable increment, an
inventory-aware plate calculator, and the exact palette.

| Component | Evidence |
|---|---|
| Foreground service | `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_SPECIAL_USE`, granted |
| Overlay bubble | `SYSTEM_ALERT_WINDOW` appop `allow` (running); live overlay window separate from its MainActivity |
| Exact alarms | `SCHEDULE_EXACT_ALARM` declared |
| Vibration / wake | `VIBRATE`, `WAKE_LOCK` granted |
| Notification | `channel=training`, importance 4, `ONGOING_EVENT\|NO_CLEAR\|FOREGROUND_SERVICE\|SILENT`, `category=workout` |

**The decisive detail: `android.showChronometer=false`.** Progression does not
use the OS chronometer. Its overlay draws the countdown itself, which is exactly
how it can turn red and count up past zero. A notification cannot do that.

**There is no cheap path to a floating bubble.** An earlier version of this plan
argued the promoted-ongoing chip made the overlay unnecessary. Wrong twice: the
chip does not work here, and the reference app does not use it either.

---

## Rest timer - DONE

| | |
|---|---|
| While resting | Floating bubble: dark circle, draining progress ring, `M:SS` |
| Last 5 seconds | Five full-strength pulses, one per second |
| At zero | One long 900 ms buzz |
| After zero | Turns **red** and counts **up** (`+0:39`) rather than vanishing |
| Bubble visibility | **Only when loadout is not in front.** In-app, the active-workout header will own the countdown. |
| Controls | `+30s` / `Skip` notification actions; drag and tap-to-open on the bubble |
| Starting | Automatic on `LOG SET` from `default_rest_s`. Never a separate tap. |

Verified transitions: start-while-open → no bubble; leave → bubble; return → no
bubble; leave again → bubble; Skip → gone. Haptics confirmed correct by feel.

### Implementation notes

- `RestTimerService` - `specialUse` foreground service, `START_STICKY`, 100 ms
  redraw tick. Foreground services are exempt from Doze, so no alarm is needed.
- `TimerOverlayView` - custom `View` in a `TYPE_APPLICATION_OVERLAY` window.
- `MainActivity.isForeground` is a **static flag the service reads directly**.
  Inferring foreground state from the *order* of lifecycle pings was wrong:
  starting a timer from inside the app flashed the bubble over the very screen
  already showing it.
- **Haptics are one waveform, not six alarms.** Six alarms would be the worst
  possible shape for Doze - `setExactAndAllowWhileIdle` throttles to roughly
  once per 9 minutes, and rests here are 110-250 s. One
  `VibrationEffect.createWaveform` plays the whole pattern from a single
  wake-up, so the throttle never applies.
- **Waveform gaps must subtract the pulse that precedes them.** Entries
  alternate `[wait, buzz, wait, buzz, …]` and every entry consumes real time, so
  a naive 1000 ms gap between 90 ms pulses drifts later every beat. Gap is
  `PULSE_INTERVAL_MS - PULSE_MS`. An offset bug (`lead - 4000` instead of
  `remaining - LEAD_IN_MS`) additionally started the pattern at t−4.
- Haptics run on their own `postDelayed`, not the redraw tick, so they do not
  inherit its jitter. Amplitude 255 throughout, `VibrationAttributes
  .USAGE_ALARM` (stronger than notification usage and not damped by the
  notification-vibration setting), with a `hasAmplitudeControl()` fallback.

**Still unverified:** whether the waveform plays with the screen off and pocketed.

---

## Next steps

**Where the plan is up to.** An approved ten-stage plan rebuilds the logging
screen around what `docs/PROGRESSION.md` measured. Stages 0 to 2 are **done and
verified on device**: the pre-migration backup, the palette, and all the pure
logic, repo and schema groundwork. **Stages 3 to 10 are the remaining work**,
and they are UI. They are listed below in place of the old item 1, which they
supersede.

Each stage is independently shippable. Prove each on the phone before starting
the next - screenshot before every tap.

3. **Docked entry bar.** Three regions: header, scrolling content, and a bottom
   bar that never moves. Tapping the number opens the keypad through
   `parseWeight` / `parseReps`; dragging a stepper scrubs through `scrubSteps`
   (40 CSS px per step, measured). **Check `windowSoftInputMode` in
   `AndroidManifest.xml` first** - it is the one thing here that could force a
   native change, and `@capacitor/keyboard` is the fix if the WebView does not
   resize. `--spacing-safe-b` already exists for the bottom padding.
4. **Pre-created set slots.** Derive slots from `targetSets` rather than
   appending chips: slot `i` renders `doneHere[i]` if present, else `Set i+1`.
   Per-slot Edit / Delete wired to `updateSet` / `deleteSet`. `Undo last set`
   disappears, becoming a special case of deleting the last slot. The
   progression cue stays exactly as is - it is ours, and the reference app has
   no counterpart.
5. **Swipe pager and aligned history.** Replace the tap strip with a CSS
   scroll-snap pager (`snap-x snap-mandatory`, no new dependency), syncing the
   index from an `IntersectionObserver` rather than a scroll handler. Keep a
   slim `3/11` in the header so position is never ambiguous. Render one card per
   session from the widened `recentPerformance`, and **highlight the row whose
   index matches the active slot** - the single highest-value detail found in
   the investigation.
6. **Rest timer as an app-bar pill**, replacing `RestBar.tsx`: draining fill
   while counting down, solid red counting up past zero, tap to skip. **Fix the
   cold-start gap here** - `restEndsAt` is React state, so a killed app loses
   the in-app countdown while the service keeps counting. Add a `state()` method
   to `RestTimerPlugin` returning the service's `endsAt` and read it on mount;
   the service already holds the value, so nothing needs persisting.
7. **Plate chips**, rendering `platesFor` above the entry fields and recomputing
   on every keystroke and scrub tick. Gated on `loading` being plate-loaded, so
   **populating `loading` and the `plate_inventory` / `app_settings` rows is
   part of this stage** - all three are empty today. See "How load is made up".
8. **The settings that matter in a gym**: `Increment (Weight)`, `Keep screen on
   while training`, a toggle for the overlay bubble, and rest `Vibrate` /
   `Sound`. Columns already exist in `app_settings`.
9. **Exercise picker.** `searchExercises` is written, tested and ordered by
   recency, so this is mostly UI: multi-select with a running count on the FAB,
   `Recently used` as the default section, muscle badges. Today an off-template
   lift cannot be recorded at all.
10. **Template editor.** The insight worth copying is **reuse**: the reference
    app mounts the same per-exercise editor in the live workout and in the
    template, which is what stops the two drifting. Add / remove / reorder,
    rep-range and rest editing. Must write `seedPlanTemplates`-shaped soft
    deletes, never hard ones, and must never re-read `plan.ts` at runtime or an
    edit is silently undone on next launch. Add `Replace` while here.

Then, still blocking cutover:

11. **Backups, and the cutover procedure itself.**
    - `VACUUM INTO` to a synced folder on launch and after each session, plus a
      manual export. App-private storage does not survive uninstall, which is
      the actual threat.
    - ~~Device migrations take no backup.~~ **Done and verified on device.**
      `src/db/backup.ts` takes a `VACUUM INTO` copy before `open.ts` applies
      anything pending, named for the migration it is protecting against. It
      **fails closed**: if the plugin cannot report the database path, the app
      refuses to migrate rather than migrating unprotected. Note this guards
      against a bad migration, **not** against uninstall, since the copies sit
      in the same app-private directory. Nothing prunes them yet; they only
      appear when a migration is pending, so there will be few.
    - Write down the cutover itself: push the final imported database, verify
      counts on device, then stop re-importing forever. `npm run import` already
      refuses once any `sets.source = 'native'` row exists.
12. **Delete the spikes** - `src/ui/TimerSpike.tsx` and `src/ui/DbSmoke.tsx`,
    plus the `debug` toggle in `App.tsx`, once the logging loop owns the timer
    and the database. `DbSmoke` still earns its place until stage 6, since it is
    the only on-device proof of the window functions `recentPerformance` needs.

### Not blocking cutover

- Progression cue is currently advisory text only. It could pre-fill the next
  session's weight, which is the natural payoff of `shouldIncreaseLoad`.
- History / progress views. Nothing reads the five years back yet except the
  last-session panel.
- `npm run dev` in the browser runs against an empty jeep-sqlite database. Some
  seed path would make UI work possible without a phone attached.

### Phase-1 details already settled

- Default unit **lb**; steppers ±5 / ±2.5 / ±1 rep. **Open question from the
  investigation:** the reference app gets by with a *single* configurable
  increment because the drag-scrub makes distance cheap and the keypad makes
  precision cheap. The measurement behind the pair still stands (5,793 of 5,866
  weighted sets are whole pounds), but the secondary button may simply not be
  needed once stage 3 lands. Decide with a thumb, not a table.
- Only `load_mode` is needed at import, and only for 4 exercises - a five-minute
  file. `modality`, `primary_muscle`, `loading` stay nullable and get filled in
  lazily. `primary_muscle` is now 83 of 87; `modality` and `loading` are still
  empty, and stage 7 needs `loading`.
- Vitest for tests; `db/*` and `Examples/` gitignored
- App id `com.groenewold.loadout` - baked in at `cap init`; changing it orphans
  the on-device database

---

## Deferred / open

- **Base weights parsed out of `Set Comment`** - ~67 rows carry a plate
  breakdown, ~30 an explicit machine base across four values (100/55/20/15 lb).
- **Alias adjudication.** Only one real rename exists: `Dumbbell Shoulder Press`
  → `(Seated)`. Do **not** merge `Machine Calf Raise`/`(Seated)`,
  `Barbell Shoulder Press`/`Strict Barbell Press`, or
  `Dumbbell Hammer Curl`/`Incline Dumbbell Hammer Curl` - the short-lived name
  sits inside the span of the long-lived one, so they are distinct exercises.
- **Per-exercise metadata** for all 86 (modality, primary muscle).
- **Import report as a product**, with a golden-file snapshot test over a
  redacted fixture cut as whole sessions (random rows destroy superset
  interleaving).
- **Strava import** into `external_activities`.
- **`.progressionbackup`** - taking the CSV as the only source, so no superset
  interleaving detector; the 12 candidate sessions get reported instead.
- **PR / e1RM model.** Epley is wrong at reps=1 (141 rows) and unreliable above
  ~10 reps (844 rows), and is incoherent for duration/distance work. PR
  detection branches per `tracking_type` and inverts for `assistance`.

### Data safety

- `Examples/` and `/db/` are gitignored. `Examples/` holds the **only copy** of
  the source export and contains medical notes and a named third party. A
  narrower pattern than `/db/` previously let `loadout.sqlite-shm` through -
  verify with `git check-ignore -v` after touching ignore rules.
- Migrations are numbered and never edited once applied. **Both runners take a
  copy first**: `scripts/migrate.ts` copies the file on the laptop, and
  `src/db/backup.ts` runs `VACUUM INTO` on device before `open.ts` applies
  anything. The device half was missing until 2026-08-09; an older version of
  this document claimed the plugin's `addUpgradeStatement` covered it, which was
  never true once we took over migrations. Neither survives uninstall - that is
  the separate synced-folder export, still open.
- The device database must never be committed or packaged as an Android asset.
  `sets.notes` carries the medical notes from `Set Comment`, and `android/` is
  tracked. It stays in gitignored `db/` and reaches the phone over `adb`.
- `npm run import` refuses to run once any `sets.source = 'native'` row exists.
  **Cutover is one-way.**
