# How Progression's UI works - measured

Companion to `PROJECT.md`. That document's "How Progression does it (measured)"
section covers the reference app's **process architecture** - the foreground
service, the overlay, the notification flags - and settled the rest-timer
design. This one covers its **UI and the run-a-workout flow**.

Everything here was measured on the device. Anything unverified says so.

Last updated: 2026-08-09

---

## What was inspected, and how

Progression Lite 6.0 (`workout.progression.lite`, `versionCode=3333`,
`minSdk=24`, `targetSdk=36`) driven live on the Pixel 7 test phone,
1080x2400 at 420 dpi (411 dp wide).

A scratch workout was started, a real set logged, the rest timer run past zero,
every menu on the logging screen opened, the Settings tree walked, and the plate
solver deliberately overloaded. Both scratch workouts were **deleted afterwards**
through the workout overflow menu; the Home stats were unchanged at 5 workouts
and 82 sets before and after.

Two constraints on the method:

- **`uiautomator dump` fails** with "could not get idle state" and no
  accessibility tree is exposed, so there is **no view hierarchy to read**.
  Every layout fact here comes from pixels. Spacing and sizes are eyeballed;
  colours are histogrammed and exact.
- **Screenshot before every tap.** `PROJECT.md` records why: the layout shifts
  as rest bars and chips appear, and one blind tap meant for LOG SET landed on
  *Finish workout*.

The test phone holds a copy of the real history - `22 Jul`, the 215 lb rows and
the 11-exercise `Day 1` all match `Examples/Plan.md`.

**Not inspected:** the finish-workout summary screen (it would have written a
session row), the History tab, the Statistics tab, the exercise detail page, and
the superset flow beyond its menu entry.

---

## The logging screen

### The workout is a horizontal pager

Swiping left or right moves between exercises. Confirmed by swiping from
`Bent-Over Barbell Row` to `Assisted Chinup` in one gesture with no tap target
involved. The per-exercise editor is the same pager, with page dots.

loadout uses a horizontally scrolling **tap strip** instead
(`src/ui/ActiveSession.tsx`), which asks for an accurate tap on a small chip
while the layout is moving.

### Sets are pre-created slots, not appended chips

An exercise opens with `Set 1` / `Set 2` / `Set 3` already listed, an `Add set`
row underneath, and a header reading `0/3 Sets done`. Completing a set rewrites
that row **in place** to `185 lb x 8 reps` and moves the active badge to the
next slot.

Every slot carries its own overflow with **Edit / Delete**, so any set can be
corrected. loadout appends chips and can only undo the tail.

### History is a stack of session cards, positionally aligned

Below today's sets sit one card per past session - `22 Jul / 17 days ago`, then
`3 Jul / 36 days ago`, scrolling further back. Each lists that session's sets as
numbered rows.

**The detail worth stealing: the history row matching the set you are about to
do is highlighted.** On set 1 the `1` badge is lit; after completing set 1 the
highlight moves to `2`. "What did I do for this set last time" is answered
without reading, while under a bar.

### Entry is a docked bar that never moves

Pinned to the bottom: plate chips, `Weight (Lb)` and `Repetitions`, then
`Comment` and `Complete`. When the keyboard opens the bar rides above it and the
content behind compresses, so **the buttons stay put relative to the thumb**.
Logging set after set involves zero layout shift.

`Comment` sits beside `Complete` as an equal. `PROJECT.md` records that
`Set Comment` is where five years of machine base weights live, so that is the
control which keeps the habit alive.

### Three ways to change a number

| Gesture | Result |
|---|---|
| Tap the chevrons | one step |
| **Drag vertically on the chevrons** | continuous scrub, about one step per 40 dp |
| Tap the number itself | system numeric keypad, decimal and minus available |

Measured: a 246 px drag up moved 185 -> 195 lb, a 500 px drag down moved
195 -> 170 lb, and a 146 px drag on the reps field moved 8 -> 9.

Settings calls this the **"drag handle"** and exposes its step as
`Increment (Weight)`, **a user setting, 5 here**. So there is exactly one step
size, chosen once, and the keypad covers everything else. That is worth weighing
against loadout's `WEIGHT_STEPS` primary/secondary pair: the scrub makes
distance cheap and the keypad makes precision cheap, so a second button may not
be needed.

### Rest timer is a pill in the app bar

