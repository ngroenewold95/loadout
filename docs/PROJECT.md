# loadout - plan, findings, next steps

Living document, and the handoff point for a cold start. Anything stated as
fact was **measured**; anything unverified says so explicitly. Update it when
something is *learned*, not when something is planned.

Last updated: 2026-09-23 (README rewritten for a public audience. Before that,
2026-09-01: stages 23 to 34 - the demo batch - built with the phone disconnected
and then **verified on device in one session**, which found two calendar faults
and fixed them. Stage 22, the fabricated demo database, was dropped: the demo
runs on the real data. Warm-up sets and stall detection landed the same day and
are **still unverified on device**.)

---

## What this is

Personal Android workout logger replacing Progression. Single user, offline
first, no server, no sync. Imports ~5 years of history.

**The constraint that decides everything:** logging a set must take about two
taps. A better data model does not compensate for a slower logging loop.

**Cold start, in reading order:** this section, then "Current state" for what
exists, "Decisions" for what may not be revisited cheaply, "File map" for where
things live, "Dev loop" for the commands, and "Where to pick this up" under
Next steps for what to do first. Everything between is the record of how each
piece was proved, and is worth reading before changing that piece.

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
- `npm run import` - 6,206 sets / 343 sessions / 87 exercises, **total volume
  7,543,590 lb matching exactly** between CSV and DB (round-trips 5,866 weights
  through lb→kg→lb, so the conversion is verified against real data)
- Per-exercise rest seeded from actual history; **templates seeded from the
  current programme** (see Programme below)
- **Repo layer complete and verified on device.** One `Db` interface, two
  backends, all queries in `src/db/repo.ts`
- **Rest timer complete**: floating overlay bubble, red count-up past zero,
  5-second haptic countdown, hides while the app is in front
- **Logging loop working on device against the real imported history** - home,
  A/B rotation, prefill, LOG SET, rest, correcting a set, resume, progression cue
- **Backups before device migrations, verified on device.** The runner took its
  own `VACUUM INTO` copy, then applied 0003 and 0004 across the Capacitor
  bridge, leaving the full history intact with zero foreign key
  violations and enforcement restored. See Corrections for the two faults this
  shook out.
- **Palette adopted from the reference app** (`docs/PROGRESSION.md`), with
  muscle-group badges giving an exercise one identity everywhere
- **Docked entry bar, verified on device** - three regions, and the scrub and
  keypad both work. See below.
- **Navigation stack and system back, verified on device.** Back arrow, the
  Android edge-swipe gesture and exiting from the root all confirmed. See below.
- **Weight beside reps in the entry bar, verified on device** - one row, stacked
  handles, all four taps and five drags re-measured. See below.
- **Pre-created set slots, verified on device** - sets listed before they are
  performed, any of them correctable or deletable in the entry bar. See below.
- **Swipe pager and aligned history, verified on device** - one page per
  exercise, three past sessions stacked as cards, and the row matching the set
  you are about to do is lit. See below.
- **Auto-advance and the summary screen, verified on device.** See below.
- **Session plan snapshot, picker and a real `Add set`, verified on device** -
  migration 0005, and a workout can now be edited without touching the
  programme. See below.
- **Rest timer as an app-bar pill, verified on device**, including recovering
  the countdown after the WebView was destroyed mid-rest. See below.
- **A browser dev seed**, so `npm run dev` opens with fabricated history instead
  of an empty database. See below.
- **Workout overview screen, verified on device** - the workout is a list you
  back out to and jump from, Home no longer starts a session on a tap, and the
  exercise identity is a colour rail and the group's name rather than a
  lettered circle. See below.
- **History rows load into the entry bar, and the rest pill has an editor**,
  both verified on device. See below.
- **Home shows history, verified on device** - the five years are reachable, and
  the stats say what to add load to rather than how much has been lifted. See
  below.
- **Exercise library and detail screen, verified on device** - guidance, totals
  and every session of one exercise, with assistance inverted. Migration 0006.
  See below.
- **Template editor, verified on device** - the programme is editable in the
  app, and the edits survive a force-stop. See below.
- **Plate chips, verified on device** - `platesFor` finally has a caller, and
  `LOG SET` does not move when they appear. See below.
- **The gym settings, verified on device** - increment, keep screen on, and the
  three rest-timer toggles, all in SQLite. See below.
- **Synced-folder export, verified on device including uninstall.** See below.

Everything that was built and wired to nothing is now wired: `platesFor` has a
caller, `app_settings` and `plate_inventory` are seeded, and `exercises.loading`
/ `modality` / `default_increment_kg` all have both a writer and a reader.

- **Mid-workout reachability, progression prefill, the assisted split and the
  first chart, all verified on device** (2026-08-26). Stages 17 to 20 were built
  in one batch with the phone disconnected and then proved in a single session
  of 17 checks. See below.
- **The demo batch, verified on device** (2026-09-01). Stages 23 to 34, built
  with the phone disconnected and proved in one session of ten checks:
  - a live workout no longer counts as the last time a template was done
  - a best set with its date, out of the series the chart already draws, so
    bodyweight work reads `MOST REPS` instead of a dash
  - the summary lists every set, counts reps, says how it went against the last
    time that workout was done, and copies the whole thing to the clipboard
  - notes on a workout and on a set, the first writers those columns have had
  - Home carries a volume trend and weekly muscle columns
  - a year of training as a calendar, one square a day
  - an exercise added by hand inherits the workout's set count, so
    auto-advance no longer returns to it forever
  - a launcher icon and splash of our own, rendered by `scripts/make-icons.mjs`
  See "Stages 24 to 34" below for what was measured.
- **Warm-up sets and stall detection, built 2026-09-01 but NOT yet verified on
  device.** Both are proved by tests only, and are the first thing to check in
  the next device session:
  - `set_type` finally has a writer, a toggle in the entry bar's edit row. A
    warm-up leaves the target, the totals, the trend and the prefill alone, and
    still appears on the summary and in the share text marked `W`. The filter
    is `<> 'warmup'` everywhere and never `= 'working'`, because all 6,209
    imported rows are `unknown`.
  - `stallOf` reads the same series `bestOf` does, so assistance inverts for
    free. N = 3 sessions, **chosen rather than measured**; too little history
    answers `null`. It renders on the exercise detail screen and costs no new
    query. `exerciseSessionsFor` batches the same rows for many exercises, for
    putting this on Home next.
- 343 tests passing, typecheck and lint clean

Not built yet: deleting the spikes, which is now stage 21 and runs immediately
before the cutover. **The cutover itself has not been performed** - the device
database is still disposable, and the user is logging in Progression in tandem,
so `npm run import` still works and the phone can be re-pushed freely.

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
just no longer the template.** Encoded as `src/logic/plan.ts`.

**Source changed on 2026-08-13: the app, not `Examples/Plan.md`.** The written
plan was what `plan.ts` had been typed from, and it was never checked against
what Progression was actually running. The `.pgnbkp` backup made that check
possible and it failed - see the correction below. `npm run analyze:backup`
prints the live programme, and that print is now the thing `plan.ts` must
agree with.

**`Examples/Plan.md` was then rewritten from `plan.ts`**, so the written plan
and the app now say the same thing and the document says outright that it
follows the app. It carries the per-exercise rests, marked measured for Day B and
inferred for Day A, rather than the three bands it used to state and the app
never used.

- **Two days, A/B rolling** - explicitly *not* pinned to weekdays. `nextTemplate`
  picks whichever template was performed least recently, so a missed week
  resumes rather than skips.
- **2 sets × 5-8 reps** throughout (6-10 on Pallof Press, the seated calf raise
  and face pulls; 10-15 on the standing calf raise).
- **Progression rule: top of the range on both sets → add load.** Encoded as
  `shouldIncreaseLoad`, pure and tested. This is why `target_reps` became
  `target_rep_min` / `target_rep_max` (migrations 0001-0002) - a single number
  cannot express the goal or decide the cue.
- **Rest is per exercise, not by band.** Day B carries explicit values in the
  app - 240 / 180 / 180 / 120 / 180 / 180 / 120 / 90 / 90 / 90 / 90 s - which
  three buckets cannot express, so `PlannedExercise.restS` holds seconds.
  **Day A has no rest set on any movement**, so Progression falls back to its
  global `restPeriod` of 120 s. That is not the intent for a Trap Bar Deadlift
  when the written plan says 3-5 min and the app's own RDL gets 240 s, so Day A
  is seeded from the old `REST_S` bands and `plan.ts` says in a comment that
  those values are **inferred rather than measured**. Either way these override
  the history-seeded per-exercise defaults on template rows, because history
  came from a different programme.

**20 of the 21 exercises already existed** with years of sets behind them, so
the last-session panel is populated from the first workout. Only `Pallof Press`
was created, and as of the 2026-08-13 export **it has history too** - two sets
on 2026-08-13 - so it now arrives from the CSV like everything else.
`NEW_EXERCISES` keeps it anyway, because `seedPlan` only creates what is
missing and a re-import against an older export still needs it.

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
   measured at **14.7 ms for 8 exercises** over the real 6,140-row database as it
   then stood.
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
| LOG SET | Set recorded, and `RestTimerService` starts as a *side effect* - confirmed in `dumpsys`, never a separate tap |
| Rest | Counts down in the app while the overlay bubble stays hidden. **Now the app-bar pill**, not the bar this row described. |
| Progression | After two sets at the top of the range: **"Top of the range on every set - add load next time."** |
| Resume | Cold start returns straight into the in-progress session |

Two rows of that table have since been overtaken by stage 6 and are written as
it is now, not as it was: LOG SET appended a **green chip** at the time, and
there was an **`Undo`** that enabled once a set existed and could only ever take
the tail. Slots replaced both. See "Set slots" below.

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

## Docked entry bar - DONE

Stage 3. Verified on device against the real history, screenshot before every
tap. `src/ui/EntryField.tsx` is the new piece; `ActiveSession.tsx` is now three
regions and `App.tsx` is `h-full` rather than `min-h-full` so the shell is
exactly the viewport and only the middle region scrolls.

**The unknown this stage existed to settle: `windowSoftInputMode` needs no
change, and `@capacitor/keyboard` is not needed.** The attribute is **absent**
from `AndroidManifest.xml`, so the activity runs at Android's default
`adjustUnspecified` - and measured on device, the WebView resizes anyway, so the
entry bar rides above the keypad and LOG SET stays fully reachable. Nothing
native was touched for this stage. (An earlier version of this paragraph also
claimed LOG SET sat at the *identical y* with the keypad open. It does not, and
could not - see Corrections.)

The layout-shift mis-tap is now structurally impossible rather than merely
unlikely. Logging a set makes the rest bar appear, which pushes the header down
about 190 px - and LOG SET does not move, because it is in a different region.
That is the exact failure `PROJECT.md` recorded, where a tap meant for LOG SET
hit *Finish workout*. `Finish` is also out of the entry area entirely now, a
small label in the header beside the `1/10` counter.

### Three ways to change a number, all measured on device

| Gesture | Measured |
|---|---|
| Tap a handle | 265 -> 260 on the `−5` handle |
| Drag up 500 px on `+5` | 225 -> 245, i.e. 4 steps |
| Drag up 500 px on `−5` | 245 -> 265, i.e. 4 steps, **not** −4 |
| Tap the number | numeric keypad with `.` `,` and `−`; typing 225 replaced the selected 355 |

`SCRUB_PX_PER_STEP` is 40 **CSS** px, and this screen renders at 2.625 device
px per CSS px, so a step costs ~105 device px against Progression's measured
~123. Close enough that it feels the same; the app is slightly more sensitive.

Two rules the measurements confirm:

- **Dragging up increases on either handle.** The handle's own sign only
  decides what a *tap* does. This is Progression's behaviour, where the two
  chevrons are one drag handle.
- **A drag too short to earn a step is still a tap.** `scrubSteps` truncates,
  so no step is emitted and the click handler runs normally. The 265 -> 260 tap
  above proves the suppression works in the other direction too: a real scrub
  emitted steps and its trailing click was swallowed rather than adding a
  spurious one.

### Decisions taken here

- **The secondary ±2.5 step button is gone.** `PROJECT.md` flagged the
  primary/secondary pair as an open question to settle "with a thumb, not a
  table", on the grounds that the scrub makes distance cheap and the keypad
  makes precision cheap. It could not be settled until the scrub existed. It
  now does, so this is the version to judge; `WEIGHT_STEPS[unit][1]` is still
  defined and restoring the row is a small edit if the thumb disagrees.
- ~~**The number and its unit are fixed-width columns.**~~ **Superseded in
  stage 5.** Letting the number take the free space left `lb` stranded against
  the `+5` handle, and fixed columns aligned the weight with the reps. The
  second half of that reason was about them being *stacked rows*; side by side
  there is nothing to align with, and a fixed column pushes `137.5` into the
  handles. The unit is still pinned beside the number, which is what the first
  half was really about.
- **The number is a `<label>`, not a bare `<input>`.** The full width between
  the handles opens the keypad, verified by tapping the empty space beside `lb`.
- **Focus selects the value**, so typing replaces rather than appends. Android
  puts a Cut/Copy/Select-all bar over the content while the selection lives; it
  disappears on the first keystroke, so it costs nothing during entry.
- The exercise strip moved into the pinned header. Navigation you have to
  scroll to reach is not navigation. **Stage 7 has since replaced it** with a
  pager, leaving the strip as badges only.
- `Undo last set` moved next to the set chips it removes and lost the word
  "last set". **Stage 6 deleted it outright**, as planned.

---

## Set slots - DONE

Stage 6. An exercise now opens with `Set 1` / `Set 2` already listed and
rewrites a row **in place** when one is completed, instead of showing nothing at
all until the first set landed and then appending a chip.

`updateSet` and `deleteSet` had been written and tested since the repo layer and
were wired to nothing. This stage is what connected them, which is why any set
can now be corrected rather than only the tail being undoable.

**The entry bar is the only number editor.** Tapping a filled slot points the
bar at that set: the scrub and the keypad correct it exactly as they enter a
fresh one. A modal editor was the alternative and was rejected twice over - the
codebase has **no dialog primitive at all**, so it would have been a component
built to be used once, and it would have been a second number editor free to
drift from the first. That is the same reuse argument stage 13 depends on for
the template editor.

`Cancel` and `Delete set` sit **above** the primary button, not beside it. The
bar is docked, so growing it moves its top edge and leaves the primary exactly
where `LOG SET` was - measured, `SAVE` lands on the same y. It also keeps the
destructive action away from the button a thumb is aiming for, which is the
lesson from the mis-tap that landed on *Finish workout*.

`Undo` is gone. Deleting the last slot is the same action, and any other slot
can be corrected too, which `Undo` never allowed. `undoLastSet` stays in
`repo.ts` because `DbSmoke` still runs it as one of its on-device checks.

### Measured on device, screenshot before every tap

| Step | Measured |
|---|---|
| Open cold | `Set 1` and `Set 2` listed with nothing logged, badge 1 lit, header `2 × 5-8 · 0/2 sets · rest 4:00` |
| Log a set | Slot 1 rewrote **in place** to `355 × 8`, lit badge moved to slot 2, no chip appended |
| Log the second | `2/2 sets`, and a dashed slot 3 appeared with a lit badge |
| Tap slot 1 | Ringed, `SAVE` at the **same y** `LOG SET` was, and slot 3's badge went muted |
| Step −5 twice, save | Slot 1 became `345 × 8`, slot 2 untouched at `355 × 8` |
| Delete slot 1 | The survivor **renumbered to slot 1**, not left at slot 2 |
| Process death, reopen | Slot 1 `355 × 8`, slot 2 active, `1/2 sets` |

The delete is the step that could only be proved here: the renumbering is a
`ROW_NUMBER()` window function running on the device's own SQLite.

### `beyondTarget` is not a slot state, and the tests said so

