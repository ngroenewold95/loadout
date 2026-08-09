/**
 * The current training programme, as a seed for the templates table.
 *
 * This is a SEED, not a runtime source of truth. It is written into `templates`
 * once, and from then on the database owns them - the in-app template editor
 * has to have something to edit, and a file that silently overwrote it every
 * launch would undo every change the moment it was made.
 *
 * Replaces the Day 1 / Day 2 / Day 3 split that was seeded from history. That
 * history is still valid as history; it is simply no longer the programme.
 *
 * `exercise` values are exact `exercises.name` strings. 20 of the 21 already
 * exist with real history behind them, which is the point - the last-session
 * panel is populated from day one. Two names in the source plan were ambiguous
 * and are resolved to the variant actually in current use:
 *
 *   "Hammer curl"    -> Incline Dumbbell Hammer Curl  (used through 2026-07-22;
 *                       plain `Dumbbell Hammer Curl` was last touched in 2022)
 *   "Cable pushdown" -> Cable Pushdown (with Bar Handle)  (2026-07-19; the rope
 *                       handle variant was last used in 2024)
 *
 * Do not "tidy" these into one exercise each. PROJECT.md records why the
 * short-lived name inside a long-lived one's span is a distinct exercise.
 */

/**
 * Rest bands, straight from the programme header:
 * 3-5 min heavy compounds · 2-3 min machines · 60-90s isolation/core.
 * Stored as the midpoint, then adjustable per exercise in the editor.
 */
export const REST_S = {
  compound: 240,
  machine: 150,
  isolation: 75,
} as const

export type RestBand = keyof typeof REST_S

export interface PlannedExercise {
  /** Exact `exercises.name`. Created on seed if it does not exist yet. */
  exercise: string
  sets: number
  repMin: number
  repMax: number
  rest: RestBand
  notes?: string
}

export interface PlannedDay {
  name: string
  exercises: PlannedExercise[]
}

/**
 * Exercises the plan introduces that have no history at all.
 *
 * Only one, which is why the switch is cheap. Everything else inherits five
 * years of sets, its history-seeded rest default and its load mode.
 */
export const NEW_EXERCISES = [
  { name: 'Pallof Press', trackingType: 'weight_reps', loadMode: 'total' },
] as const

/**
 * Two days, rotated A/B/A/B rolling - deliberately NOT tied to weekdays.
 * `nextTemplate` in the repo picks whichever was performed less recently.
 */
export const PLAN: PlannedDay[] = [
  {
    name: 'Day A - Trap Bar',
    exercises: [
      { exercise: 'Trap Bar Deadlift', sets: 2, repMin: 5, repMax: 8, rest: 'compound' },
      { exercise: 'Smith Machine Bulgarian Split Squat', sets: 2, repMin: 5, repMax: 8, rest: 'compound' },
      { exercise: 'Smith Machine Incline Bench Press', sets: 2, repMin: 5, repMax: 8, rest: 'compound' },
      { exercise: 'Bent-Over Barbell Row', sets: 2, repMin: 5, repMax: 8, rest: 'compound' },
      { exercise: 'Machine Shoulder Press', sets: 2, repMin: 5, repMax: 8, rest: 'machine' },
      { exercise: 'Assisted Pullup', sets: 2, repMin: 5, repMax: 8, rest: 'machine' },
      // Standing, i.e. the plain `Machine Calf Raise`. The `(Seated)` variant is
      // a separate exercise and appears on Day B.
      { exercise: 'Machine Calf Raise', sets: 2, repMin: 10, repMax: 15, rest: 'isolation' },
      {
        exercise: 'Pallof Press',
        sets: 2,
        repMin: 10,
        repMax: 10,
        rest: 'isolation',
        notes: '10 each side',
      },
      { exercise: 'Incline Dumbbell Hammer Curl', sets: 2, repMin: 6, repMax: 10, rest: 'isolation' },
      { exercise: 'Chest Dip', sets: 2, repMin: 6, repMax: 10, rest: 'machine' },
    ],
  },
  {
    name: 'Day B - RDL',
    exercises: [
      { exercise: 'Romanian Deadlift', sets: 2, repMin: 5, repMax: 8, rest: 'compound' },
      { exercise: 'Machine Leg Curl', sets: 2, repMin: 5, repMax: 8, rest: 'machine' },
      { exercise: 'Machine Single-Leg Extension', sets: 2, repMin: 5, repMax: 8, rest: 'machine' },
      { exercise: 'Machine Chest Press', sets: 2, repMin: 5, repMax: 8, rest: 'machine' },
      { exercise: 'Machine Row', sets: 2, repMin: 5, repMax: 8, rest: 'machine' },
      { exercise: 'Machine Lateral Raise', sets: 2, repMin: 6, repMax: 10, rest: 'isolation' },
      { exercise: 'Cable Face Pull', sets: 2, repMin: 12, repMax: 15, rest: 'isolation' },
      { exercise: 'Machine Calf Raise (Seated)', sets: 2, repMin: 12, repMax: 15, rest: 'isolation' },
      { exercise: 'Cable Crunch', sets: 2, repMin: 8, repMax: 12, rest: 'isolation' },
      { exercise: 'Machine Preacher Curl', sets: 2, repMin: 6, repMax: 10, rest: 'isolation' },
      { exercise: 'Cable Pushdown (with Bar Handle)', sets: 2, repMin: 6, repMax: 10, rest: 'isolation' },
    ],
  },
]

/**
 * The programme's progression rule, in one place:
 * "hit the top of the range on both sets -> increase load".
 *
 * Pure so the logging screen and any future review can share one definition of
 * "earned". `reps` is every working set of that exercise in the session.
 */
export function shouldIncreaseLoad(
  reps: number[],
  targetSets: number,
  repMax: number,
): boolean {
  if (reps.length < targetSets) return false
  // Only the prescribed number of sets counts; extra sets do not lower the bar.
  return reps.slice(0, targetSets).every((r) => r >= repMax)
}
