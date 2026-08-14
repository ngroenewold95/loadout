# loadout - plan, findings, next steps

Living document, and the handoff point for a cold start. Anything stated as
fact was **measured**; anything unverified says so explicitly. Update it when
something is *learned*, not when something is planned.

Last updated: 2026-08-13

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
- 161 tests passing, typecheck and lint clean

Built but **not yet wired to any screen** - these are pure and tested, and the
UI stages below consume them:

- `platesFor` in `src/logic/plates.ts` - the inventory-aware plate solver
- `updateSet` / `deleteSet`, and `recentPerformance` widened to three sessions
- `app_settings` and `plate_inventory` tables, both **empty**
- `exercises.loading` and `exercises.default_increment_kg`, both **null for all
  87 rows**, so plate chips stay dormant until they are populated

Not built yet: the UI stages 7-14 below, exercise picker, exercise library,
template editor, the synced-folder export.

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
| Rest | In-app bar counts down with `+30s` / `Skip`; the overlay bubble stays hidden while the app is in front |
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
  scroll to reach is not navigation. **Stage 7** replaces it with a pager anyway.
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
drift from the first. That is the same reuse argument stage 12 depends on for
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

It was not fixed here because it cannot be: `targetSets` comes from
`template_exercises`, so raising it would **edit the programme**, which is
exactly the fault `session_exercises` exists to fix. Holding the count in
component state instead would give a planned set that vanishes on process death,
and surviving process death is something this app already gets right. So the
real `Add set` belongs to stage 9, listed there.

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

**A pushed screen unmounts the one below it.** That is right for the spikes and
costs nothing today. The first push from inside a live workout (exercise detail)
is where it has to be reconsidered, because unmounting `ActiveSession` throws
away a half-typed entry draft. `display: none` is not the easy answer: Chrome
resets `scrollTop` when an element is hidden that way, which would lose the
history scroller's position.

### What the first test found

`replace` at the root **pushed instead of replacing**. `[...[].slice(0, -1), x]`
is `[x]`, so replacing on an empty stack inserted a screen, giving the root a
back arrow with nothing behind it. Caught by the second test written, before the
function had any caller. The guard is a length check and the comment on it says
why, because the expression looks correct.

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

Schema and solver exist and are tested; **nothing renders them yet** (stage 13,
renumbered from 7 when the stages were resequenced on 2026-08-13). The design is
here because it is the part a cold start would otherwise re-derive wrongly.

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

**Amended 2026-08-13: the port hunt is often unnecessary.** Starting a cold adb
daemon, the phone came back on its own as
`adb-2B221FDH2000NL-1EGCwi._adb-tls-connect._tcp` with no `adb connect` needed -
and the recorded port 37747 had in fact gone stale and was refused. So try
`adb devices -l` first and only go looking for a port if nothing appears.
Wireless debugging must still be switched on at the phone.

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
synced-folder export in stage 15 is what has to exist before that line is
crossed.

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
    nav.ts          the screen stack; back() reports whether it popped
  ui/
    AppHeader.tsx   app bar; back arrow or the wordmark, never both
    Home.tsx        next-up template, start a workout
    ActiveSession.tsx  THE LOGGING LOOP - header, scroller, docked entry bar
    EntryField.tsx  one number: step buttons that are also the drag handle,
                    and the number itself as the keypad
    RestBar.tsx     in-app countdown; red count-up past zero
    MuscleBadge.tsx the coloured identity circle, header and strip
    TimerSpike.tsx  throwaway harness for the timer - behind `debug`
    DbSmoke.tsx     throwaway on-device check of the db layer - same
scripts/
  import.ts         CSV -> SQLite, drop-and-rebuild, reconciliation
  migrate.ts        Node migration runner, backs up first
  profile.ts        format-agnostic CSV profiler
  analyze-backup.ts read-only reader for the .pgnbkp app backup; joins it to
                    the CSV to recover exercise names, then prints only
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
npm run test         # vitest (161 tests)
npm run lint         # oxlint
npm run import       # rebuild db/ from the CSV; refuses after cutover
npm run profile      # profile any CSV's structure
npm run analyze:backup  # read the .pgnbkp app backup; --all for archived plans
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

**Where the plan is up to.** The original ten-stage plan rebuilt the logging
screen around what `docs/PROGRESSION.md` measured. **Resequenced 2026-08-13**
against a set of notes from the user, which added navigation, a summary screen,
mid-workout exercise editing and an exercise library. The ordering principle
chosen was **workout flow first**: one workout has to feel right end to end
before the app grows more screens.

Stages 0 to 6 are **done and verified on device**: the pre-migration backup, the
palette, all the pure logic, repo and schema groundwork, the docked entry bar,
the navigation shell, weight beside reps, and pre-created set slots.

Each stage is independently shippable. Prove each on the phone before starting
the next - screenshot before every tap.

5. ~~**Entry bar relayout: weight beside reps.**~~ **Done and verified on
   device** - see "Entry bar, weight beside reps" above for the measurements.
6. ~~**Pre-created set slots.**~~ **Done and verified on device** - see "Set
   slots" above.