The first draft had `extra` as a member of the state enum, beside `active` and
`pending`. Both failing tests pointed at the same thing: once the target is met,
the trailing slot is **both** where the next set lands and beyond the target,
and whichever value won, the other fact was lost. Two orthogonal questions, so
two fields. It also lets a *filled* slot record that it was an extra set, which
the single enum could never express.

Confirmed on the phone, where slot 3 renders lit **and** dashed at once.

Two smaller rules the tests pinned down:

- **`targetSets` is nullable, and null is not zero.** Zero slots would mean an
  exercise with no target could never be logged at all. Null also means nothing
  can be `beyondTarget`, since no target was set for anything to be beyond.
- **An `editingSetId` that matches no performed set is ignored**, or a stale
  edit target left over from another exercise would swallow the active slot and
  leave nowhere for the next set to go.

`slotCount` is `max(targetSets ?? 0, done + 1)`. The `+ 1` keeps one empty slot
on screen at all times, so `LOG SET` always has a visible destination.

**An unperformed slot reads its rep target**, `5-8 reps`, not a placeholder.
Taken from the reference app after the first version shipped a bare `-` and the
obvious question came back: how do I add a set. The row should say what it is
asking for while you are aiming at it.

### What this stage got wrong, and stage 9 owes

The trailing slot model is **not** what the reference app does, re-measured on
2026-08-13 (see `docs/PROGRESSION.md`). Progression has a real `Add set` row
that **raises the target**: `0/2 Sets done` becomes `0/3`. Extra sets are
declared before they are performed, so the fraction stays meaningful.

Ours lets extras just happen and the denominator never moves, which gives the
self-contradictory `2/2` with a dashed slot hanging underneath. That was a known
worry when the slot states were designed and it was called wrong.

It was not fixed here because it could not be: `targetSets` came from
`template_exercises`, so raising it would have **edited the programme**, which is
exactly the fault `session_exercises` exists to fix. Holding the count in
component state instead would give a planned set that vanishes on process death,
and surviving process death is something this app already gets right.

**Stage 9 has since delivered it**, and `2/2` above a dashed slot is gone. The
trailing dashed slot remains for the honest case it was always right about: a set
nobody planned, logged anyway.

---

## Swipe pager and aligned history - DONE

Stage 7. The tap strip is gone: region 2 is now a scroll-snap pager holding one
page per exercise, each with its own vertical scroller, so the three regions
survive intact. `src/ui/HistoryCard.tsx` is the new piece.

**The one detail worth the whole stage**, taken from `docs/PROGRESSION.md`:
below today's slots sit up to three past sessions as numbered rows, and **the
row matching the set you are about to do is lit**. Confirmed on device - on set
1 the `1` badge is lit in every card; after logging set 1 the highlight moved to
`2` in all three at once. `recentPerformance` had been widened to three sessions
since the repo layer and only `[0]` was ever read; this is what reads the rest.

### Measured on device

| | |
|---|---|
| Swipe left | 2/10 -> 3/10, header, badges and entry bar all follow |
| Three cards | `2026-07-19 · 25 days ago`, `2026-06-30 · 44 days ago`, `2026-06-24 · 2 months ago` |
| Log a set | the lit history row moved from `1` to `2` in every card |
| **Left-edge swipe** | **exits to the launcher** - `NexusLauncherActivity` |

**The pager does NOT swallow the system back gesture**, which was the open
question this stage carried. The edge swipe went to the system, so no
`systemGestureExclusionRects` and no native change were needed. Recorded because
the opposite result would have meant native work.

### What is left of the strip

Badges only, no names. The strip was 11 text chips asking for an accurate tap
while the layout moved; the pager is how you move between exercises now, so the
strip is a position indicator first. It stays tappable because swiping from
exercise 1 to exercise 9 is eight gestures and one tap. A `+` at its end opens
the picker.

**Known rough edge:** with 10 exercises the `+` is off the right of the strip and
has to be scrolled to.

### Two things the implementation had to get right

- **The observer must not fight the index.** Sync comes from an
  `IntersectionObserver` rather than a scroll handler, so the header does not
  flicker mid-swipe. There is no "is this programmatic" flag: the effect that
  scrolls the pager checks the position first, so when the observer set the
  index because the user swiped there, nothing is issued.
- **The pager is positioned in a LAYOUT effect, before the observer registers.**
  Otherwise the observer fires against page 0 on mount and resets the restored
  index - a real race, not a hypothetical one, since the index is now restored
  from a store.

---

## Auto-advance and the summary - DONE

Stage 8. Logging the last set of an exercise moves to the **next incomplete**
one, not `index + 1`, so going back to add a set does not trap you at the end.
When nothing is incomplete, the summary opens instead.

`Finish` no longer ends the session - it opens the summary. **The summary is not
a save**: every set was written when it was logged, which is why the button says
`Finish workout` and why backing out of the screen discards nothing.

`nextIncompleteIndex` and `sessionTotals` are pure and tested.
**`sessionTotals` excludes `load_mode = 'assistance'` from volume rather than
adding it**: 420 imported sets record assistance, where a higher number is an
*easier* set, so summing them would make progress read as decline. The set is
still counted; only the volume leaves it out.

**`Discard workout` confirms with a second tap on the same button**, not a
dialog. There is still no dialog primitive in the codebase and stage 6 already
turned down building one to be used once.

### Measured on device

| Step | Measured |
|---|---|
| Log the set that completes an exercise | advanced 1/10 -> 2/10, pager scrolled, first badge dimmed, prefilled 130 lb from that exercise's own history |
| `Finish` | summary: `Day A - Trap Bar`, `2026-08-13 · today`, duration `7:39`, sets `2`, volume `5680 lb` |
| Volume check | 355 lb × 8 × 2 sets = 5,680 lb exactly |
| Duration | live - `7:39` on open, `8:42` a minute later |
| `Discard workout` | first tap relabels it `Tap again to discard` |

### What this shook out: a pushed screen resets the screen below it

`nav.ts` recorded that a pushed screen unmounts the one below it and flagged the
first push from inside a live workout as where that had to be reconsidered. It
happened here, and it was visible: `Back to workout` returned to **exercise 1 of
10** rather than the exercise being performed, because the pager index was
`useState` inside `ActiveSession`.

Fixed by moving the index into `src/state/workout.ts`, **scoped to a session
id** so a stale index from yesterday cannot open a different template at
whatever page that one ended on. Re-measured after the fix: at 3/10, `Finish`,
`Back to workout`, still 3/10, with no visible scroll animation.

The entry draft is still lost on a push. Nothing pushes from mid-entry yet, so
this is recorded rather than solved.

---

## Session plan snapshot, picker, `Add set` - DONE

Stage 9, and migration 0005. `ActiveSession` used to read its exercise list
straight from `template_exercises`, so editing a workout in progress would have
silently rewritten the programme. `session_exercises` is a copy taken by
`startSession`, and every edit writes there.

It is also what makes a real `Add set` possible: raising the target needs a
per-session number to increment, which is exactly what stage 6 said it lacked.

**Migration 0005 backfills the workout that was already in progress**, because
`startSession` is what fills the table and that session started before the table
existed. Only live sessions: nothing renders an exercise list for a finished one,
so copying rows for all 343 would be work no query does. `rest_s` is resolved
through the exercise default on copy, in both the migration and `startSession` -
a snapshot storing null would re-resolve later against a changed default, which
is the opposite of what a snapshot is for.

### Measured on device

| Step | Measured |
|---|---|
| After 0005 | **the screen is identical** - that is the pass condition for the read swap |
| Backfill | 10 rows for session 340, right order, `target_sets` 2, `rest_s` resolved to 240 |
| `Add set` | `2 × 5-8 · 2/2 sets` became `3 × 5-8 · 2/3 sets`, and the dashed extra slot became a planned one |
| Again | `2/4`, with an `×` on the pending slot and none on the active one |
| Tap the `×` | back to `2/3` |
| Picker | 87 exercises by recency with real counts (`22 days ago · 249 sets`); anything already in the workout is dimmed and disabled |
| Add | appended at `order_index` 10, no rep target, rest from the exercise's own default |
| `Remove` on the exercise in view | 2/11 -> 2/10, list closed up, no crash - the index clamp working |

**The self-contradictory `2/2` with a dashed slot hanging under it is gone**,
which is the thing stage 6 called wrong and could not fix.

### Decisions taken here

- **The active slot cannot be un-planned.** It is where the next set lands, and
  removing it would leave `LOG SET` with nowhere to put anything. Only a
  *pending* unperformed slot carries the `×`.
- **Lowering the target is clamped at the sets already performed**, or the header
  would read `3/2`. The sets are facts; the target is only the intention.
- **Removing an exercise keeps the sets already logged against it.** They were
  performed, and a plan change is not a reason to lose a fact. The summary reads
  `sets`, so they still appear there.
- **Reorder rewrites the whole list from zero** rather than swapping two rows. A
  pairwise swap has to read the neighbour first, and two racing would leave two
  rows sharing an `order_index`.
- **An added exercise gets no rep target**, so `setSlots` treats it as open and
  it can never be wrongly declared complete. The consequence, which is a real
  rough edge: it is never "complete", so **auto-advance keeps returning to it**
  and only `Finish` ends the workout.

~~**Not verified by tapping:** `Replace`, `Move earlier` and `Move later`.~~
**All three have now been tapped on the phone**, in stage 11a, from the
overview's exercise menu rather than from the logging screen. See "Workout
overview".

---

## Entry bar, weight beside reps - DONE

Stage 5. The handles no longer flank the number; they stack into one column
beside it, so weight and reps sit on **one row** in the order they are spoken,
"355 for 8". The two numbers you are about to log are read together, and stacked
they were two glances and about 130 px of screen. The row is roughly 100 px.

Layout only. `scrubSteps`, `SCRUB_PX_PER_STEP` and every rule the stage 3
measurements established are untouched, and the table below re-proves them in
the new geometry.

### Measured on device, screenshot before every tap

| Gesture | Measured |
|---|---|
| Tap `−5` on weight | 355 -> 350 |
| Tap `+1` on reps | 8 -> 9 |
| Drag up 500 device px on `−5` | 350 -> 370, i.e. **+4 steps, not −4** |
| Drag up 500 device px on `+5` | 370 -> 390, i.e. +4 steps |
| Drag down 300 device px on `+5` | 390 -> 380, i.e. −2 steps |
| Tap the number | keypad with `.` `,` and `−`; the value arrives selected, and typing 225 replaced 380 |
| Back with the keypad open | closes the keypad and stays in the app; the IME consumes it before the nav listener sees it |

The 300 px drag is the truncation rule proving itself: 300 device px is 114 CSS
px, which is 2.86 steps, and 2 steps were emitted. None of the five drags added
a spurious tap on release.

### Decisions taken here

- **The handles are `size-tap`, 48 px, down from about 64x60.** That is
  Android's own minimum and there is no room below it, since the whole point of
  the row is that two handles fit beside two numbers.
- **They are `bg-muted`, not `bg-surface-3`.** They sit ON the field now rather
  than on the entry bar, and `#272a32` against the field's `#282c38` is not a
  step at all - looked at on the phone, the first version read as floating text
  rather than as buttons. The reference app is no help here: its steppers are
  bare chevrons with no fill to measure.
- **Each field carries a `bg-field` box.** `--color-field` had been defined from
  the Progression histograms and used nowhere. Side by side, "which number is
  which" has to be answerable without reading the unit.
- **Plus above minus**, the way a stepper reads.
- Duration keeps a row of its own. It never coexists with reps, so pairing it
  with the weight would leave a lopsided row.

---

## Navigation shell - DONE

Stage 4 of the resequenced plan, and the foundation the summary screen, the
picker, the library and the template editor all sit on. Before it there was no
navigation at all: `App.tsx` chose Home or ActiveSession from a query result and
the debug spikes were a boolean.

`src/state/nav.ts` is a zustand stack. `zustand` had been a dependency since the
first commit and was **entirely unused**; a router was the obvious alternative
and is not worth it with no URLs, no deep links and no server.

Three properties, each of which a `screen` enum plus `useState` would not have:

- **The root is not on the stack.** An empty stack means "wherever the app would
  start", which is Home or the resumed workout depending on the database, not
  somewhere anyone navigated to. Resuming into a workout on cold start therefore
  cannot leave a phantom entry behind the back arrow.
- **`back()` returns whether it popped.** That is exactly the question the
  Android back button has to answer, since the alternative to popping is leaving
  the app and only the caller can decide that.
- **It lives outside React**, so the back listener registers once and reads
  `getState()` rather than closing over a stack that was current when the app
  started.

### Measured on device

| Gesture | Result |
|---|---|
| Tap `debug` at the root | pushes; header swaps the wordmark for a back arrow and the title `Debug` |
| Left-edge swipe on a pushed screen | pops, back to the resumed workout |
| Left-edge swipe at the root | **exits to the launcher** - confirmed as `topResumedActivity=...NexusLauncherActivity` |
| Tap the back arrow | pops, same as the gesture |

`@capacitor/app` is what delivers the event. **On Android 10+ the edge swipe and
the old three-button back arrive as the same `backButton` event**, so there is
nothing gesture-specific to handle and no extra listener. Registering any
`backButton` listener **replaces** Capacitor's default handling rather than
running alongside it, so leaving the app became ours to do explicitly with
`App.exitApp()`.

**A pushed screen unmounts the one below it.** That was flagged here as
something to reconsider at the first push from inside a live workout, because
unmounting the logging screen throws away a half-typed entry draft.
**Settled in stage 11a**, and not by keeping the screen mounted: the logging
screen is itself pushed now, so it is unmounted routinely, and the draft moved
into `state/workout.ts` beside the pager index and the rest. `display: none` was
never the easy answer anyway - Chrome resets `scrollTop` when an element is
hidden that way, which would lose the history scroller's position.

### What the first test found

`replace` at the root **pushed instead of replacing**. `[...[].slice(0, -1), x]`
is `[x]`, so replacing on an empty stack inserted a screen, giving the root a
back arrow with nothing behind it. Caught by the second test written, before the
function had any caller. The guard is a length check and the comment on it says
why, because the expression looks correct.

---

## Workout overview - DONE

Stage 11a, and a shape change rather than a feature. `Start workout` used to
drop straight into exercise 1 of 10, and moving between exercises was a swipe or
an accurate tap on a strip of 20 px coloured circles. The workout is now a
**list you back out to and jump from**: `WorkoutOverview.tsx` is the root while
a session is live, and `ExerciseView.tsx` - what `ActiveSession.tsx` was - is
pushed from it.

**The badge strip is gone, and with it two faults measured on device.** Tapping
a badge more than one exercise away snapped back, because the smooth scroll it
started dragged intermediate pages through the `IntersectionObserver` and the
index effect re-targeted the scroll at one of them; and the ring around the
selected badge was clipped, because a horizontally scrolling container clips on
both axes. Both were the same mistake - a small moving target asked to act as
navigation - and neither needed fixing once the target was gone. In its place is
a segmented progress bar, one segment per exercise, filled as sets are logged
and lit for the one in view. **Nothing on it is tappable.**

**Home no longer starts a workout on a tap.** Tapping a template pushes a
read-only preview carrying `Start workout`, so the commitment is its own
deliberate tap. Read-only because there is nothing to write to: `session_exercises`
is a snapshot `startSession` takes, so an edit before the start would either
have no home or would edit the programme, which is the fault the snapshot exists
to prevent.

**Auto-advance stays.** Logging the last set of an exercise still moves to the
next incomplete one rather than back to the list. The overview is available, not
compulsory; two taps per set is the constraint that decides everything.

**The entry draft now lives in `state/workout.ts`**, keyed by session and
exercise. `nav.ts` had flagged the first push from inside a live workout as
where the unmount-loses-a-half-typed-weight problem had to be faced; it is no
longer a first, because the exercise screen is itself pushed and every summary
and picker takes it down. Only a **touched** draft survives: a pristine one is
the prefill chain's own answer, which can go stale while the screen is away, so
it is re-seeded rather than restored.

