# loadout — plan, findings, next steps

Living document, and the handoff point for a cold start. Anything stated as
fact was **measured**; anything unverified says so explicitly. Update it when
something is *learned*, not when something is planned.

Last updated: 2026-08-08

---

## What this is

Personal Android workout logger replacing Progression. Single user, offline
first, no server, no sync. Imports ~5 years of history.

**The constraint that decides everything:** logging a set must take about two
taps. A better data model does not compensate for a slower logging loop.

Reference app `workout.progression.lite` is installed on the device and is a
legitimate baseline — inspect it with `adb` when a behaviour question comes up.
Doing so has already overturned two wrong assumptions.

---

## Current state

Working and verified on device (Pixel 7, Android 17 / API 37):

- Vite + React 19 + TS 6 + Tailwind 4 + Capacitor 8.5, app installs and runs
- Schema + migration 0000, with STRICT and CHECK constraints **proven** to
  reject bad data and partial unique indexes allowing reuse of soft-deleted names
- `npm run import` — 6,140 sets / 339 sessions / 86 exercises, **total volume
  7,463,140 lb matching exactly** between CSV and DB (round-trips 5,866 weights
  through lb→kg→lb, so the conversion is verified against real data)
- Templates and per-exercise rest seeded from actual history
- **Rest timer complete**: floating overlay bubble, red count-up past zero,
  5-second haptic countdown, hides while the app is in front
- 24 tests passing, typecheck clean

Not built yet: the repo layer and the entire logging UI. See Next steps.

---

## Decisions

| Area | Decision | Why |
|---|---|---|
| Stack | Capacitor + React + Vite + TS + Tailwind | Existing skill transfers; ~95% of the app is ordinary UI |
| Native language | **Java**, not Kotlin | Adding the Kotlin Gradle plugin was an unnecessary variable. Revisit if the native surface grows. |
| Storage | SQLite via `@capacitor-community/sqlite` | Relational queries, migrations as a ratchet. Not for speed — the dataset is tiny. |
| ORM | Drizzle for schema + migration generation **only** | Its runtime cannot ship to device — see below |
| State | TanStack Query for historical reads, plain store for the active session | Query invalidation fits "log a set → last-session view refreshes". A live workout is not a cached remote resource. |
| Sync | None | Conflict resolution costs more than everything else combined |
| Timer | **Foreground service + `SYSTEM_ALERT_WINDOW` overlay** | The only way to get a bubble that turns red and counts up. Matches Progression. |

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
   duplicate keys and silently misaligns every later column — **plausible wrong
   numbers, no error.**