| State | Appearance |
|---|---|
| Idle | plain alarm outline icon |
| Counting down | blue pill, alarm icon and `M:SS`, **the fill draining right to left** |
| Past zero | solid red, counting **up**, no `+` prefix, never auto-dismisses |
| Tap while running | skips the rest immediately, no confirmation |
| Tap while idle | full-screen `Rest timer` / `Stopwatch` page: big ring, `2:00`, `- 30` / play / `+ 30` |

The pill costs no vertical space and cannot shift the layout. loadout's
`src/ui/RestBar.tsx` is a full-width bar that pushes content down when it
appears.

Backgrounded, the overlay bubble appears - confirmed as
`mAlertWindows={Window{... workout.progression.lite}}` in `dumpsys window` - as
a dark circle with red count-up text and no progress ring once past zero.

For the record, consistent with the `showChronometer=false` finding already in
`PROJECT.md`: the service is `progression.app.countdown.CountdownService`,
`isForeground=true`, `types=0x40000000` (`SPECIAL_USE`); the notification is
`channel=training`, `flags=ONGOING_EVENT|NO_CLEAR|FOREGROUND_SERVICE|SILENT`,
`category=workout`, `color=0xff1a72ff`. `numUpdatedByApp=233` against
`numPostedByApp=5` - it redraws continuously rather than using the OS
chronometer.

### Menus stop at two items

| Where | Options |
|---|---|
| Workout (top right) | Edit / **Delete** |
| Set row | Edit / **Delete** |
| Exercise card | Superset / Edit / Replace / **Remove** |
| Exercise editor | Note, Rest between sets, Superset, `Sets` -/+ stepper, per-set list |

`Replace` has no analogue in loadout: swap an exercise mid-workout keeping its
slot, for when a machine is occupied.

Destructive actions are consistent - red text in the menu, then a small
`Cancel` / `Delete` dialog. Nothing else gets a confirm.

---

## The plate calculator

For barbell lifts the entry bar carries coloured plate chips with count badges
and the bar weight on the right. It recomputes on every keystroke and every
scrub tick. `Assisted Chinup` showed **no chip row at all**.

| Entered | Chips | Arithmetic |
|---|---|---|
| 215 lb | 45, 35, 5 | 85/side x 2 + 45 bar |
| 185 lb | 45, 25 | 70/side x 2 + 45 bar |
| 195 lb | 45, 25, 5 | 75/side x 2 + 45 bar |
| 170 lb | 45, 10, 5, 2.5 | 62.5/side x 2 + 45 bar |

Settings holds exactly three controls: `Show during training` subtitled
**"Visible for barbell exercises."**, `Equipment weight: 45 Lb`, and
`Available plates`.

**It is inventory-aware.** `Available plates` lists every denomination with a
count of how many you own. Owned here: `2.5, 5, 10, 25, 35, 45` at 8 each.
Everything else - 0.25 through 1.5, 3, 4, 7.5, 12.5, 15, 20, 30, 40, 50, 55, 65
- is 0. Note there is **no 20 lb plate**, and every solution above used only
owned denominations. A solver that ignores counts would propose plates that are
not in the gym.

**Counts are totals, halved per side.** Entering an absurd 49,515 lb makes the
solver show its whole hand: every owned denomination appears capped at **4**
against an inventory of 8, followed by a **dashed outline chip reading
`24.2K`**. The arithmetic confirms it exactly - `4 x (45+35+25+10+5+2.5) = 490`
lb per side, and `(49515 - 45) / 2 - 490 = 24245`.

So two rules, both worth copying:

- the solver is bounded by **real inventory**, not just by denomination
- an unreachable target is reported as a **visually distinct dashed remainder
  chip**, not rounded away or silently dropped

**The one limitation not to copy:** `Equipment weight` is a single global value
with no per-exercise override anywhere in the app. `Day A - Trap Bar` opens with
`Trap Bar Deadlift`, and a trap bar is not 45 lb. Progression also cannot
distinguish a plate-loaded machine from a selectorised stack, though
`PROJECT.md` shows the imported history already contains that distinction:
`"Machine weight 100" + 7x45/side` reconciles exactly to a logged 730 lb, while
`8x45` -> 460 and `10x45` -> 550 only reconcile as base plus *total* plates.

---

## The palette

Histogrammed from the screenshots rather than eyeballed. The colours come back
perfectly flat and quantised - **no gradients, no translucency, no elevation
shadows anywhere**. Material 3 dark with a tonal palette, every surface a solid
fill.

