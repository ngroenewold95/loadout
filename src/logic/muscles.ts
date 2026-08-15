/**
 * Muscle groups, and the colour each one wears.
 *
 * This exists because a template is a list of 21 names that all begin with
 * "Machine" or "Cable". Giving every exercise its group, in the same form in
 * the picker, the workout and the summary, is what makes that list scannable:
 * the exercise is recognised rather than read.
 *
 * **The mark is a colour and the group's name**, not a lettered circle - see
 * `ui/GroupTag.tsx`. The circle came from the reference app and was compared
 * against two alternatives on the phone; it lost on the fault it always had,
 * that Chest and Calves are both `C` and Back and Biceps both `B`, so the
 * letter said nothing and two similar reds four rows apart had to carry the
 * whole identity. The colours below are the measured part and are unchanged.
 *
 * `exercises.primary_muscle` is nullable free text, so `muscleMark` has to
 * degrade rather than assume. There is deliberately no CHECK constraint on the
 * column: adding one would force a table rebuild, which `PROJECT.md` records as
 * the migration shape that has already produced broken SQL here.
 */

export const MUSCLES = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'legs',
  'calves',
  'abs',
] as const

export type Muscle = (typeof MUSCLES)[number]

/**
 * Measured out of Progression, except `biceps`.
 *
 * `biceps` was never sampled - no biceps exercise happened to be on screen
 * during the investigation - so it is chosen. The first choice was `#7A3FA8`,
 * a purple picked to sit in the same family as `legs`. **Seen on device that
 * was a mistake:** at the 20 px strip size it is barely separable from
 * `legs` `#6226C7`, and the two co-occur on *both* programme days, which is
 * exactly when the colour has to do its job. Orange is the nearest unused hue;
 * it is far more saturated than the tan `shoulders`, so those stay distinct too.
 *
 * The constraint to preserve when touching any of these: no two groups that
 * appear on the same day may be close in hue.
 */
export const MUSCLE_COLORS: Record<Muscle, string> = {
  chest: '#971E1E',
  back: '#0A4BC7',
  shoulders: '#B67B51',
  biceps: '#B4530A', // chosen, not measured - see above
  triceps: '#0B8776',
  legs: '#6226C7',
  calves: '#851342',
  abs: '#00793B',
}

/** What an exercise with no group wears. Never a guessed colour: four of the
 *  87 are deliberately unclassified, and cardio has no primary group to state. */
export const UNKNOWN_COLOR = '#424655'

export interface MuscleMark {
  /** Null when the column is empty or holds something outside `MUSCLES`. */
  muscle: Muscle | null
  color: string
}

function isMuscle(value: string): value is Muscle {
  return (MUSCLES as readonly string[]).includes(value)
}

/**
 * The identity to draw for an exercise.
 *
 * Accepts whatever is in the column, including `null` and values that are not
 * in `MUSCLES`, because the column is free text and mostly empty. Matching is
 * case-insensitive and trims, so a hand-typed `"Back "` still lands.
 *
 * Returns the group itself rather than a letter, because the UI now writes the
 * word out. A letter was only ever a compression of this, and a lossy one.
 */
export function muscleMark(primaryMuscle: string | null | undefined): MuscleMark {
  const key = primaryMuscle?.trim().toLowerCase() ?? ''
  if (!key || !isMuscle(key)) return { muscle: null, color: UNKNOWN_COLOR }
  return { muscle: key, color: MUSCLE_COLORS[key] }
}