So: `drizzle-kit generate` produces schema types and numbered SQL. The device
runs plain SQL behind `query<T>(sql, params)` / `exec(sql, params)`.
**`generate` only, never `push`** — drizzle-kit does not introspect partial
index `WHERE` clauses ([#4688](https://github.com/drizzle-team/drizzle-orm/issues/4688))
and proposes a drop-and-recreate every run.

---

## File map

```
src/
  logic/            pure TS, no React imports — the durable layer
    units.ts        kg/lb, quantisation, weightsEqual (never use ===)
    csv.ts          RFC4180 parser, parseClock/parseNumber/parseInteger
    progression.ts  export -> domain model; the four findings live here
  db/
    schema.ts       Drizzle schema; source of truth for migrations
    migrations.ts   shared migration runner (Node + device)
  ui/
    TimerSpike.tsx  throwaway harness for the timer — delete once the
                    logging loop owns it
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
Examples/           gitignored — the ONLY copy of the source export
db/                 gitignored — rebuildable until cutover
```

---

## Dev loop

```bash
npm run dev          # Vite dev server
npm run build        # tsc -b && vite build
npm run test         # vitest (24 tests)
npm run lint         # oxlint
npm run import       # rebuild db/ from the CSV; refuses after cutover
npm run profile      # profile any CSV's structure
npm run db:generate  # drizzle-kit generate + add STRICT
npm run db:migrate   # apply migrations to db/loadout.sqlite (backs up first)
```

Deploying to the phone:

```bash
npm run build && npx cap sync android
cd android && ./gradlew installDebug     # ~10s incremental, ~6min cold
adb shell am start -n com.groenewold.loadout/.MainActivity
```

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
adb shell appops set com.groenewold.loadout SYSTEM_ALERT_WINDOW allow   # grant overlay without the settings walk
adb shell pm grant com.groenewold.loadout android.permission.POST_NOTIFICATIONS
adb shell dumpsys window | grep -i mAlertWindows      # is the bubble up?
adb shell dumpsys activity services com.groenewold.loadout
adb shell am kill com.groenewold.loadout              # test process death (NOT force-stop)
adb shell screencap -p /sdcard/s.png && adb pull /sdcard/s.png
```

Screenshots must be **pulled**, not piped — PowerShell's `>` corrupts binary.

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
begin a median 472 s before the first logged set — Progression counts warm-up.
The `started_at ≤ first set` invariant holds in 334/339 sessions; the 5
exceptions overshoot by ≤0.7 s because Session Duration is integer-second while
Time is millisecond-precision. **Assert with ~2 s tolerance.**

**2. 420 sets record ASSISTANCE, where a higher number means an EASIER set.**
Assisted Chinup 140, Assisted Pullup 109, Chinup 44, Chest Dip 127. Assisted
Chinup runs 115 lb (2023) → 20 lb (2026) — that decline is getting stronger.
Reps confirm it: 115 lb averages 9.1 reps, 25 lb averages 6.7.
**Not inferable from the name** — `Chinup` and `Chest Dip` carry no marker.
Handled by `sets.load_mode`; PR detection must invert for `assistance`.
The rule applies only to rows that *have* a weight, so Chinup's unweighted 2025
period and Chest Dip's 53 blank rows fall out as plain bodyweight with no date
ranges needed.

**3. `Set Order` is the index within an EXERCISE, not the session.**
Max 4; 2,247/2,248 groups are exactly `0..n-1`. The export never records
exercise order — it is recovered by sorting `Set Timestamp`, which also
preserves the 12 sessions where exercises genuinely interleave as supersets.

**4. Machine base weights are already in the data, in `Set Comment` free text.**
`"Machine weight 100" + 7×45/side` reconciles exactly to the logged 730 lb.
This **proves** the "weight_kg is total load" principle against five years of
real logging. Notation is inconsistent though — `8x45` → 460 and `10x45` → 550
only reconcile as base + *total* plates, and the "per side" suffix does not
signal which. Any parser must try both and report which matched.

Smaller, all measured:

- **100% of history is lb.** One distinct `Weight Unit` value in five years.
- **RPE is 100% empty.** Column kept; no import plumbing.
- **91 rows have embedded newlines** in quoted fields — 56 in `Set Comment`,
  35 in `Workout Description`. Naive line-splitting gives 6,231 instead of 6,140.
- **Milliseconds are optional**: 27 `Time` and 4 `Set Timestamp` values lack
  them. Parse `HH:MM:SS[.mmm]`.
- **Reps are written as `"8.00"`** — parse as float, then require integrality.
- **Warm-up ramps exist** (~20 of 2,124 blocks) but are unclassifiable at
  import, hence `set_type = 'unknown'`.
- **9 of 105 distinct weights** fail bit-exact lb→kg→lb round-trip. Never
  compare weights with `=`; use `weightsEqual`, which quantises both sides
  first. A naive epsilon smaller than the storage grid fails exactly where it
  matters (stored value vs freshly computed one — the PR-detection shape).
- **`37.25 lb` is real**, so display rounding must be 0.25 lb, not 0.5.
- **Rest is derivable** from set-timestamp gaps: p10 110 s, median 169 s,
  p90 249 s. `default_rest_s` is seeded per exercise from actual history.
- **One corrupt session** (2025-12-02, left running 119 h). Detect via
  `Time` vs `max(Set Timestamp)` — *not* a duration threshold, since 68 sessions
  legitimately exceed 4,850 s.
- **The current split is 3-day** (`Day 1`/`Day 2`/`Day 3`, since Dec 2024), not
  the A/B assumed during planning. Templates are seeded from it.
- **Dumbbell entries are pair totals** (Incline DB Press max 200 = 2×100), while
  `Single-Arm` variants are one bell. Dumbbell Shrug and Fly double abruptly in
  Jan 2023 and were discontinued mid-2023 — flagged, not modelled.

### From the device

**A chronometer notification survives process death.** Verified with the app
process dead (`am kill`): SystemUI kept rendering the countdown from the
absolute `when` timestamp, 92 s remaining. `setWhen(endsAt)` +
`setUsesChronometer(true)` + `setChronometerCountDown(true)` is the whole
mechanism — no service, no per-second work. **This is kept as the notification
half of the timer**, alongside the overlay.

**The Android 16 status-bar chip does NOT work, despite qualifying.**
`hasPromotableCharacteristics()` returns **true** — structurally valid — but
`FLAG_PROMOTED_ONGOING` is never applied: `promoted=false, promotable=true`.
Ruled out: `IMPORTANCE_LOW` → `DEFAULT`, contentTitle present, no RemoteViews,
not colorized, not a group summary. No per-app "Live Updates" toggle appears on
this build. Untried leads if ever revisited: global Settings → Notifications →
Live Updates, and `Notification.ProgressStyle` (the feature is documented as
*progress-centric* and we post a bare chronometer).

### Corrections — recorded so they are not repeated

- `setRequestPromotedOngoing` / `setShortCriticalText` are on
  **`NotificationCompat.Builder`** (androidx core 1.17.0), *not* the platform
  `Notification.Builder`. An earlier claim that the API did not exist was wrong;
  the wrong class was inspected.
- **There is no `POST_PROMOTED_NOTIFICATIONS` permission.** Only
  `POST_NOTIFICATIONS`.
- **`am force-stop` did NOT clear notifications** on Android 17, contrary to
  guidance. Use `am kill` to test process death.
- **STRICT tables are narrower than assumed.** They reject `''` and `'abc'` in a
  REAL column (the important cases — 274 blank `Weight` fields) and `'8.5'` in
  an INTEGER column, but **accept and coerce** `'130.00'` → 130. STRICT guards
  against blank/malformed fields, not against forgetting to parse.
- **better-sqlite3 13.0.3 needs no compilation on Windows** — prebuilt N-API
  binaries ship in the tarball. The node-gyp concern applied to ≤11.x.
- **Module side effects bite.** `scripts/migrate.ts` ran a migration merely by
  being imported, holding the DB open and causing `EBUSY` on delete. CLI entry
  points are now guarded with `import.meta.url === pathToFileURL(argv[1]).href`.

---

## How Progression does it (measured)

Inspected live with its timer running. This settled the architecture question
and **reversed an earlier recommendation.**

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

## Rest timer — DONE

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

- `RestTimerService` — `specialUse` foreground service, `START_STICKY`, 100 ms
  redraw tick. Foreground services are exempt from Doze, so no alarm is needed.
- `TimerOverlayView` — custom `View` in a `TYPE_APPLICATION_OVERLAY` window.
- `MainActivity.isForeground` is a **static flag the service reads directly**.
  Inferring foreground state from the *order* of lifecycle pings was wrong:
  starting a timer from inside the app flashed the bubble over the very screen
  already showing it.
- **Haptics are one waveform, not six alarms.** Six alarms would be the worst
  possible shape for Doze — `setExactAndAllowWhileIdle` throttles to roughly
  once per 9 minutes, and rests here are 110–250 s. One
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

1. **Repo layer.** One async interface, three backends: `better-sqlite3`
   (Node/import/tests), `jeep-sqlite` (browser dev), `@capacitor-community/sqlite`
   (device). Migrations run at app start, before the first query. No query
   inside a loop — free in Node, 6,140 bridge crossings on device.
2. **Active session screen** — the logging loop, and the thing that decides
   whether this app gets used:
   - Weight and reps pre-filled from the previous set, else last session's first
   - One large `LOG SET`; it also starts the rest timer as a side effect
   - Steppers ±5 lb primary, ±2.5 secondary, ±1 rep; keypad only behind a tap on
     the number itself (5,793 of 5,866 weights are whole; only 73 are not
     multiples of 5)
   - **Last session's sets inline, always** — the highest-value feature
   - Undo last set (soft delete)
   - Entry adapts to all four row shapes: weight+reps, reps-only, duration,
     distance+duration. 274 rows have no weight, so a weight-first UI blocks
     Chest Dip, Chinup, McGill Big 3 and Plank.
   - Timer in the header while the app is open (the bubble suppresses itself)
   - Session resume on cold start
3. **Home** — templates seeded from history, resume in-progress session.
4. **Exercise picker** (search over 86, ordered by active template then recent),
   then **template editor**.
5. **Backups before cutover** — `VACUUM INTO` to a synced folder on launch and
   after each session, plus a manual export. App-private storage does not
   survive uninstall, which is the actual threat.
6. Delete `src/ui/TimerSpike.tsx` once the logging loop owns the timer.

### Phase-1 details already settled

- Default unit **lb**; steppers ±5 / ±2.5 / ±1 rep
- Only `load_mode` is needed at import, and only for 4 exercises — a five-minute
  file. `modality`, `primary_muscle` stay nullable and get filled in lazily.
- Vitest for tests; `db/*` and `Examples/` gitignored
- App id `com.groenewold.loadout` — baked in at `cap init`; changing it orphans
  the on-device database

---

## Deferred / open

- **Base weights parsed out of `Set Comment`** — ~67 rows carry a plate
  breakdown, ~30 an explicit machine base across four values (100/55/20/15 lb).
- **Alias adjudication.** Only one real rename exists: `Dumbbell Shoulder Press`
  → `(Seated)`. Do **not** merge `Machine Calf Raise`/`(Seated)`,
  `Barbell Shoulder Press`/`Strict Barbell Press`, or
  `Dumbbell Hammer Curl`/`Incline Dumbbell Hammer Curl` — the short-lived name
  sits inside the span of the long-lived one, so they are distinct exercises.
- **Per-exercise metadata** for all 86 (modality, primary muscle).
- **Import report as a product**, with a golden-file snapshot test over a
  redacted fixture cut as whole sessions (random rows destroy superset
  interleaving).
- **Strava import** into `external_activities`.
- **`.progressionbackup`** — taking the CSV as the only source, so no superset
  interleaving detector; the 12 candidate sessions get reported instead.
- **PR / e1RM model.** Epley is wrong at reps=1 (141 rows) and unreliable above
  ~10 reps (844 rows), and is incoherent for duration/distance work. PR
  detection branches per `tracking_type` and inverts for `assistance`.

### Data safety

- `Examples/` and `/db/` are gitignored. `Examples/` holds the **only copy** of
  the source export and contains medical notes and a named third party. A
  narrower pattern than `/db/` previously let `loadout.sqlite-shm` through —
  verify with `git check-ignore -v` after touching ignore rules.
- Migrations are numbered and never edited once applied. The Node runner takes a
  file copy first; on device the plugin's `addUpgradeStatement` does the same
  natively.
- `npm run import` refuses to run once any `sets.source = 'native'` row exists.
  **Cutover is one-way.**