### Surfaces

| Role | Hex |
|---|---|
| Page background | `#11131B` |
| Card, entry bar, dialog | `#191C27` |
| Bottom nav | `#1D1F28` |
| Popup menu | `#272A32` |
| Input field | `#282C38` |
| Inactive track (drained rest pill) | `#32343D` |
| Disabled, inactive set badge | `#424655` |

### Primary and text

| Role | Hex |
|---|---|
| Primary (CTA fill, active set badge) | `#B4C5FF` |
| On-primary (the CTA label) | `#002A77` |
| Primary container (active nav pill) | `#2F447F` |
| Text | `#E1E2ED` |
| Text, secondary | `#C3C6D8` |

### Semantic

| Role | Hex |
|---|---|
| Rest pill, counting down | `#0058E6` |
| FAB, brand blue | `#0A4BC7` |
| Rest pill, past zero | `#971E1E` |
| Destructive text | `#B52626` |

### One accent set, used twice

Muscle groups: Legs `#6226C7`, Calves `#851342`, Chest `#971E1E`, Back
`#0A4BC7`, Shoulders `#B67B51`, Abs `#00793B`, Triceps `#0B8776`.

Plates **reuse the same values** rather than introducing a second scale: 45 lb
`#0A4BC7`, 35 lb `#705B00`, 25 lb `#00793B`, 10 lb `#3B4655`, 5 lb `#4A3426`,
2.5 lb `#3B4855`. The discipline is worth copying; the assignments are not
necessarily.

### Why it reads better than loadout's

In order of how much it matters:

1. **The card is lighter than the page.** `#191C27` on `#11131B` is a real step.
   loadout puts neutral-900 cards on a neutral-950 page, nearly the same value,
   so nothing reads as an object.
2. **The primary is a light tint on dark, not a saturated mid-tone.** `#B4C5FF`
   with `#002A77` text is high contrast and calm; `emerald-700` with white text
   is louder and lower contrast.
3. **Colour is reserved for identity and state, never decoration.** All surfaces
   are neutral blue-greys. The only saturated pixels on the logging screen are
   the avatar, the plate chips, the active badge and the CTA.

---

## Smaller things worth taking

None of these need new schema:

- **Progress as a fraction, always visible** - the pinned header reads
  `0/3 Sets done`. loadout shows a target but never how far through you are.
- **A session elapsed timer in the app bar.** loadout stores
  `sessions.started_at_utc` and shows nothing.
- **Relative dates beside absolute ones** - `22 Jul` left, `17 days ago` right.
  The absolute answers "which session", the relative answers "am I due".
- **The muscle-group avatar is the exercise's identity everywhere** - picker,
  workout, template, the same circle. It makes 21 similar names scannable.
  loadout has `exercises.primary_muscle` and renders it nowhere.
- **The picker is multi-select with a running count on the FAB.** Four exercises
  is four taps and one confirm.
- **Templates state their size** - `11 Exercises / 22 Sets` - and program cards
  carry a `2 workouts per week` eyebrow. Both are queries loadout already has.
- **Programs surface next-up as a badge on the day** with `Start workout` inline
  underneath, rather than as a separate card. Same semantics as `nextTemplate`.
- **The next-up card previews its exercises**: "Day 1 - Day A - Trap Bar - Trap
  Bar Deadlift, Smith Machine Bulgarian Split Squat & Smith Machine Incline
  Bench Press + 7".

### Settings worth having

`Keep screen on while training`; `Show while in background` as a toggle for the
overlay bubble; rest timer `Start automatically` ("Starts when you complete a
set"), `Vibrate` and `Sound`. Section headers sit on a raised bar in the primary
tint.

---

## Where loadout already agrees

Worth stating, because the temptation is to change more than is warranted:

- **Prefill from last session.** Progression seeded 215 x 8 and 20 x 8, both the
  previous session's set 1. `prefillFor` already does this with a better
  fallback chain.
- **Rest starts as a side effect of completing a set**, never its own tap.
- **One absolute `endsAt` shared by every renderer.**
- **Rolling next-up rather than weekday-pinned.**
- **Dark, tabular numerals, no hover states.**

And two places loadout is **ahead**:

- Progression shows **no progression cue at all**. `shouldIncreaseLoad` and
  "Top of the range on every set" have no counterpart.
- Progression renders `Assisted Chinup` as a plain weight with no indication
  that a higher number is easier. loadout's `load_mode` models this properly.