### The exercise menu is an overlay, not an expanding card

The first version expanded the card in place. On the phone that was wrong twice:
every card below jumped down as it opened, and on the **last** card the menu
opened below the fold, so `Remove` had to be scrolled to. `ActionSheet.tsx` is
the fix - a bottom sheet, identical for the first card and the last, costing the
list no height.

`PROJECT.md` twice recorded turning down a dialog primitive as "a component
built to be used once". This is the third call site and the template editor is a
fourth, so it earns its place now - but it is a **menu**, not a confirm.
Destructive choices still confirm with a second tap in place, exactly as
`Discard workout` does.

**`back()` closes an overlay before it pops a screen.** Without that the first
back gesture after opening a menu would leave the workout entirely - and since
the overview is the *root*, `back()` would have reported false and the listener
would have called `exitApp()`. The sheet registers its closer in `nav.ts` and
clears it on unmount.

### Measured on device, screenshot before every tap

| Step | Measured |
|---|---|
| Home into a template | Preview, `Start workout` docked, **no session created** - proved by force-stop and relaunch landing on Home with both templates `not done yet` |
| Open exercise 9 of 10 from the list | Opens at 9/10, 9th segment lit, prefilled `90 lb × 7` from history. No snap-back |
| Change the weight, back out, re-open | `100 lb`, not the `90` prefill - the draft survived the unmount |
| Log a set | Slot 1 rewrote in place, `1/2 sets`, rest pill blue at 1:12, history highlight moved to row 2 in all three cards |
| Log the second | Auto-advanced 9/10 -> 10/10, pager scrolled, 9th segment filled and 10th lit |
| `Replace` from the card menu | Trap Bar Deadlift -> Machine Calf Raise (Seated), keeping the slot's `2 × 5-8` and `rest 4:00`. **First time tapped on the phone** - stage 9 left it repo-tested only |
| `Remove`, two taps | List closed from 10 to 9, no crash |
| `Move down` | Trap Bar Deadlift went from first to second. Also first tapped here |
| Menu on the **last** card | Sheet in the same place, fully visible, nothing scrolled |
| Back with the menu open | Sheet closed, workout still on screen, `topResumedActivity` still loadout |
| Rest past zero | Pill solid red, counting up - **`PROJECT.md` had this as never verified** |

---

## Entry bar and rest pill - DONE

Stage 11b, three small things the phone asked for.

**Tapping a history row loads it into the entry bar**, without logging anything
and without aiming the bar at that set - the button still reads `LOG SET`. A set
performed in July is a fact and is not editable from a card; what is being
reused is the numbers, which is the whole question the card is on screen to
answer. Today's own slots are unchanged: a tap there still aims the bar at that
set to correct it, so the same gesture never has two meanings.

**The rest pill's tap now depends on its state.** Counting down, it opens an
editor: `Add 30 seconds`, `Take off 30 seconds`, `Skip the rest`. Past zero it
**cancels**, which is the only thing left to want once the rest is over and the
pill is only still there because it never auto-dismisses. The reference app
skips on any tap; this differs deliberately, because a rest is a number you
adjust far more often than one you abandon, and a rest lost to a mistimed tap
cannot be recovered - the service has thrown it away.

`RestTimer.start` does the shifting in both directions rather than `extend`: it
takes an absolute end and a total, which is what the pill needs to keep its fill
honest, and extending by a negative number would be the same arithmetic through
a name that says the opposite. The end is clamped at `now`, so taking 30 s off a
12-second rest lands on zero rather than creating a rest that was already over.

**The entry bar is shorter.** Padding and type only - the 48 px handle does not
move, being Android's own minimum and the reason two of them fit beside two
numbers.

### Measured on device

| Step | Measured |
|---|---|
| Tap `90 × 8` in the 2026-07-22 card | Reps went 7 -> 8, weight unchanged at 90, button still `LOG SET` |
| `Add 30 seconds`, three taps 1 s apart | `totalMs` 222000 -> 251000 -> 280000, `endsAt` +30055 ms then +30080 ms |
| `Take off 30 seconds`, two taps | 219000 -> 188000, `endsAt` back 29946 ms |
| Shorten past zero | The sheet **closes itself** and the pill goes red, counting up from 0:05 |
| Tap the red pill | Rest cancelled, back to the idle alarm outline |
| Entry bar, `uiautomator dump` | `+5` handle **129 x 129 device px** (49 CSS, above the 48 minimum); `LOG SET` **160 px** tall, `[42,2157]-[1039,2317]` |

The `debug` link is gone from the app bar. The spikes are still reachable -
`DbSmoke` is the only on-device proof of the `DENSE_RANK` window function - but
by five taps on an unlabelled corner, the way Android's own build-number tap
works, rather than by a word anyone shown the app reads first.

### Two mistakes worth recording

**The rest editor's arithmetic was reported broken and was not.** `Add 30
seconds` appeared to run the clock *down*, 1:09 to 0:56 to 0:16. Every one of
those readings came from a separate `adb` round trip over wifi, each costing
several seconds, and they were compared as though they were instantaneous. Three
taps issued in a **single** `adb shell` invocation showed +30055 ms and +30080 ms,
which is correct. The lesson is the one this file keeps relearning, in a new
place: a measurement whose timing has not been controlled is not a measurement.

**What the same episode did find** is real, and is fixed: the sheet stayed open
when the rest passed zero, so it offered adjustments on an expired rest and its
title read `0:24 LEFT` for a rest that had finished 24 seconds earlier - the
pill's `Math.abs` display being shared with it. It now closes itself at zero.

**A mis-tap came back, from chaining blind taps.** Several `input tap` calls were
issued in one command without a screenshot between them; the first opened a
sheet, and the rest landed on `Skip the rest` and then on the weight field,
opening the keypad. `PROJECT.md` has recorded "screenshot before every tap" since
the first device session and it is not decoration.

---

## Exercise identity - DONE

A template is 21 names that mostly begin with "Machine" or "Cable", and reading
them under a bar is slow, so every exercise carries its muscle group wherever it
appears - overview card, picker, summary, exercise header.

**The mark is a colour rail and the group's name.** It was a coloured circle
carrying the group's initial, copied from the reference app, until the three
candidates were put on the phone side by side against both programme days on
2026-08-15. See "Choosing the identity mark" below for what that measured.

- `logic/exerciseMuscles.ts` maps **exact exercise name -> group** for all 87.
  A flat table, not a heuristic: `Machine Fly` is chest while `Machine Rear Delt
  Fly` is shoulders, and `Machine Leg Curl` and `Nordic Curl` are legs while
  every other `Curl` is biceps. No pattern survives those.
- `db/seedMuscles.ts` **only fills blanks**, so a hand correction or a future
  exercise editor survives a re-run. Safe to call on every launch.
- **83 of 87 classified.** The 4 blanks are deliberate: cardio and general
  mobility have no single primary group. They now render a neutral rail and
  **no word at all**, where the circle used to insist on a `?`. Guessing would
  defeat the point of the colour.
- Unmapped names are **reported, not thrown** - the import prints them, because
  the mark is cosmetic and should not fail a reconciling import.

**Found by looking at it on the phone:** the first `biceps` colour was a purple
chosen to sit beside `legs`, and at the 20 px strip size the two were barely
separable. They co-occur on **both** programme days, which is exactly when the
colour has to work. Biceps is now orange. The rule to keep: no two groups that
appear on the same day may be close in hue. Biceps was the one colour never
sampled from Progression, so changing it costs no measurement.

### Choosing the identity mark, measured 2026-08-15

Three candidates were built and rendered at their real sizes against both
programme days, behind `debug`, and the choice was made by looking. The harness
was deleted once it had answered.

| Candidate | What the phone showed |
|---|---|
| Coloured initial (the reference app's) | `Machine Calf Raise` maroon `C` sits four rows from `Chest Dip` red `C`. Two similar reds, the same letter, and the letter therefore says nothing |
| Body map: one figure, the worked region filled | Fails at row size, and not for the reason predicted. The grey figure is most of the mark and the lit region is a few pixels, so every row reads as "a small person". `Chest Dip` and `Machine Chest Press` are identical; legs vs calves needs a deliberate look |
| **Colour rail plus the group's name** | `Machine Preacher Curl` / `BICEPS`. Nothing to decode, nothing to collide, and the rail still gives the row a colour edge at a glance. **Chosen** |

Two things the comparison settled beyond the winner. **The letter was never the
identity** - Chest/Calves are both `C` and Back/Biceps both `B`, so the colour
was carrying it alone, which is why `biceps` had already had to be retuned once.
And the colour is worth keeping as a rail: it is the half that survives being
glanced at rather than read, and it is the half `docs/PROGRESSION.md` actually
measured. Saying the group outright also reaches anyone who cannot separate
these hues without going through a screen reader.

`muscleBadge` is now `muscleMark` and returns the group rather than a letter.
`MUSCLE_COLORS` is untouched, so nothing measured was lost.

---

## Home shows history - DONE

Stage 11c. The database held 343 sessions, 6,206 sets and five years of work,
and Home was **two template buttons**. It now carries what training has actually
been, and every finished session is reachable.

**Tapping a past workout opens the summary that already existed.** `SessionSummary`
took a `sessionId` rather than a live session from the day it was written and
hides its whole action bar once `ended_at_utc` is set, so no detail screen was
built for this. Confirmed on the phone against a 2026-08-13 session: no
`Finish workout`, no `Discard`, and its `14520 lb` matches the row that opened it.

### The stats are chosen to be acted on, not to be impressive

Volume was the obvious headline and is deliberately **one quiet line at the
bottom**. Ordering, top to bottom:

1. **Ready for more load**, the only actionable thing on the screen: the
   programme's own rule, `shouldIncreaseLoad`, run across the next workout's
   exercises. It says which, not how many, so the numbers can be decided at home
   rather than under a bar. Renders nothing when nothing earned it.
2. **Cadence** - `3 this week · 1.8 per week over 4 weeks · last trained today`.
   Weeks, not a day streak: the programme is A/B **rolling**, so a day count
   would punish the rest days it asks for.
3. **Muscle balance** over 28 days, as one stacked bar plus a legend.
4. **The lifetime line**, one row of small text.

**No PR, e1RM or strength score, deliberately.** Epley is wrong at reps=1 (141
rows), unreliable above ~10 reps (844 rows), incoherent for duration and distance
work, and inverts for `assistance`. That is a data model to be built and argued
about, not a tile to be slipped into a Home screen.

### Readiness is scoped twice, and the second scope was added on review

The first scope was there from the start: it considers **the next workout's
exercises**, not all 87. The second was added after the question was asked
directly - within those, it only counts a session from the **last 28 days**.

Without the window an exercise dropped from the programme months ago keeps
announcing that it earned more load, on the strength of a session nobody
remembers; and after a long enough layoff the old top of the range is not a claim
about what is possible today. Four weeks is the same window the muscle balance
uses, and at roughly two sessions a week it means a movement skipped for several
rotations stops being advice.

**On the current data the window changes nothing**, and that is worth saying
rather than dressing up: every one of the nine is from 2026-08-05 or 2026-08-10.
The filter is proved by `plan.test.ts`, which checks both sides of the boundary
date, not by the screen.

### `earnedIncreases` was checked against the rows, not trusted

`9 of 11 ready` looked like a bug and was not. Every one was verified against the
database rather than eyeballed:

- The Day B session of 2026-08-10 was `8 8` on seven exercises against a 5-8
  target, and `10 10` on the seated calf raise against 6-10. All earned.
- `Machine Preacher Curl` was `8 7` and is correctly **absent**.
- `Cable Face Pull` (`10 10`, max 10) and `Cable Crunch` (`8 8`, max 8) earned it
  in the 2026-08-05 session; `Cable Pushdown` was `8 6` and is absent.

**The pre-programme-switch caveat did not bite, and now has a measurement rather
than a worry.** The concern was that an exercise last performed before the
2026-08-08 switch would be judged against a rep ceiling the old programme never
had. The two exercises that reach back past the switch, Face Pull and Cable
Crunch, carried the same ceilings under both, so the answer is right either way.
If a future programme changes a range, this is where it would go wrong - and the
28-day window bounds how far back that can reach, without fixing it.

### Volume in SQL, and why the lifetime figure is not 7,543,590 lb

The tile reads **7.3M lb**, not the 7,543,590 lb the import reconciled. That is
correct and is the assistance rule doing its job: `7,259,720 lb` excluding
`load_mode = 'assistance'`, `7,543,590 lb` including it, verified directly
against the database. The reconciliation figure is CSV total volume and counts
assistance as though it were load.

Totalling a *list* of sessions cannot reuse `sessionTotals` - it would pull all
6,206 sets across the bridge - so volume exists as a SQL expression too. The two
are held together by a conformance test that runs both over the same rows,
including an assistance set and a bodyweight set, rather than by hoping they were
written the same way. `historyStats` is built from **scalar subqueries with no
join**, because joining sets to sessions repeats each session once per set and
would have multiplied every duration by the number of sets in it.

### Measured on device, screenshot before every tap

| Step | Measured |
|---|---|
| Finish a live workout | Home appeared with `344 workouts · 6,209 sets · 7.3M lb · 508 hours · since 2021-07-06`, up from 343 / 6,206 by exactly the test session |
| Cadence | `3 this week` - 08-10, 08-13, 08-15 against a Monday-start week beginning 08-10. `1.8 per week` is 7 sessions in 28 days over 4 |
| Muscle bar | `101 sets`: shoulders 20, legs 19, back 18, chest 16, biceps 12, abs 8, triceps 6, calves 2. No `other` bucket, because nothing unclassified was trained in the window |
| Recent | Five rows, newest first, `2026-08-13 · 2 days ago · 18 sets · 14520 lb · 1:34:40` |
| Tap a row | Summary opened with **no action bar**, volume matching the row |
| Back | Home, not a workout. `topResumedActivity` still loadout |
| `All workouts` | 25 rows, `Load more` extended it to 50 without losing the scroll position |
| Cold start | Force-stop and relaunch renders the whole screen with nothing in logcat |

---

## How load is made up - `loading`, bar weight, plates

**Built and rendering, as of stage 14** - see "Plate chips" below for what was
measured on the phone. This section is the design; it stays because it is the
part a cold start would otherwise re-derive wrongly.

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
- **The `.pgnbkp` backup does not corroborate the inventory.** Its
  `config.plateAvailability` holds two opaque plate uuids, both `0`, and ships
  no plate table to resolve them against, so it records overrides rather than
  stock. The list above rests on the calculator measurement alone. Saying so is
  the point: it would be easy to read the backup as authoritative and conclude
  the inventory is empty.
- An unreachable target is reported as a **remainder**, rendered as a visually
  distinct dashed chip, never rounded away. The number in the database is the
  one you typed either way, so a chip row that lies is worse than none.

**The arithmetic is in integer display units, not kg.** Accumulating quantised
kg drifts exactly as `units.ts` warns: a 170 lb bar came out one 2.5 lb plate
short because the running total landed 0.0001 kg under the plate it needed. A
plate is a display-unit object anyway - a 45 is 45 lb, not 20.4117 kg.

~~**Open:** the 730 lb machine press in the history needs 7x45 per side, which
the configured inventory of 8 cannot reach.~~ **Settled in stage 14**: the
denominations are the measured ones and the counts are seeded at 20 of each, so
a commercial gym is effectively unlimited while a genuinely unreachable weight
still reports a shortfall. Per-gym inventory is the follow-up if a home rack
ever becomes the constraint.

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

**Amended 2026-08-13: the port hunt is often unnecessary.** Starting a cold adb
daemon, the phone came back on its own as
`adb-2B221FDH2000NL-1EGCwi._adb-tls-connect._tcp` with no `adb connect` needed -
and the recorded port 37747 had in fact gone stale and was refused. So try
`adb devices -l` first and only go looking for a port if nothing appears.
Wireless debugging must still be switched on at the phone.

**Amended 2026-08-25: `offline` beside that mDNS name means re-pair, not
retry.** The entry appeared with `offline` through a daemon restart and an
explicit `adb connect`, and the pairing had simply lapsed. `adb pair
<ip>:<pairing-port> <code>` from the phone's own pairing dialog, then `adb
connect <ip>:<connect-port>` with the port off the main screen, and it came
straight back. Both ports change every time, so both have to be read off the
phone; nothing about them is worth writing down here.

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

**The device database is disposable until cutover, and may be reset at any time
without asking.** Stated by the user on 2026-08-13. Everything on the phone is
rebuildable: `db/for-device.sqlite` comes from `npm run import` over
`Examples/`, so a reset costs one push and loses nothing that is not
reproducible. Do not treat a phone full of test sets as a thing to preserve, and
do not carry status lines about it in this document - they go stale within the
hour and this paragraph replaced two that had.

**This inverts at cutover.** Once the real logging starts, the device holds the
only copy of everything logged natively, and `npm run import` already refuses to
run the moment any `sets.source = 'native'` row exists. Cutover is one-way. The
synced-folder export exists now, so that condition is met; what remains is
picking the folder on the phone and running the procedure below.

Reset with the push above. Verify by opening the app: Home with no in-progress
session, both templates showing `not done yet`.

The phone previously carried a **340-session** lineage rather than the canonical
339. A pre-0003 snapshot had been pushed back deliberately so the device's own
migration runner had to apply 0003 and 0004 itself rather than receiving an
already-migrated file, which is what made that verification real. That is done
and does not need repeating. Check which lineage you have from the
`__migrations.applied_at` timestamps: if they all fall within milliseconds of
each other, the file was migrated on the laptop and pushed, so the device path
was never exercised.

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
    slots.ts        the set rows an exercise shows, performed or not
    session.ts      nextIncompleteIndex, sessionTotals (assistance excluded,
                    reps included), groupByExercise, defaultTargetSets
    volume.ts       weeks and calendar days: weeklyVolume, periodOverPeriod,
                    calendarDays, muscleWeeks. Monday weeks, empty ones kept
    trend.ts        what a chart of one exercise is a chart OF, and bestOf
    dates.ts        daysBetween, relativeDay - "17 days ago"
    plates.ts       inventory-aware plate solver; the `loading` axis
    muscles.ts      the eight groups and their colours; muscleMark
    exerciseMuscles.ts  exact exercise name -> group, all 87
    exerciseGuidance.ts AUTHORED cues, the 21 programme lifts
    exerciseEquipment.ts modality / loading / base, only where proved
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
    seedExerciseGuidance.ts  fills blank guidance from the authored table
    seedExerciseEquipment.ts fills blank modality / loading / base weight
    seedDefaults.ts the app_settings row and the plate inventory, if absent
    seed.ts         every launch seeder in one place. NEVER seedPlanTemplates
    devSeed.ts      FABRICATED history, browser dev only, never the phone
    backup.ts       VACUUM INTO copy taken before device migrations
  Tests sit beside what they cover. Two carry their own weight:
    db/migrations.test.ts  migrates a database WITH ROWS IN IT - the only
                           thing that catches a parent-table rebuild failing
    logic/plates.test.ts   conformance against chip rows measured off the
                           reference app, not against an idea of a solver
  native/
    restTimer.ts    JS face of the rest-timer plugin
    screen.ts       keep the screen on while training
    backup.ts       the synced-folder export, and its daily throttle
  state/
    queries.ts      TanStack Query over the repo; keys and invalidation
    nav.ts          the screen stack; back() reports whether it popped, and
                    closes an open overlay before it pops anything
    workout.ts      pager index, rest and the entry draft - OUTSIDE the screens
                    that render them, because all three outlive a push
  ui/
    AppHeader.tsx   app bar; back arrow or the wordmark, and the rest pill
    Home.tsx        the two templates, then the stats and the recent workouts.
                    Opens a template; does NOT start it
    HomeStats.tsx   ready for more load, cadence, muscle balance, lifetime
    WorkoutHistory.tsx  past workouts as rows; Home's recent five and the
                    All workouts screen. Rows open the existing summary
    Stat.tsx        one labelled number in a tile, shared with the summary
    WorkoutOverview.tsx  the workout as a list, and the root while one is live.
                    Also renders a template read-only, before `Start workout`
    ExerciseView.tsx  THE LOGGING LOOP - header, pager, docked entry bar.
                    Pushed from the overview
    ExercisePage    (in ExerciseView) one exercise: slots, then history cards
    HistoryCard.tsx one past session, numbered rows, active row lit
    SessionSummary.tsx  what a workout added up to. NOT a save
    ExercisePicker.tsx  87 exercises by recency; add, or swap one out
    EntryField.tsx  one number: step buttons that are also the drag handle,
                    and the number itself as the keypad
    RestPill.tsx    the app-bar countdown; draining fill, red past zero
    ActionSheet.tsx a menu that floats over the screen instead of growing in it
    GroupTag.tsx    the identity: a colour rail, and the group said outright
    TimerSpike.tsx  throwaway harness for the timer - behind `debug`
    ExerciseLibrary.tsx  all 87, wrapping the picker; rows open the detail
    ExerciseDetail.tsx   guidance, totals and every session of one exercise
    ExercisePlanEditor.tsx  sets, reps and rest - the SAME editor in the
                    template and in the live workout
    PlateChips.tsx  what to load, above the entry fields. Dashed when short
    Settings.tsx    the handful of settings that matter under a bar
    setText.ts      how a performed set reads, in one place. `spoken` spells
                    the unit out, for text that leaves the app
    shareText.ts    a finished workout as plain text, pure and tested
    copyText.ts     the clipboard, with no plugin: the async API, then
                    execCommand as the fallback
    TrainingCalendar.tsx  a year of training, one square a day
    DbSmoke.tsx     throwaway on-device check of the db layer - same
scripts/
  import.ts         CSV -> SQLite, drop-and-rebuild, reconciliation
  migrate.ts        Node migration runner, backs up first
  profile.ts        format-agnostic CSV profiler
  analyze-backup.ts read-only reader for the .pgnbkp app backup; joins it to
                    the CSV to recover exercise names, then prints only
  add-strict.mjs    post-processes drizzle output to add STRICT
  make-icons.mjs    renders the launcher icon to PNG from its geometry. No
                    rasteriser exists here, so it is zlib and five rectangles
drizzle/            generated SQL migrations + journal
android/app/src/main/java/com/groenewold/loadout/
  MainActivity.java      registers plugins; owns the isForeground flag
  AppScreenPlugin.java   FLAG_KEEP_SCREEN_ON while a workout is live
  BackupPlugin.java      SAF folder pick, and the copy that survives uninstall
  RestTimerPlugin.java   JS-facing surface: start/extend/cancel/permissions
  RestTimerService.java  foreground service, overlay lifecycle, haptics
  TimerOverlayView.java  hand-drawn bubble: ring, M:SS, red count-up
design/icons/       the icon candidates, as SVG. `e12` is the one installed
Examples/           gitignored - the ONLY copy of the source export
db/                 gitignored - rebuildable until cutover
```