7. **Swipe pager and aligned history.** Replace the tap strip with a CSS
   scroll-snap pager (`snap-x snap-mandatory`, no new dependency), syncing the
   index from an `IntersectionObserver` rather than a scroll handler. Keep a
   slim `3/11` in the header so position is never ambiguous. Render one card per
   session from the widened `recentPerformance`, and **highlight the row whose
   index matches the active slot** - the single highest-value detail found in
   the investigation. Watch for the pager fighting the system edge-swipe back
   gesture, which now has a real consumer.
8. **Auto-advance, and the summary screen.** Logging the last set of an exercise
   moves to the **next incomplete** exercise, not simply `index + 1`, so going
   back to add a set does not trap you at the end. When every exercise is
   complete, go to the summary instead. `Finish` and back both route there.
   **The summary is not a save.** Sets are written as they are logged, so the
   button says `Finish workout` and never implies that backing out discards
   anything. It carries duration, set count, volume, and `Back to workout` /
   `Discard workout` beside it.
9. **Session plan snapshot, picker, swap / cut / add.** `ActiveSession` reads
   its exercise list straight from the template today, so editing a workout in
   progress would silently rewrite the programme. **Migration 0005 adds
   `session_exercises`**, copied from the template by `startSession`. Land the
   behaviour-neutral read swap first and prove it on device, then the picker
   (`searchExercises` is written, tested and ordered by recency), then add,
   remove, reorder and `Replace`. Soft deletes only. Templates are untouched;
   the one route back to a template is an explicit action on the summary.
   **Also the real `Add set`**, which belongs here and nowhere earlier: a row
   below the slots that raises this session's `target_sets` so `2/2` becomes
   `2/3`, with `Delete` on an unperformed slot to undo it. It needs a
   per-session row to increment, which is what this stage creates. Stage 6's
   trailing dashed slot is the stand-in until then.
10. **Rest timer as an app-bar pill**, replacing `RestBar.tsx`: draining fill
    while counting down, solid red counting up past zero, tap to skip. **Fix the
    cold-start gap here** - `restEndsAt` is React state, so a killed app loses
    the in-app countdown while the service keeps counting. Add a `state()`
    method to `RestTimerPlugin` returning the service's `endsAt` and read it on
    mount; the service already holds the value, so nothing needs persisting.
11. **Exercise library and exercise detail.** Guidance ships as a static table
    keyed by exact exercise name, exactly like `logic/exerciseMuscles.ts`,
    seeded into the database by a **fill-blanks** seeder like `seedMuscles.ts`
    so a hand edit survives a re-run. Migration 0006. Author the 21 programme
    exercises first; the rest render "no guidance yet". The detail screen is the
    first thing in the app to read the five years back: full per-exercise
    history, one statement, no query in a loop. **`load_mode = 'assistance'`
    inverts** - 420 imported sets record assistance, where a higher number is an
    easier set, so a naive "best" reads backwards.
12. **Template editor.** The insight worth copying is **reuse**: the reference
    app mounts the same per-exercise editor in the live workout and in the
    template, which is what stops the two drifting. Add / remove / reorder,
    rep-range, sets and rest editing. The rep-range columns already exist and
    are populated; nothing can edit them, which is the whole gap. Must write
    `seedPlanTemplates`-shaped soft deletes, never hard ones, and must never
    re-read `plan.ts` at runtime or an edit is silently undone on next launch.
13. **Plate chips**, rendering `platesFor` above the entry fields and
    recomputing on every keystroke and scrub tick. Gated on `loading` being
    plate-loaded, so **populating `loading` and the `plate_inventory` /
    `app_settings` rows is part of this stage** - all three are empty today.
    See "How load is made up".
14. **The settings that matter in a gym**: `Increment (Weight)`, `Keep screen on
    while training`, a toggle for the overlay bubble, and rest `Vibrate` /
    `Sound`. Columns already exist in `app_settings`.

Then, still blocking cutover:

15. **Backups, and the cutover procedure itself.**
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
16. **Delete the spikes** - `src/ui/TimerSpike.tsx` and `src/ui/DbSmoke.tsx`,
    plus the `debug` screen in `App.tsx`, once the logging loop owns the timer
    and the database. `DbSmoke` still earns its place until stage 10, since it
    is the only on-device proof of the window functions `recentPerformance`
    needs.

### Not blocking cutover

- Progression cue is currently advisory text only. It could pre-fill the next
  session's weight, which is the natural payoff of `shouldIncreaseLoad`.
- Progress and statistics views. Stage 11 gives one exercise its full history,
  which is the first thing to read the five years back at all, but there is
  still nothing that looks across exercises or over time.
- `npm run dev` in the browser runs against an empty jeep-sqlite database. Some
  seed path would make UI work possible without a phone attached.

### Phase-1 details already settled

- Default unit **lb**; steppers ±5 and ±1 rep. The secondary ±2.5 button was
  **removed in stage 3** now that the scrub and the keypad exist, matching the
  reference app's single configurable increment. The measurement behind the
  original pair still stands (5,793 of 5,866 weighted sets are whole pounds).
  Still to decide with a thumb: whether the ±2.5 row is missed in a gym.
- Only `load_mode` is needed at import, and only for 4 exercises - a five-minute
  file. `modality`, `primary_muscle`, `loading` stay nullable and get filled in
  lazily. `primary_muscle` is now 83 of 87; `modality` and `loading` are still
  empty, and **stage 13** needs `loading`.
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