---

## Dev loop

```bash
npm run dev          # Vite dev server; seeds FABRICATED history if empty
npm run build        # tsc -b && vite build
npm run test         # vitest (343 tests)
npm run lint         # oxlint
npm run import       # rebuild db/ from the NEWEST Examples/*.csv; refuses after cutover
npm run profile      # profile any CSV's structure
npm run analyze:backup  # read the .pgnbkp app backup; --all for archived plans
npm run db:generate  # drizzle-kit generate + add STRICT
npm run db:migrate   # apply migrations to db/loadout.sqlite (backs up first)
node scripts/make-icons.mjs   # re-render the launcher icons from their geometry
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

### From the export (6,206 rows, 2021-07-06 → 2026-08-13)

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
  35 in `Workout Description`. Naive line-splitting gives 6,231 instead of 6,140, measured
  on the 2026-07-22 export.
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

### From the `.pgnbkp` backup (2026-08-13)

A second artefact arrived alongside the export:
`Examples/progression.2026-08-13_20-35-55.pgnbkp`. **Despite the extension it is
plain JSON** - Progression's whole app state, not the flat CSV. Read it with
`npm run analyze:backup`, which writes nothing.

Four top-level keys: `sessions[343]`, `exercises[36]`, `programs[11]`,
`profile`, `config`.

**It has no exercise names.** Every set names an `exerciseId`, and only the
user's own custom exercises appear in `exercises[]`; the built-in catalogue is
not in the file. So the analyser recovers the map by joining each performance to
the CSV on clock time, weight and reps. That resolves **6,198 of 6,206
performances and all 87 exercise ids, with zero ambiguities** - a name that two
ids both claim would be reported, and none is.

- **`completedAt` is a true epoch**, which the CSV's wall clock is not. The join
  needs both a -7 h and a -8 h offset to land (4,136 rows and 2,062), so the
  difference between the two files measures the daylight-saving offset in force
  on the day. `progression.ts` reads the CSV clock as UTC deliberately and this
  does not change that; it does mean a real local timeline is now derivable if
  one is ever wanted.
- **The 8 unmatched rows are the already-known corrupt session**, not a flaw in
  the join. They were performed on 2025-11-27 and the CSV files them under
  session `2025-12-02 15:55:55.154`, because `Date` is the session's *end* date
  and that session was left running 119 h. The analyser prints where the CSV put
  each one rather than dropping it.
- **Metadata coverage is 26 of 87, and that is the ceiling** on any future
  backfill of `exercises.loading` from this file. Those 26 carry `equipment`
  (`BARBELL`, `MACHINE`, `SMITH_MACHINE`, `DUMBBELL`, `KETTLEBELL`,
  `BODYWEIGHT`, `OTHER`) and `muscles`. The other 61 - every barbell lift, every
  cable movement, most machines - are built-ins and carry nothing.
- **`mark` is a per-set qualifier the CSV drops entirely**: 9 rows across five
  years, `FORCED` 4, `FAILURE` 3, `PARTIAL` 1, `NEGATIVE` 1. Small enough to
  ignore, but it is a column the export does not have at all, so it can only
  ever come from here.
- **The muscle table agrees.** Cross-checked against `exerciseMuscles.ts` for
  the 26: 23 agree, 2 disagree (`Back Strengthening` ours back vs theirs ABS,
  `Mobility` ours deliberately null vs theirs ABS) and 1 is not comparable
  (`Suitcase Carry` is FOREARMS, which is not one of our eight groups). Neither
  disagreement is worth acting on.
- **`profile.preferences` is the settings source** if `app_settings` is ever
  populated: `weightUnit POUNDS`, `step 5`, `restPeriod 120000`,
  `equipmentWeight 45` lb, `startRestAutomatically true`,
  `showPlateCalculator true`.
- **`config.plateAvailability` does NOT enumerate the inventory.** It holds two
  opaque plate uuids, both with count `0`, and no plate table ships in the
  backup to resolve them against. It records overrides, not stock. The
  2.5/5/10/25/35/45 lb inventory in "How load is made up" stands on its own
  measurement - taken by overloading the app's calculator - and this file
  neither confirms nor contradicts it.

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

- **`executeSet` opened its own transaction, and on device that is fatal.**
  `capacitor.ts` passed `true` for the plugin's transaction flag in `batch()`
  while `exec()` passed `false` two functions above it, with a comment
  explaining why. Inside our own transaction the plugin called
  `beginTransaction` a second time and the whole batch failed with
  `ExecuteSet: Failed in beginTransaction Already in transaction`, rolling back.
  It had never bitten because **no batch had ever run inside a transaction on
  device**: `seedPlan` and `seedMuscles` only ever ran on the laptop, and the
  first launch of the on-device seeders is what found it. The flag now follows
  our own depth, so a bare batch is still atomic on its own. The lesson is the
  familiar one: a rule stated in a comment two functions away is not enforced,
  and the device step is where that gets discovered.
- **Discarding a workout left the rest timer running.** The rest belongs to the
  service, and nothing told it the session had gone, so the pill kept counting
  and the foreground service stayed alive for a workout that no longer existed.
  Both halves have to be cleared - the native timer and the store - and both
  `useEndSession` and `useDiscardSession` now do it. Measured before and after:
  two `ServiceRecord`s while resting, one after a discard.
- **Blind chained taps caused a mis-tap again.** After logging a set the screen
  auto-advanced, so a `Finish` tap issued from a stale screenshot landed on an
  exercise card instead. `PROJECT.md` has said "screenshot before every tap"
  since the first device session and this is the third time it has been proved.
  Reading the target's `bounds` out of `uiautomator dump` immediately before
  tapping is stricter and was what finally got the cleanup right.
- **`plan.ts` did not match the programme, and nothing would have caught it.**
  It was typed from `Examples/Plan.md` and then treated as settled, but the
  written plan is a document and the app is the thing being trained against.
  Measured off the backup on 2026-08-13: **nine rep ranges differed** (Cable
  Face Pull 12-15 vs the app's 6-10, Cable Crunch 8-12 vs 5-8, Pallof Press
  10-10 vs 6-10, and six more), **Day B's order differed** in two places, and
  **every rest value differed** because the app does not use the header's three
  bands at all. Resolved by making the app the source. The general lesson is the
  one this section keeps repeating: a value copied out of a document is not
  measured, and this file should not have written it down as though it were.
  `plan.test.ts` now asserts Day B's order and rests explicitly, so the next
  drift fails a test instead of going unnoticed for five weeks.
- `setRequestPromotedOngoing` / `setShortCriticalText` are on
  **`NotificationCompat.Builder`** (androidx core 1.17.0), *not* the platform
  `Notification.Builder`. An earlier claim that the API did not exist was wrong;
  the wrong class was inspected.
- **There is no `POST_PROMOTED_NOTIFICATIONS` permission.** Only
  `POST_NOTIFICATIONS`.
- **`am force-stop` did NOT clear notifications** on Android 17, contrary to
  guidance. Use `am kill` to test process death.
- **`am kill` needs the app BACKGROUNDED and the rest timer stopped**, which the
  advice above did not say. Measured 2026-08-13: called on the foreground app it
  is a no-op, and even after `KEYCODE_HOME` the process survived while the
  rest-timer foreground service was running - correctly, since that is what a
  foreground service is for. `Skip`, then home, then `am kill`, then confirm
  with `ps -A | grep loadout` before claiming a cold start was tested.
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
- **"Pure and tested" was wrong about three functions.** This document listed
  `scrubSteps`, `parseWeight` and `parseReps` under "pure and tested" while they
  were being built ahead of the UI that would consume them. They had **no tests
  at all** - `entry.test.ts` covered only the shapes, steppers and formatters.
  Caught when stage 3 came to wire them up. They are tested now (132 -> 140),
  and the first test written found `scrubSteps` returning `-0` for any drag
  shorter than one step downward. Harmless, since `-0 === 0` is true and the
  caller only compares against zero, but it is now normalised: a primitive that
  reports two different zeroes is a trap for the next caller. **The lesson is
  about the document, not the code** - "tested" is a claim like any other here
  and has to be checked before it is written down.
- **"LOG SET sat at the identical y with the keypad open" was wrong.** The
  stage 3 section still claims it. Re-measured in stage 5: LOG SET's centre is
  at y2215 with the keypad closed and **y1325 with it open**, having moved up
  about 890 device px against a viewport that shrank by about 950. It could not
  have been otherwise - the bar is docked to the bottom of a viewport that the
  WebView resizes, so it must move. The finding that stage 3 was actually
  testing still stands and is the one that matters: **the WebView resizes with
  no `windowSoftInputMode` change and no `@capacitor/keyboard`**, so the entry
  bar rides above the keypad and LOG SET stays fully reachable. The mis-tap that
  started all this was caused by the rest bar and set chips moving the layout,
  which the three regions fixed; the keypad was never that failure.
- **Module side effects bite.** `scripts/migrate.ts` ran a migration merely by
  being imported, holding the DB open and causing `EBUSY` on delete. CLI entry
  points are now guarded with `import.meta.url === pathToFileURL(argv[1]).href`.
- **A "stale Vite glob dropped migration 0005 from the bundle" was reported
  here, and it never happened.** The device logged `schema up to date` after
  0005 was generated, a grep of `dist/` appeared to show the new table name
  missing, and the conclusion drawn was that `import.meta.glob` had been cached.
  It had not. Clearing `node_modules/.vite` and rebuilding produced a bundle with
  an **identical content hash**, which is proof the migration had been in it all
  along; the grep was faulty. The real explanation is duller: 0005 applied on the
  first launch, and the `schema up to date` line came from a second WebView
  context. The database confirmed it - migration recorded, table present,
  backfill correct. The guard written during the false alarm was kept, because a
  bundle silently missing a migration is a genuinely bad failure that nothing
  else here could see, but **its comment now says it is a precaution rather than
  a post-mortem**. The lesson is the one this file keeps relearning: a
  measurement that has not been checked is a guess, and a guess written in this
  document is worse than no entry at all.
- **`am kill` cannot reproduce a mid-rest cold start.** The rest-timer foreground
  service is exactly what keeps the process alive, so the kill is a no-op
  precisely when a rest is running - the case worth testing. Force the activity
  to be destroyed instead (`settings put global always_finish_activities 1`),
  which loses the JS context while the service keeps counting.
- **A pushed screen resetting the screen below it is not hypothetical.** `nav.ts`
  flagged it; opening the summary and coming back landed on exercise 1 of 10.
  State that must survive a push now lives in `state/workout.ts`.
- **An effect that writes a fresh object cannot also depend on it.** The entry
  draft's re-seed took `draft` as a dependency so that dropping it would re-seed
  immediately, and wrote a new draft object whenever the stored one was not
  hand-edited. A pristine draft therefore re-seeded itself forever: React error
  #185, maximum update depth, and a **blank screen on the phone**. It passed
  typecheck, lint and 204 tests. The fix is a value comparison before writing -
  and the weight half goes through `weightsEqual`, never `===`, because a stored
  weight against a freshly computed one is exactly the shape `units.ts` warns
  about. The general lesson is the one this file keeps relearning: the device
  step is not a formality, and a green test suite is not a rendered screen.
- **Two effects in sequence are not one effect.** Opening exercise 9 of 10 from
  the overview landed on **2 of 10**. One layout effect wrote the requested index
  into the store and a second positioned the pager - but the second read `index`
  from a render that had not seen the first, positioned at page 0, and the
  `IntersectionObserver` then claimed page 0 as the truth. This is the same race
  the badge strip had, arriving at mount instead of on a tap. Fixed by doing both
  in one effect from one source: `openAt` is the authority, the store and the
  scroll position are written together, and there is no window in between.
- **"`Move earlier` / `Move later` are pointless now there is a list" was
  wrong**, and was called wrong the same day it shipped. Jumping changes where
  you are; reordering changes what the workout *is*, and only the second survives
  to the summary. They are back, as `Move up` / `Move down` in the exercise
  menu, and `reorderSessionExercises` finally has a caller that has been tapped.
- **`npm run import` had the export filename hard-coded.** It happened to be the
  newest one, so nothing was wrong - but a fresh export would have been ignored
  while the reconciliation still reported OK against the older file. It now takes
  the newest `Examples/*.csv`, and Progression's `YYYY-MM-DD_HH-MM-SS` naming
  makes lexicographic order chronological, so no date parsing is involved.

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
| Bubble visibility | **Only when loadout is not in front.** In-app, the app-bar pill owns the countdown. |
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

### The in-app face is a pill in the app bar - DONE

Stage 10. `RestBar.tsx` is **deleted**. It was a full-width bar that pushed the
content down about 190 px when it appeared; the pill costs no vertical space and
cannot shift the layout, which is the whole point on a screen designed so that
nothing moves under a thumb.

It lives in `AppHeader`'s right slot, so rest state had to move out of
`ActiveSession` into `src/state/workout.ts` - the header is rendered by the shell,
above the logging screen, and stays up when a pushed screen covers it.

`--color-rest` (#0058e6) and `--color-rest-over` (#971e1e) were sampled off the
reference app when the palette was built and had been defined and unused ever
since. This is what they were for.

**The cold-start gap is fixed.** `restEndsAt` was React state, so an app whose
WebView went away lost the countdown while the service kept counting.
`RestTimerPlugin.state()` now returns the service's own `endsAt`, read on mount.
The service exposes it as **static fields**, following the `MainActivity
.isForeground` precedent - binding to a service to ask it one long is more
lifecycle than the question deserves. Nothing is persisted: if the process is
gone the service is gone, and a stale end time read back from disk would be
worse than none.

#### Measured on device

| Step | Measured |
|---|---|
| Idle | plain alarm outline in the app bar |
| Counting down | blue pill, alarm icon and `3:57`, fill draining right to left |
| Layout | header does not move when a rest starts - see the correction below |
| Recovery | activity destroyed mid-rest, reopened: pill back at **3:08**, fill correctly drained to about 78% |

**`am kill` cannot produce this failure**, which is worth knowing before trying:
the rest-timer foreground service is precisely what keeps the process alive, so
the kill is a no-op exactly when a rest is running. Forcing the activity to be
destroyed instead (`settings put global always_finish_activities 1`, background,
return) loses the JS context while the service carries on, which is the faithful
version of it. Restore the setting to `0` afterwards.

~~**Not verified this session:** the red count-up past zero.~~ **Verified
2026-08-15**, incidentally, while testing the overview: a 1:15 rest ran out
mid-tapping and the pill went solid red and counted up, through `0:08`, `0:42`
and `1:49`, never auto-dismissing.

**A correction found by measuring:** the first version left a bare icon in the
idle slot, and the exercise header still moved about 11 device px when a rest
started, because the icon was shorter than the pill replacing it. The idle state
now matches the pill's height exactly. A smaller version of the bug this stage
exists to kill is still that bug.

---

## Exercise library and detail - DONE

Stage 12, and migration 0006. `ALTER TABLE exercises ADD guidance text` - a
nullable column with no CHECK, so a plain ADD COLUMN rather than the
create-new/copy/drop/rename rebuild 0001 and 0004 needed, and none of the
drizzle breakage applies. Read it anyway; a rebuild here would have meant
something else in `schema.ts` had drifted.

**Guidance is authored, not measured**, and `logic/exerciseGuidance.ts` says so
in its own header. The 21 programme lifts carry newline separated cue lines;
every other exercise renders "no guidance yet" rather than an empty heading. One
text column, no parser, no schema for structure.

**The seeders now run on device.** Nothing seeded there before: the fill-blanks
seeders were called only from `scripts/import.ts` and `devSeed.ts`, which is
useless the moment a re-import is no longer possible, and cutover is one-way.
`db/seed.ts` runs them all on launch, unconditionally, because every one of them
only fills blanks. Its header states the rule that keeps stage 13 honest:
**`seedPlanTemplates` is never called from there**, because it replaces
templates by name and would silently undo every template edit.

`exerciseHistory` **pages by rank, not by row**, so `Load more` can only ever
add whole sessions; a row limit would render half a session as though that was
all that was performed. It is the same `DENSE_RANK() OVER (PARTITION BY ...)`
the logging screen depends on, which is now proved on device by a screen a user
opens rather than only by `DbSmoke`.

### Measured on device, screenshot before every tap

| Step | Measured |
|---|---|
| Launch after 0006 | `backed up ... before-0006`, `applying 0006_exercise_guidance (1 statements)`, then `seeded: 83 with a group, 21 with guidance, 57 with a loading, 24 with a base, 6 plate sizes` |
| Second launch | the identical seeded line, which is the fill-blanks claim holding |
| `Exercises` from Home | 87 by recency with real counts - `Trap Bar Deadlift · 10 days ago · 23 sets` |
| `Trap Bar Deadlift` | sets 23, sessions 12, best 365 lb, `2026-04-06 to 2026-08-15 · most reps 8 · 55k lb lifted`, four cues, sessions newest first |
| `Assisted Pullup` | tile reads **LEAST ASSIST 25 lb**, not a "best" of 52, and the summary line carries no volume at all |
| Card menu in a workout | `About this exercise` opens the same screen, and back returns to the workout |

**The assistance inversion is the point of the stage.** 420 imported sets record
machine assistance, where a higher number is an easier set, so the repo returns
the heaviest load and the least assistance as separate columns and the screen
labels whichever it got. A single "best" reads backwards for those rows.

---

## Template editor - DONE

Stage 13, no migration. The rep-range columns have existed and been populated
since 0002 and nothing could edit them, which was the whole gap.

**One writer, two tables.** `setExercisePlan(db, scope, ...)` takes a closed
union - `session_exercises` or `template_exercises` - and `ExercisePlanEditor`
is mounted from both the template editor and the live workout's card menu. That
is the reference app's own insight and the reason this was a stage rather than a
screen: the same editor in both places is what stops the programme and the
performance of it drifting apart. The editor is built from `EntryField`, so the
stepper, the drag scrub and the keypad are the ones already measured.

`WorkoutOverview`'s `Layout` now has three callers: the live workout, the
read-only preview, and the editor. The `...` menu appears on the preview too,
because it carries `About this exercise`, which is worth having wherever an
exercise is listed.

### Measured on device, screenshot before every tap

| Step | Measured |
|---|---|
| `Edit` from the preview | The same card list, plus `Add exercise` and `Done` |
| Card menu | `About this exercise`, `Move up` (disabled on the first row), `Move down`, `Sets, reps and rest`, `Replace`, `Remove` |
| `Sets, reps and rest` | `2 × 5-8 · rest 4:00` edited to `3 × 5-10 · rest 3:30`, and the card followed on save |
| **Force-stop and relaunch** | **the edit was still there** - the tap that proves `plan.ts` is not re-seeding, and the most important one in the stage |
| Start a workout from it | the snapshot took the edited numbers: `3 × 5-10 · 0/3 sets · rest 3:30` |

---

## Plate chips - DONE

Stage 14, no migration. All three empty things are filled by **seeders rather
than a migration**, because a migration runs once per database and a device
re-pushed from an older lineage would arrive without them and get no second
chance.

**`loading` is stated only where a logged set proves it.** Whether a machine is
plate-loaded per side or a selectorised stack is a fact about one gym, not
something inferable from a name, and a wrong guess puts a plate breakdown under
a pin stack. So `logic/exerciseEquipment.ts` names barbells, the trap bar, the
two Smith lifts, dumbbells, cables and bodyweight - and exactly five `Machine*`
rows, each reconciled against its own history:

| Exercise | Base | Proof |
|---|---|---|
| Machine Leg Press | 100 lb | `Machine weight 100 / 7x45 per side` against a logged 730 lb |
| Machine Hack Squat | 55 lb | `Machine weight 55lb / 3x45 per side` against 325 lb |
| Machine V-Squat | 55 lb | `Machine weight 55lb / 4x45` against 415 lb, so per side despite the wording |
| Machine Calf Raise (Seated) | 60 lb | `Machine weight 60lb. 1x45 1x25 per side` against 200 lb |
| Hip Thrust | 15 lb | `Machine weight 15lb / 3x45 per side` against 285 lb |
| Smith Machine, both | 20 lb | `20 machine / 1x45 1x25` against 160 lb |

**Per side versus total is not inferable from the note's wording** and was
checked arithmetically in every case. Every other `Machine*` row is absent on
purpose and renders no chips at all.

**The trap bar is recorded as 55 lb and that is contested.** One set carries
`Trap bar 55lb` and was logged at 235 lb, which is 55 + 2 × 45 exactly, on
2026-04-06. The user believes the bar currently in use is 45 lb and will confirm
at the gym. The measured value is what the file holds until then; it is a
one-line edit.

**The inventory is seeded at 20 of each** of the measured 2.5 / 5 / 10 / 25 / 35
/ 45 lb denominations. The count of 8 measured off the reference app describes a
home rack, and the gym being trained in has a 730 lb leg press in its own
history, which 8 cannot reach. The denominations stay honest, so the dashed
shortfall chip still appears for a weight no real combination makes.

**`BASE_WEIGHT_KG` is one SQL expression**, reused by `listTemplateExercises`,
`listSessionExercises`, `searchExercises` and `logSet`, so the chip row and the
`base_weight_kg` snapshotted onto a set cannot disagree.

### Measured on device

| Step | Measured |
|---|---|
| Smith Machine BSS at 160 lb | `45 25 per side · 20 base`, which is 20 + 2 × 70 exactly, and matches that exercise's own five-year-old note |
| Smith Machine Incline at 200 lb | `45 × 2 per side · 20 base` |
| Step to 162.5 lb | `45 25 [1.25 short] per side · 20 base` - the shortfall as a dashed chip, never rounded away |
| `Assisted Pullup` | no chip row at all, because its loading is unknown |
| **`LOG SET` bounds** | **`[42,2157][1039,2317]` with chips and without**, and identical to the reading on record from before chips existed |

---

## The gym settings - DONE

Stage 15, no migration; all six columns have existed since 0003 with no reader.
This is the reader and the writer. **In SQLite, not React state**: a toggle that
did not survive a force-stop would be worse than none.

Three of the five needed Java:

- **Keep screen on** is a new `AppScreenPlugin` setting `FLAG_KEEP_SCREEN_ON` on
  the activity window, applied from an effect scoped to a live session. A wake
  lock would be the wrong tool; the flag dies with the activity, which is the
  wanted behaviour if the phone is pocketed.
- **Floating bubble** and **Vibrate** are a third gate in `showOverlay()` and a
  guard in `scheduleVibration()`.
- **Sound did not exist at all** - the channel is created with no sound and the
  notification is silent - so it is a `ToneGenerator` on `STREAM_ALARM`, fired
  from the same `postDelayed` as the buzz at zero and cancelled with it.

**The settings ride in as intent extras on each `ACTION_START`.** The service
cannot read the database: that lives in the WebView's process, which is exactly
what the service has to outlive. So a toggle applies from the **next** rest, and
the screen says so rather than leaving it to be discovered.

`stepForExercise` resolves the step as exercise override, then setting, then
`WEIGHT_STEPS`, which finally gives `exercises.default_increment_kg` a reader.
The three hard-coded `const UNIT: Unit = 'lb'` copies collapsed into one
`DEFAULT_UNIT`; there is still deliberately no unit setting.

### Measured on device

| Step | Measured |
|---|---|
| Seeded defaults | increment 5, bubble On, vibrate On, sound Off, keep screen Off, folder not set |
| Increment 2.5, force-stop, relaunch | still 2.5, and `Keep screen on` still On |
| In a workout | the handles read `+2.5` / `−2.5`, and stepping moved 160 to 162.5 |
| Keep screen on | `dumpsys window` reports `mHoldScreenWindow=...MainActivity` and `fl=KEEP_SCREEN_ON` |
| Bubble **On**, log a set, home | `mAlertWindows={Window{... com.groenewold.loadout}}` |
| Bubble **Off**, log a set, home | `mAlertWindows={}`, with the rest service still running |

**Not verified:** the haptic pattern and the tone, by feel and by ear. Both were
driven remotely over adb, and neither can be confirmed that way.

**A gap worth recording:** Home is where `Exercises` and `Settings` live, and
Home is replaced by the workout overview while a session is live, so **neither
is reachable mid-workout** except `About this exercise` from a card menu.

---

## Synced-folder export - DONE

Stage 16, no migration, and **nothing here cuts over**. The device database
stays disposable.

The threat is uninstall, not a bad migration: `backup.ts` already copies before
migrating, but into the same app-private directory that goes with the app. And
`VACUUM INTO` writes as the app's own uid to a filesystem path, while the only
destination that survives is a folder the user picked. So the export is two
steps: `VACUUM INTO` a staging file beside the database, then `BackupPlugin`
streams it into a **SAF tree uri** and deletes the staging copy.

The tree uri and the "last export day" marker live in `SharedPreferences`, not
in `app_settings`. Both are facts about this installation; a destination
restored from an exported copy would point at the old installation's folder, and
a restored marker would claim an export this device never made.

Retention is decided in TypeScript (`exportsToPrune`, pure and tested) and
executed natively, so the plugin never decides anything and **never touches a
file it did not write** - the folder is the user's and may hold anything.

### Measured on device

| Step | Measured |
|---|---|
| `Choose folder` | Android refuses `Download` itself, so a `loadout-backups` folder was created inside it and granted |
| `Export a copy now` | `Copied loadout-20260826-040730.db.`, 1,118,208 bytes in the folder, and **no staging file left** in `databases/` |
| Pulled back, opened in better-sqlite3 | `integrity_check ok`, `foreign_key_check` empty, 6,209 sets and 344 sessions matching the device |
| Relaunch the same day | still one file, which is the daily throttle |
| Finish a workout | a second file, `loadout-20260826-040935.db` |
| **Uninstall the app** | **both files still in the folder**, which is the whole point of the stage |

### What the reinstall shook out, and it is not our bug

Reinstalling and pushing the database back produced an app with **no data and no
error on screen**: `createConnection` failed with `CapacitorSQLitePlugin: null`
and every query returned nothing. The cause was Android's own auto-restore,
which had put an old `databases/` directory back under a new uid; the listing
showed restored backups dated 1970 beside the pushed file. `pm clear` and a
re-push fixed it, and the app then migrated 0000 through 0006 from scratch on an
empty database exactly as it should.

Worth knowing before a cutover: **`adb uninstall` does not leave a clean slate**
on a device with backup enabled. Use `pm clear` before pushing a database.

---

## Stages 17 to 20 - DONE

Four stages built in one batch with the phone disconnected, then verified in one
device session on 2026-08-26. This document has said "prove each stage on the
phone before starting the next" since stage 3, and that was suspended here
deliberately, at the user's direction.

Two conditions made the batch safe enough to run that way, and both were kept:
each stage put its rule in a pure tested function, so what could be wrong on
device was the wiring rather than the decision; and none of them adds a
migration.

**The bet paid, once.** 17 checks, 16 passed first time. The one failure was
cosmetic and is fixed and re-measured: see "What the device session found".

### 17. Reachable mid-workout

Two gaps this document had recorded under "Not blocking cutover", both found on
the phone.

**Guidance from the logging screen.** The pinned header carries an info
affordance beside the `n/N` counter, opening the cues in an `ActionSheet`. A
sheet because region 1 is pinned and nothing may push the entry bar around: an
overlay costs the layout no height. `CueList.tsx` is the cues, shared with the
exercise detail screen, and `guidanceCues` is the one parse both use - the same
reuse argument that keeps the entry bar the only number editor. The text arrives
as one more column on the session-plan query the screen already runs, rather
than through `exerciseDetail`, which pulls lifetime totals and every session.

**Home over a live workout.** `Exercises` and `Settings` are entered only from
Home, and while a session is live the root is the overview, so neither could be
opened mid-workout. Home is a pushed screen kind now, reached from a `Home`
button docked with `Add exercise` and `Finish` and placed as far from `Finish`
as that row allows. The guard that makes it safe: a template preview opened from
there offers **no** `Start workout`, and says which workout is in progress
instead. `startSession` already refuses a second session; this is the readable
half of the same rule.

### 18. The progression cue pre-fills the weight

`shouldIncreaseLoad` had decided "top of the range on every set -> add load"
since before there was a logging screen, and everything it fed was advisory
text. Now the exercise opens at the weight it earned, with reps back at the
bottom of the range, so the common case is still one tap.

- `nextLoadStep` in `logic/plan.ts` decides the **direction** only: `+1`, `-1`
  or `0`. The size comes from `stepForExercise`, so the increment stays resolved
  in one place - the exercise's own column, then the gym setting, then the
  constant.
- **`assistance` moves down.** A higher number on an Assisted Chinup is an
  easier set, which `sessionTotals` and the volume expression already encode.
- `openingEntry` in `logic/entry.ts` composes it with `prefillFor`, so the
  effect that seeds the draft writes and decides nothing. **Only a
  `last-session` prefill is bumped**: a `current-session` one is set 2 repeating
  set 1, and the rule is about the next session, not the next set.
- The seeded draft is still **pristine**, so a hand edit still wins.
- The page says what happened - "Load is up from 355 lb" - so the number in the
  bar is not mistaken for what was lifted last time. It disappears once a set
  has been logged there.

### 19. Chest Dip and Chinup, split

Deferred since the import, and taken now because the cutover has not happened:
today it is an importer change plus a re-import, and afterwards it would be a
data migration over five years of native history.

**Measured against `db/loadout.sqlite` before anything was changed**, which is
what the rule turned on:

| Rows | Span | |
|---|---|---|
| `Chest Dip` weighted | 2023-10-25 to 2025-12-29 | 127, all `assistance` |
| `Chest Dip` no weight | 2025-01-02 to 2026-08-13 | 55 |
| `Chinup` weighted | 2023-10-30 to 2026-01-08 | 44, 40-115 lb |
| `Assisted Chinup` | 2023-12-18 to 2026-07-22 | 140, 20-115 lb |

Weighted rows become `Assisted <name>`; unweighted rows keep the plain name. So
`Chest Dip` becomes two exercises, and **weighted `Chinup` merges into the
`Assisted Chinup` the export already had** - a merge the rows justify: the two
never appear in the same session (0 of 343), the weights and rep counts are the
same movement, and both trend downward over the same years. This does not
contradict the alias rule above, which refuses to merge *distinct* movements.

The load-bearing edit is that the **exercise list is built from the split name**.
Grouped on the export's own name, `Assisted Chest Dip` would never be created
and `Chest Dip` would keep inferring `weight_reps` off rows that no longer
belong to it - which is the exact fault the split exists to fix.

After the re-import, measured in the database: `Chest Dip` is `bodyweight` with
55 sets, `Assisted Chest Dip` is `weight_reps` / `assistance` with 127,
`Assisted Chinup` holds 184, and plain `Chinup` is `bodyweight` with 8. **Total
volume still reconciles exactly at 7,543,590 lb**, because per-set `load_mode`
is untouched: rows move between exercises, and no row changes what it means.

The reconciliation's own per-exercise check had to be taught the split, or every
exercise it touches reports a mismatch while the rows are perfectly accounted
for.

**What this fixes on device, and is exactly what has not been tapped yet:**
`Chest Dip` was `weight_reps`, so on a bodyweight day the weight field was
required and `LOG SET` sat disabled until a number was typed.

### 20. Trends

The first chart in the app. `exerciseSessions` is one statement returning every
candidate for "best set" per session, oldest first, and `logic/trend.ts` decides
which of them the exercise is measured by - so the branch is pure and tested and
the chart component holds no opinion about what it is drawing.

- **`assistance` is drawn with the y axis reversed**, because the best set is
  the least assistance and a plain plot would read five years of getting
  stronger as decline. The heading says "less is stronger" outright rather than
  leaving the flip to be noticed.
- **Bodyweight work picks its measure once for the whole series**, not per
  session: `Chinup` and `Chest Dip` carry both weighted and unweighted sessions,
  and pounds against rep counts on one axis is a line that means two things at
  either end.
- One series, so **no legend** - the heading names the line, and only the first
  and last points carry a number.
- **`recharts` is a new dependency**, taken rather than hand-rolled. It costs
  **356 kB raw / 104 kB gzipped**, taking the bundle from 372 kB to 728 kB. The
  app is installed and offline and fetches nothing, so this buys ergonomics with
  something close to free here; `uplot` is the smaller alternative if that
  judgement turns out to be wrong on device.

### Measured on device, 2026-08-26

Screenshot before every tap. Run against the real 6,206-set history after a
re-import, `VACUUM INTO`, `pm clear` and a push.

| Step | Measured |
|---|---|
| Home after the push | `343 workouts · 6,206 sets · 7.3M lb · 507 hours · since 2021-07-06`, both templates `not done yet` |
| `Chest Dip` on a bodyweight day | weight field empty, `LOG SET` **enabled** - `uiautomator` reports `enabled="true"`. History cards read `8 reps` / `6 reps`, no weights |
| `Assisted Chest Dip` in the library | its own exercise: 127 sets, 48 sessions, `LEAST ASSIST 10 lb`, assistance guidance |
| `Assisted Chinup` | 184 sets, which is the 140 it had plus the 44 merged in |
| Info affordance in the header | sheet opens with the four cues and `About this exercise`; nothing under it moved |
| Back with the sheet open | closes the **sheet**; still on the exercise, `topResumedActivity` still loadout |
| `About this exercise` | pushes the detail screen; back returns to the same exercise |
| `Home` from the overview | Home over the live workout, rest pill still in the app bar |
| Day A preview from that Home | **no `Start workout`** - `Day A - Trap Bar is in progress. Finish it first.` |
| `Settings` from that Home | opens; back twice lands in the live workout with `Pallof Press 1/2 sets` intact |
| Pallof Press, earned last time | opens **30 lb × 6** from `25 lb × 10, 10`, with `Load is up from 25 lb - top of the range last time.` |
| Trap Bar Deadlift, not earned | opens `365 lb × 8`, no message |
| Log set 1 of Pallof | slot 1 rewrote to `30 × 6`, bar still `30 × 6` - **set 2 is not raised again**, and the message is gone |
| Edit to 370, back out, re-open | `370 lb`, plate chips updated, **not re-bumped** |
| Assisted Pullup, 35 lb × 8, 8, then finished and restarted | opens **30 lb × 5**, with `Less assistance than last time, down from 35 lb.` |
| Summary | 3 sets, volume `180 lb` = Pallof's 30 × 6 alone. The two assistance sets contribute nothing |
| Force-stop mid-workout, relaunch | resumes to the overview with the workout intact |
| Assisted Chinup chart | 75 sessions plotted, axis reversed, `LEAST ASSISTANCE, LB` and `less is stronger`; the line rises as the assistance falls |
| Nordic Curl, one session | a single dot, no crash |

### What the device session found

**The chart's axis was unreadable, and the cause was the unit.** Ticks came out
`33 / 66.25 / 99.25 / 132.25 lb`: the values were plotted in kilograms and
formatted as pounds, so the round numbers the chart chose were round in the
wrong unit. `66.25 lb` then wrapped onto two lines and the bottom label sat on
top of the date beneath it.

Fixed by **converting to the display unit before plotting** and naming the unit
once in the heading rather than on every tick. Re-measured on the phone: ticks
`30 / 60 / 90 / 120`, heading `LEAST ASSISTANCE, LB`, nothing wrapped and
nothing overlapping. This is the one thing four stages of building blind cost,
and it was cosmetic.

**`recharts` runs in the WebView**, which had never been tried: 75 points draw
without a stumble on the real history.

### A push can silently land the wrong file

The first push appeared to succeed and the app came up with `Chest Dip` still
`weight_reps`. `adb push` under Git Bash rewrote `/data/local/tmp/loadout.db`
into `C:/Program Files/Git/data/local/tmp/loadout.db`, so the staged file was
never replaced and `run-as ... cp` copied **August's** database over the new one.
The tell was the app writing a `before-0006` backup: a current file has 0006
already applied.

Prefix every `adb` call that names a device path with `MSYS_NO_PATHCONV=1`, and
check the pushed file's timestamp before copying it into `databases/`.

---

## Stages 24 to 34 - DONE, VERIFIED ON DEVICE

The demo batch, built 2026-08-26 with the phone disconnected, the same way
stages 17 to 20 were, and **proved on the phone on 2026-09-01** in one session
of screenshots. Every row of the device table at the end of this section passed;
two faults were found there and fixed on the spot, both in the calendar.

The goal that ordered it: showing the app to other people from the week of
2026-08-31. Everything here is either a wrong statement removed from a screen,
or a question an audience asks that the app could not answer.

### Stage 22 is dropped, and this records why

`PROJECT.md` said, under "Data safety" and as stage 22, that the app must not be
demoed on the real database, because `sets.notes` carries the medical notes from
`Set Comment`. **The user withdrew that on 2026-08-26**: this is a single-user
app, the developer's own data on the developer's own phone, and the people who
will see it are being shown something rather than handed an install. The
fabricated device database was therefore never built, and `src/db/devSeed.ts`
stays exactly what it was - the browser seed for `npm run dev`, unchanged.

The rule is recorded rather than deleted, because it was written from a true
reading of the data. What changed is the audience, not the notes.

### 24. An unfinished workout is not a finished one

`listTemplates` computed `lastUsedDate` with no `ended_at_utc` filter, so
**starting** a workout moved Home's `last done` to today and handed the A/B
rotation to the other template before a single set was logged. Measured on the
phone on 2026-08-26. The condition every other history read already uses is now
in that subquery too, and `repo.test.ts` starts a session, asserts nothing moved,
ends it, and asserts both the date and the rotation then follow.

The second blemish from that session, `Chest Dip` rendering `BEST -`, is fixed by
stage 25 rather than patched here.

### 25. Best set, out of the series the chart already draws

`bestOf` in `logic/trend.ts` takes the `TrendSeries` and returns its best point
with the date. **No new query, and no second opinion about what "best" means**:
`trendSeries` had already decided the measure per exercise, so the tile and the
chart cannot disagree. Assistance takes the lowest point, everything else the
highest, and a tie goes to the earliest session - the date then answers "when
was this first reached" rather than "when was it last repeated".

That is what makes `BEST -` impossible rather than hidden: a bodyweight exercise
with no weight in five years has a rep series, so it reads `MOST REPS 12`.

**Known limit, stated because it is not obvious:** the series comes from
`exerciseSessions`, which is capped at 200 sessions. No exercise reaches that
today (343 sessions exist in total, across 87 exercises), but the best set is
strictly "best of the last 200 sessions" and would quietly become wrong first.

### 26, 27, 28. The summary tells the truth, and can leave the app

The summary grouped every set by exercise and then rendered `group.sets.length`
and nothing else, so a 22-set workout read as `3 sets` eleven times. The sets are
listed now, numbered the way the history cards number them, through the same
`describeSet` every other screen uses.

`sessionTotals` gained `reps`, and it counts **assistance too**: a rep is a rep
whichever direction the load runs, which is exactly the thing volume cannot say.
Home's tiles are 2 x 2 now rather than a row of three.

`Copy` puts the whole workout on the clipboard as text, patterned on the
reference app's share button. Two deliberate differences from it: volume is
stated in `lb` rather than tons, because this is an lb app and a unit nobody
trains in is a worse headline than a bigger number; and assistance stays out of
the volume line while its reps stay in the rep line.

- `ui/shareText.ts` is pure and tested - the format is provable without a phone,
  a database or a clipboard. `logic/session.ts` gained `groupByExercise` so the
  screen and the text cannot drift apart.
- **No plugin.** Capacitor serves the app from `https://localhost`, a secure
  context, so `navigator.clipboard` is available; `copyText` falls back to the
  older `execCommand('copy')` path rather than trusting that. Which of the two
  actually runs on the device is **unverified** and is the one thing this stage
  most needs the phone for.
- The button sits **outside** the docked action bar, because that bar is hidden
  once a session is finished and a past workout is the one most worth sending.

### 23. Home carries a trend

Twelve weeks of volume as a row of bars, and this four weeks against the previous
four. `logic/volume.ts` is pure: `weeklyVolume` buckets sessions into Monday
weeks and `periodOverPeriod` compares the two windows.

- **A week with no training draws as zero, not as a gap.** Dropping it would run
  the line straight over a fortnight off and claim the volume held, which is the
  one thing the trend is read to find out. This is deliberately the opposite of
  `trendSeries`, which drops a session carrying no plottable number.
- **Bucketing is in TypeScript, not SQL.** `local_date` is a string and
  `logic/dates.ts` already owns the Monday rule the cadence line uses; a second
  definition written in SQLite date functions would be free to disagree with it.
  `sessionVolumes` is one statement returning one row per finished session.
- **No `recharts` here.** Twelve numbers with no axis, no tooltip and no unit to
  label do not need a chart library, and the muscle balance below it is already
  a bar built from plain elements.
- It sits under `Ready for more load`, which stays first. The ordering rule on
  Home is actionable before impressive.

### 29. What this workout was, against the last one

`previousSessionTotals` finds the last finished session of the same workout -
**by template link OR by name**, the pair `listTemplates` already matches on,
because five years of imported history carries only a name. The summary reads
`vs 2026-08-10 · +680 lb · +0 sets · +3 reps`. The first performance of a
template has nothing before it, and null is the answer rather than a failure.

### 30. The launcher icon, chosen and installed

The scaffold's Capacitor mark is gone. The chosen one is `e12`: a long bar with
heavy plates and softened corners, on the same 45 degrees the Capacitor mark
sat at, in `#002a77` and `#b4c5ff` out of `src/index.css`. It was picked by
looking at candidates side by side at 84, 48 and 28 px and under the circle
mask, the same way the identity mark was chosen in stage 11a. Every candidate
that survived is in `design/icons/`.

**There is no rasteriser on this machine** - no ImageMagick, no Inkscape, no
`sharp` - so `scripts/make-icons.mjs` is the whole toolchain: Node's `zlib`,
a hand-written PNG encoder, and the mark's geometry as five rectangles. It
writes all fifteen files:

- `ic_launcher_foreground.png` per density, the art alone on transparency
  across the full 108 dp canvas, which is what the adaptive icon composites
  over `values/ic_launcher_background.xml` (now `#002A77`, was `#FFFFFF`).
- `ic_launcher.png` and `ic_launcher_round.png` per density, for API 24 and 25.
  `minSdkVersion` is 24, and those launchers mask nothing themselves, so the
  script zooms to the safe square the way an adaptive icon is cut down and
  applies the rounded-square or circle mask itself.

**The splash screen came with it.** It was the Capacitor artwork in twelve PNGs
across `drawable-port-*` and `drawable-land-*`; it is now one
`drawable/splash.xml`, the launcher icon's own two parts - the blue as a layer,
the foreground centred over it - so the cold start and the home screen agree.
Android 12 and up ignores the window background and draws its own splash from
`windowSplashScreenBackground` and `windowSplashScreenAnimatedIcon`, so
`styles.xml` sets those too and both paths look the same.

Three Capacitor leftovers went with it, each checked for references first and
each having none: the twelve splash PNGs, `drawable-v24/ic_launcher_foreground.xml`
(the old mark as a vector, unused since the adaptive icon points at the mipmap
PNG) and `drawable/ic_launcher_background.xml` (the old grid, unused since the
background is a colour).

**Verified on device 2026-09-01:** the launcher's own circle mask cuts it
cleanly in the app drawer, and the cold start is the same blue with the mark
centred.

### 31 to 34. The offline batch, taken while the phone was away

Four more built the same way, with the same caveat: **none of it is verified on
device**.

**31. An exercise added by hand can complete.** Adding one mid-session wrote a
row with no `target_sets`, and `isComplete` says - correctly, and on purpose -
that a null target is never complete. Auto-advance therefore kept returning to
it and only `Finish` ended the workout. Recorded as a rough edge when the picker
was built in stage 9 and fixed here: `defaultTargetSets` takes the most common
target among the workout's other exercises, ties going to the **smaller**
number, and the session picker passes it. Adding an exercise means "one more of
these", so it inherits what the rest of the workout is doing. Null stays
possible, for a workout where nothing has a target at all, and then the honest
answer really is that nobody decided.

**32. A year of training, as a grid.** `TrainingCalendar.tsx`, reached from
`Calendar` beside `All workouts` on Home. One square per day for 53 weeks,
shaded in four steps against the window's busiest day, and a tapped day says its
sets and volume and offers to open the workout.

- `calendarDays` returns **every** day in the window, trained or not. A calendar
  drawn only from the days that happened has nothing to say; the gaps are the
  content. `calendarGrid` cuts the run into columns of seven and pads the short
  last week, so nothing in the component reasons about a ragged end.
- No new query: `sessionVolumes` gained `sessionId` and `setCount`, which is
  what lets a square open its workout.
- Squares rather than `recharts`, for the same reason the volume sparkline is
  plain elements: 371 divs need no axis, no tooltip and no library.

**33. Notes, finally writable.** `sessions.notes` and `sets.notes` have been in
the schema since the first migration, the import fills both, and nothing in the
app could write either.

- The workout note is on the summary, edited in place, saved on a tap rather
  than on every keystroke - a write per character is a write per character
  across the bridge. `setSessionNotes` stores a blank as **NULL**, because a
  note nobody typed and a note somebody cleared are the same thing.
- The set note is behind `Note` in the entry bar's edit row, opening an
  `ActionSheet`. It is not in the bar itself: the bar is two numbers and a
  button, and nothing may grow under a thumb mid-set. `updateSet` already
  patched `notes` and had no caller for it.
- A set's note renders under its row on the summary, which is where the
  imported machine-base and plate-breakdown notes finally become visible.
- **Deliberately not in the share text.** Copying a workout should not quietly
  copy what was written about the body performing it.

**34. Muscle balance over time.** Under Home's 28-day bar, twelve weekly stacked
columns. Each column is scaled to its own total so the shape can be compared,
and its height is its share of the busiest week so a light week still reads
light. **Sets, not volume**, the same choice the bar above it makes and for the
same reason. `setsByMuscleDay` is the one new statement; `muscleWeeks` rolls the
days into Monday weeks in TypeScript, where `startOfWeek` already lives.

### Measured on device, 2026-09-01, screenshot before every tap

| Stage | What was seen |
|---|---|
| 24 | Started a Day B workout on 2026-09-01, opened Home: still `Next up Day B · not done yet`, Day A still `last done 2026-08-26`, cadence still `0 this week`. Before the fix Home would have claimed today and handed the rotation to Day A |
| 25 | `Chest Dip` reads `MOST REPS 12 · 2025-02-04`; `Assisted Pullup` reads `LEAST ASSIST 25 lb · 2025-03-11` with the axis inverted. The dash is gone |
| 27, 28 | A 2025-12-02 session lists every set under its exercise (`1 205 × 8`), `SETS 14`, `REPS 120`, `VOLUME 26155 lb` |
| 26 | `Copy` flipped to `Copied` and Android's own clipboard chip showed `Day 2 / 2 Dec 7:56 AM / 1:02:43…`, so the text really landed. **Which of the two paths ran is still unknown** - the chip does not say, and nothing logs it |
| 23 | `VOLUME · 12 WEEKS` draws, `-10% vs previous 4 weeks`, `62k lb in 4 weeks, after 69k lb`. The two agree: 62/69 is -10.1% |
| 29 | `vs 2025-11-18 · +920 lb · -2 sets · -5 reps` on the 2025-12-02 session |
| 30 | The mark in the launcher drawer, circle-masked, beside Lime and Lyft; and the cold start is the full-bleed `#002A77` with the mark centred |
| 31 | `Assisted Pullup` added mid-workout arrived as `2 sets · 0/2 sets · rest 3:15`, and the database shows `target_sets = 2` inherited. Logged a set and the slots behaved |
| 32 | `The last year · 90 days trained · 1432 sets`, a tapped day reading `2025-12-02 · 9 months ago · 22 sets · 32k lb`, and `Open the workout` landing on that summary |
| 33 | A set note (`stack plus 5lb plate`) renders italic under its row on the summary; a workout note (`felt strong, shoulder fine`) survived `am kill` and was confirmed in the database |
| 34 | The weekly stacked columns draw under the 28-day bar, colours matching the legend |

### What the device session found, and it was both in the calendar

**It opened on last autumn.** Fifty-three columns do not fit a phone and the
grid runs oldest to newest, so the default scroll position showed a year ago and
this week was off the right edge - the only part anyone opens the screen for. A
layout effect now sets `scrollLeft = scrollWidth` before paint, keyed on the row
count so it re-runs when the data arrives and the grid first has width.

**Scrolling took the axis with it.** The `M W F S` column was inside the
scroller, so scrolling to this week carried the one part that has to stay put
off the left edge. It sits outside the scroller now.

Both re-measured after the fix: the calendar opens with today's outlined square
at the right edge and the weekday labels pinned.

### Two limits worth stating, neither a bug

- **The delta line needs two sessions of the same name.** Today's `Day B - RDL`
  showed none, because the imported history calls that workout `RDL` and
  `previousSessionTotals` matches on template link OR name. It appears from the
  second session under the new names onward, which is what the 2025-12-02 row
  above demonstrates.
- **An exercise added by hand reads `2 sets · 0/2 sets`** in the overview,
  because it inherits a set count but no rep range and the header prints both.
  Honest, slightly redundant.

---

## The cutover procedure

**Written down, not performed.** The device database is still disposable and
stays that way until step 3 below is actually run. Everything before that point
is reversible; that step is not.

1. Final `npm run import` over the newest `Examples/*.csv`. The reconciliation
   must report an exact total-volume match. Anything less is not a cutover, it
   is a data loss with a timestamp.
2. `VACUUM INTO db/for-device.sqlite`, then `PRAGMA user_version = 1`. The
   plugin opens at version 1 and would otherwise hunt for an upgrade statement
   that does not exist; `__migrations` remains the real ratchet.
3. Force-stop, push, and copy over `databases/loadoutSQLite.db`, removing the
   `-wal` and `-shm` beside it. The exact commands are in "Putting the imported
   history on the phone" above.
4. Open the app. Verify Home's lifetime line against the import report, and that
   both templates read `not done yet`. The launch seeders fill any metadata the
   pushed file is missing and report their totals in logcat.
5. In `Settings`, choose the export folder and tap `Export a copy now`. Confirm
   the file lands and that whatever syncs that folder picks it up. **Do this
   before leaving the house**, because from here the phone holds the only copy
   of anything logged natively.
6. From then on, `npm run import` refuses the moment any `sets.source =
   'native'` row exists. Cutover is one-way.

---

## Next steps

**Where the plan is up to.** The original ten-stage plan rebuilt the logging
screen around what `docs/PROGRESSION.md` measured. **Resequenced 2026-08-13**
against a set of notes from the user, which added navigation, a summary screen,
mid-workout exercise editing and an exercise library. The ordering principle
chosen was **workout flow first**: one workout has to feel right end to end
before the app grows more screens.

**Resequenced again on 2026-08-15**, against notes taken while using the app on
the phone. Those notes were workout flow - two real strip bugs, a menu that
moved the list, Home starting a workout by accident - and the ordering principle
above says workout flow comes first, so they became stage 11 and the exercise
library moved back. The stage numbers below are the new ones.

Stages 0 to 11c are **done and verified on device**: the pre-migration backup,
the palette, all the pure logic, repo and schema groundwork, the docked entry
bar, the navigation shell, weight beside reps, pre-created set slots, the swipe
pager and aligned history, auto-advance and the summary, the session plan
snapshot with the picker and a real `Add set`, the rest timer as an app-bar
pill, the workout overview with the new exercise identity, the entry bar
and rest-pill changes, and Home showing the history behind it.

**A workout now runs end to end**: open a template without starting it, start
it, jump between exercises from the list or swipe between neighbours, log
against five years of history, correct anything, reorder, add or cut exercises
and sets, and finish on a summary that says what it came to.

**And the five years are no longer invisible.** Home says what is ready for more
load, how often training has happened lately and where the work went, and every
finished session can be opened.

Each stage is independently shippable. Prove each on the phone before starting
the next - screenshot before every tap.

5. ~~**Entry bar relayout: weight beside reps.**~~ **Done and verified on
   device** - see "Entry bar, weight beside reps" above for the measurements.
6. ~~**Pre-created set slots.**~~ **Done and verified on device** - see "Set
   slots" above.
7. ~~**Swipe pager and aligned history.**~~ **Done and verified on device** -
   see "Swipe pager and aligned history" above. The open question it carried is
   answered: the pager does **not** fight the system edge-swipe back.
8. ~~**Auto-advance, and the summary screen.**~~ **Done and verified on
   device** - see "Auto-advance and the summary" above.
9. ~~**Session plan snapshot, picker, swap / cut / add**, and the real
   `Add set`.~~ **Done and verified on device** - migration 0005; see "Session
   plan snapshot, picker, `Add set`" above. `Replace`, `Move earlier` and
   `Move later` are tested at the repo layer but were never tapped on the phone.
10. ~~**Rest timer as an app-bar pill**, and the cold-start gap.~~ **Done and
    verified on device** - see "The in-app face is a pill in the app bar" above.
    `RestBar.tsx` is deleted. The red count-up past zero was not re-verified on
    device this time.
11a. ~~**Workout overview, the exercise identity, and the logging-screen
    notes.**~~ **Done and verified on device** - see "Workout overview" and
    "Exercise identity" above.
11b. ~~**The entry bar and the rest pill.**~~ **Done and verified on device** -
    see "Entry bar and rest pill" above. **The scrub was not re-measured after
    the entry bar shrank**, which is the one thing this stage owes: only padding
    and type size changed and `SCRUB_PX_PER_STEP` is untouched, so the drags
    should be unaffected, but that is reasoning rather than a measurement and
    the last four taps and two drags on record predate the change.
11c. ~~**Home shows history.**~~ **Done and verified on device** - see "Home
    shows history" above. Recent workouts, an `All workouts` screen, and stats
    chosen to be acted on. Taken ahead of the exercise library because Home was
    the first screen anyone sees and it showed none of the five years behind it.
12. ~~**Exercise library and exercise detail.**~~ **Done and verified on
    device** - migration 0006; see "Exercise library and detail" above. The
    launch seeders came with it, because a device that has stopped being
    re-imported has no other way to receive metadata.
13. ~~**Template editor.**~~ **Done and verified on device** - see "Template
    editor" above. One editor over two tables, and the edits survive a
    force-stop, which is what proves `plan.ts` is not re-seeding.
14. ~~**Plate chips.**~~ **Done and verified on device** - see "Plate chips"
    above. `loading`, `modality`, the settings row and the plate inventory are
    all seeded, and `LOG SET` does not move when the chips appear.
15. ~~**The settings that matter in a gym.**~~ **Done and verified on device** -
    see "The gym settings" above. Three of the five needed Java, and rest sound
    did not exist at all until this stage.
16. ~~**Backups, and the cutover procedure itself.**~~ **Done and verified on
    device**, including surviving an uninstall - see "Synced-folder export"
    above and "The cutover procedure" for the written-down steps. The cutover
    itself has **not** been performed: the device database is still disposable.

17. ~~**Reachable mid-workout.**~~ **Done and verified on device** - see
    "Stages 17 to 20" above.
18. ~~**The progression cue pre-fills the weight.**~~ **Done and verified on
    device**, including the assistance inversion, proved end to end by logging
    the sets that earn it and starting the next workout.
19. ~~**Chest Dip and Chinup, split.**~~ **Done and verified on device**, with a
    re-import that reconciles exactly.
20. ~~**Trends.**~~ **Done and verified on device.** `recharts` is a new
    dependency, and the axis needed one fix that only the phone could show.

21. **Delete the spikes** - `src/ui/TimerSpike.tsx` and `src/ui/DbSmoke.tsx`,
    plus the `debug` screen in `App.tsx`. **`DbSmoke` has stopped being the only
    on-device proof of the `DENSE_RANK` window function**: the exercise detail
    screen from stage 12 runs the same window function on the phone over the
    real history, so the spike no longer earns its place. `undoLastSet` then has
    no caller at all and goes with it. ~~The
    `debug` link is still in the header and is reachable in a demo.~~ **Done in
    11b**: the label is gone, and the way in is five taps on an unlabelled
    corner of the app bar. **Moved to last** and run immediately before the
    cutover: `DbSmoke` is the quickest on-device sanity check after a repo
    change, and stages 17 to 20 are all repo changes waiting on one device
    session.

### Demoing to other people, from the week of 2026-08-31

Stated by the user on 2026-08-26. This is a different goal from the cutover and
it reorders the work: the cutover makes the app the user's own logger, and a
demo makes it something a stranger holds. **The two want opposite things from
the database.**

22. ~~**A demo database, and it is the blocking one.**~~ **Dropped on
    2026-08-26.** The demo runs on the real database: this is a single-user app,
    the developer's own data on the developer's own phone, and the audience is
    being shown something rather than handed an install. See "Stages 24 to 30"
    for the record. `db/devSeed.ts` stays what it was, the browser seed for
    `npm run dev`.
23. ~~**Home carries no trend.**~~ **Built 2026-08-26, not yet on the phone.**
    Twelve weeks of volume as bars, plus four weeks against the previous four.
24. ~~**Two blemishes measured on the phone on 2026-08-26.**~~ **Both built.**
    The `BEST -` on bodyweight work is fixed by 25 rather than patched, and an
    unfinished workout no longer counts as a finished one in `nextTemplate`.
25. ~~**A best set per exercise, with its date.**~~ **Built**, out of the same
    series the chart draws rather than a new query. Still not an e1RM or a
    strength score, for the reasons recorded above.
26. **Share a workout as text.** Built: `Copy` on the summary, patterned on the
    reference app's share button. Volume in `lb` rather than tons.
27. **The summary lists the sets**, not a count per exercise.
28. **A reps tile**, and `sessionTotals` counts reps including assistance.
29. **Session-over-session deltas on the summary.** Built.
30. **A launcher icon.** Chosen (`e12`) and installed across all five densities
    by `scripts/make-icons.mjs`, which renders PNGs with no image tooling at
    all. Seen in the launcher drawer under its circle mask, and the splash
    matches it.

31. **An exercise added by hand can complete**, so auto-advance no longer
    returns to it forever. The rough edge stage 9 recorded.
32. **A year of training as a calendar**, reached from Home.
33. **Notes from inside the app**, on a workout and on a set.
34. **Muscle balance over time**, twelve weekly columns under Home's 28-day bar.

Everything from 23 to 34 was built with the phone disconnected on 2026-08-26 and
**all of it was verified on device on 2026-09-01**, which also found and fixed
two faults in the calendar. The cutover is unaffected and stays a
separate decision; the user is logging in Progression in tandem, so the device
database stays disposable and `npm run import` keeps working.

### Where to pick this up

In order, and none of them blocks another:

1. **Stage 21, delete the spikes** - `TimerSpike.tsx`, `DbSmoke.tsx`, the
   `debug` screen and `undoLastSet`, which then has no caller. Deliberately
   last: `DbSmoke` is still the quickest on-device check after a repo change,
   so it goes immediately before the cutover and not before.
2. **The cutover**, when the user decides. The procedure is written down above
   and has not been run. It is one-way: `npm run import` refuses the moment any
   `sets.source = 'native'` row exists.
3. **The next batch of features**, ranked below. Nothing in it is started.

Two rough edges worth knowing about, both recorded above and neither a bug:
the session-over-session line needs two sessions sharing a name, so it is blank
for a workout whose imported history used a different one; and a hand-added
exercise reads `2 sets · 0/2 sets`, because it inherits a set count but no rep
range.

### The next batch, ranked

| Idea | Why it waits |
|---|---|
| ~~**Stall detection**~~ | **Built 2026-09-01** as `stallOf`, N = 3 sessions. The rule was chosen, not argued from data, and that is the part to revisit |
| **Warm-up sets** | `set_type` is `'unknown'` on all 6,209 rows. They then have to leave `sessionTotals`, `shouldIncreaseLoad` and the history cards, which is why it is not a toggle |
| **Supersets made visible** | `order_index` interleaves them truthfully and 12 imported sessions contain them; nothing in the UI says so |
| **A light theme** | The palette was sampled from a dark reference app. Real work across every screen, and invisible until a bright room |
| **Restore from the synced copy, in-app** | Export is built and proved against an uninstall; the way back is still `adb`. Matters at cutover, not before |
| **Rest notification actions** | Skip and add-30 without unlocking. Java work in `RestTimerService`, and the pill already covers it in-app |
| **Per-exercise unit, and a unit setting** | `DEFAULT_UNIT` is a constant and `preferred_unit` is read but never editable |
| **Plate calculator screen** | `platesFor` answers it for the entry bar's weight; an arbitrary target is a different question |
| **Repeat last session** | Fill every exercise's target from what was performed, rather than one exercise at a time |
| **CSV export** | So the history outlives this app |
| **Home-screen widget** | "What is next up", the only thing wanted before leaving the house. New native surface |
| **RPE in the entry bar** | Parsed at import, read by nothing, and the natural first thing to clutter the two-tap loop with |

### Not blocking cutover

- ~~**Guidance has to be reachable from the logging screen**~~ **Built in stage
  17**, as the info affordance in the pinned header opening an `ActionSheet` -
  the safer of the two candidates below, for the reason given there, and
  verified on the phone. The original note stands as written: not only from the
  library and the overview card menu. The cues are for the moment the bar is in
  front of you, and today reaching them mid-workout means backing out to the
  overview and opening a menu. **It must not be always visible**: the exercise
  screen is three regions and the whole design rule is that nothing moves under
  a thumb, so this is a disclosure the user opens, not a block of text sitting
  above the slots. Candidates: an info affordance in the pinned header opening
  the guidance in an `ActionSheet`, or the guidance as a card at the end of the
  history scroller. The sheet is the safer of the two, because it costs the
  layout no height at all.
- ~~**Home is unreachable while a workout is live**~~ **Built in stage 17**:
  Home is a pushed screen now, reached from the overview's docked action row,
  and `Settings` was opened mid-workout on the phone. A template preview reached
  that way refuses to start a second session. Found while verifying stage 15.

- ~~Progression cue is advisory text only.~~ **Built in stage 18**: it pre-fills
  the next session's weight, which was the natural payoff of
  `shouldIncreaseLoad`. Home's readiness list stays text, deliberately - it says
  what to think about before leaving the house, and the bar is where the number
  is applied.
- ~~Progress and **trends over time**.~~ **Finished in stages 20, 23 and 32**:
  one exercise's best set is charted on its detail screen, Home carries a
  twelve-week volume trend with a four-weeks-against-four comparison and weekly
  muscle columns, and a year of training is a calendar.
- ~~`npm run dev` runs against an empty jeep-sqlite database.~~ **Done.**
  `src/db/devSeed.ts` writes fabricated sessions into an empty web database on
  first load. Three guards keep it away from real data: **web only** and **dev
  only**, both in `open.ts`, and **empty only**, inside the seeder. The two in
  `open.ts` are written out rather than imported from the seeder module on
  purpose - importing anything from it statically defeats the dynamic import
  that keeps the fabricated data out of the device bundle, and the bundler says
  so out loud (`INEFFECTIVE_DYNAMIC_IMPORT`). In a production build
  `import.meta.env.DEV` folds to false and the whole branch is eliminated, so
  the seed is not merely unreachable on the phone, it is **absent**.
  **The data is invented and must stay invented** - nothing in it may come from
  `Examples/`, which holds the only copy of the real export and its medical
  notes. Exercise names come from `plan.ts`, which is committed.
- ~~**Home is still two template buttons.**~~ **Done in stage 11c**, and taken
  ahead of the exercise library for the reason recorded here: it was the first
  screen anyone opening the app sees.
- **Long-press to drag and reorder**, on the overview and later in the template
  editor. `Move up` / `Move down` cover the case; dragging would cover it in one
  gesture instead of one per place. Wanted, not needed.

### Phase-1 details already settled

- Default unit **lb**; steppers ±5 and ±1 rep. The secondary ±2.5 button was
  **removed in stage 3** now that the scrub and the keypad exist, matching the
  reference app's single configurable increment. The measurement behind the
  original pair still stands (5,793 of 5,866 weighted sets are whole pounds).
  Still to decide with a thumb: whether the ±2.5 row is missed in a gym.
- Only `load_mode` is needed at import, and only for 4 exercises - a five-minute
  file. `modality`, `primary_muscle`, `loading` stay nullable and get filled in
  lazily. `primary_muscle` is 83 of 87, and stage 14 filled `modality` and
  `loading` for 57 exercises - every one that a logged set or the exercise's own
  name proves. The rest stay null and render no chips, deliberately.
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
- **Splitting `Chest Dip` into two exercises**, assisted and not. The row holds
  both: **127 sets record machine assistance** and **53 have no weight at all**,
  which is one name covering two movements loaded in opposite directions. It
  shows up as a rough edge in the logging screen - `Chest Dip` is
  `tracking_type = 'weight_reps'`, so the weight field is required and empty on
  a bodyweight day, and `LOG SET` sits disabled until a number is typed.
  Observed on device 2026-08-15.

  Three ways out, and they are not equivalent. Loosening `tracking_type` to
  `bodyweight` makes weight optional and fixes the tap, but leaves one exercise's
  history running in two directions, so "best set" and any future PR detection
  still have to branch per row. Splitting into `Assisted Chest Dip` and
  `Chest Dip` fixes that too and is the honest model - the same argument that
  keeps `Assisted Chinup` and `Chinup` apart, which the export already does.
  Doing nothing costs one tap per bodyweight set.

  **The split is a data migration over five years of history, not a rename**, so
  it needs a rule for which rows move: `load_mode = 'assistance'` is the obvious
  candidate and should be checked against the dates before it is trusted.
  `Chinup` is the same shape and would come along with it. Note this cuts
  against the alias rule above only in appearance: that rule says do not *merge*
  distinct exercises, and this splits one that is already two.
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

### Ideas, unevaluated

Brainstormed on 2026-08-26 at the user's request. **None of this is a plan and
none of it is measured** - it is written down so it stops being re-derived, and
anything promoted out of here needs the same evidence everything above got. The
notes say what each one would cost or collide with, where that is known.

**Five of these have since been built** and are struck through where they sit,
rather than deleted, so the reasoning that promoted them stays readable. The
ranked shortlist of what to take next is under "The next batch, ranked" above;
this list is the wider pool it is drawn from.

**Uses a column that already exists**

- **Warm-up sets.** `set_type` is on every row and is `'unknown'` for all 6,209,
  because the export has no such column. A toggle in the entry bar would give it
  a writer, and warm-ups would then have to leave `sessionTotals`,
  `shouldIncreaseLoad` and the history cards, which is the whole reason it is
  not a one-line change.
- **RPE.** Parsed at import and stored, read by nothing. It is the natural input
  to any auto-regulation, and the natural first thing to clutter the two-tap
  loop with, so it would have to earn its place in the entry bar.
- ~~**Notes from inside the app.**~~ **Built in stage 33**, on a workout and on
  a set. The objection recorded here - that this is the column carrying the
  medical history, so a demo build and a notes editor pull in opposite
  directions - went away when stage 22 was dropped and the demo moved to the
  real data. The share text still leaves notes out, deliberately.
- **Per-exercise unit.** `preferred_unit` is read and never editable.

**The logging loop**

- **Repeat last session**, filling every exercise's target from what was
  performed rather than one exercise at a time.
- **A plate calculator screen.** `platesFor` answers "what goes on the bar" for
  the weight in the entry bar; asking it about an arbitrary target is a
  different question and a small screen.
- **Rest presets and per-exercise auto-start**, rather than one global rest and
  one behaviour.
- **Supersets as a visible thing.** `order_index` already interleaves them
  truthfully and 12 imported sessions contain them; nothing in the UI says so.
- ~~**An exercise added by hand never completes.**~~ **Fixed in stage 31**: it
  inherits the workout's own set count, so auto-advance moves past it. It still
  carries no rep range, which is why its header reads `2 sets · 0/2 sets`.

**The programme**

- **More than one programme**, with mesocycles and deloads. Templates are two
  rows today and the editor assumes that.
- **Progression rules per exercise.** One rule is encoded for everything: top of
  the range on every set. Double progression, linear, and rep-goal schemes are
  all different functions over the same rows.
- ~~**Stall detection.** An exercise that has not moved in N sessions is the
  thing a coach would notice and the app currently cannot say.~~ **Built
  2026-09-01**, on the exercise detail screen, with N = 3. Not yet on Home, and
  not yet verified on device.
- ~~**A calendar view**, which is the one view of five years the app does not
  have.~~ **Built in stage 32.**

**Insight**

- ~~**Volume by muscle group over time**, extending the 28-day bar on Home into
  a trend.~~ **Built in stage 34**, as weekly stacked columns - counted in sets
  rather than volume, for the reason the bar above it already gives.
- ~~**Consistency by week**, which the cadence line states as a number and never
  draws.~~ **Built in stages 23 and 32**: the volume bars are per week, and the
  calendar draws every day of the year.
- ~~**Session-over-session deltas on the summary**: volume, sets and top set
  against the last time that template was performed.~~ **Built in stage 29**,
  for volume, sets and reps. The top set is not compared and could be.

**Platform**

- **A home-screen widget** saying what is next up, which is the one thing Home
  answers and the only thing wanted before leaving the house.
- **Actions on the rest notification** - skip, add 30 seconds - so the phone
  need not be unlocked mid-rest.
- **Restore from a synced copy, inside the app.** Export is built and proved
  against an uninstall; the way back is currently `adb`.
- **A light theme.** The palette was sampled from a dark reference app, and a
  bright room is exactly where a demo happens. Note the launcher icon and splash
  are a fixed dark blue and would need their own answer.
- **An accessibility pass.** The colour rail is already paired with the group's
  name, which was chosen partly for this; nothing else has been checked.

**Data**

- **CSV export**, not only a database copy, so the history outlives this app.
- **Strava import** into `external_activities`, which the schema has and nothing
  fills.

### Data safety

- `Examples/` and `/db/` are gitignored. `Examples/` holds the **only copy** of
  the source export and contains medical notes and a named third party. A
  narrower pattern than `/db/` previously let `loadout.sqlite-shm` through -
  verify with `git check-ignore -v` after touching ignore rules.
- ~~**Do not demo the app on the real database.**~~ **Withdrawn by the user on
  2026-08-26**, and kept here rather than deleted because the reading behind it
  was true: `sets.notes` does carry the medical notes onto the phone, and a
  session summary or an exercise history reaches them in one tap. What changed
  is the audience - this is a single-user app being shown, not distributed, and
  the user judges the risk to be none. The fabricated demo database of stage 22
  was therefore never built. **This does not relax anything else on this list**:
  `Examples/` and `db/` stay gitignored, and nothing derived from them may be
  committed or packaged.
- Migrations are numbered and never edited once applied. **Both runners take a
  copy first**: `scripts/migrate.ts` copies the file on the laptop, and
  `src/db/backup.ts` runs `VACUUM INTO` on device before `open.ts` applies
  anything. The device half was missing until 2026-08-09; an older version of
  this document claimed the plugin's `addUpgradeStatement` covered it, which was
  never true once we took over migrations. Neither survives uninstall - that is
  the synced-folder export, **built and proved against an uninstall in stage
  16**.
- The device database must never be committed or packaged as an Android asset.
  `sets.notes` carries the medical notes from `Set Comment`, and `android/` is
  tracked. It stays in gitignored `db/` and reaches the phone over `adb`.
- `npm run import` refuses to run once any `sets.source = 'native'` row exists.
  **Cutover is one-way.**
