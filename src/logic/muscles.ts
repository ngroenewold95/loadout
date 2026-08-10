/**
 * Muscle groups, and the colour each one wears.
 *
 * This exists because a template is a list of 21 names that all begin with
 * "Machine" or "Cable". Progression makes that list scannable by giving every
 * exercise a coloured circle with its group's initial, and using the *same*
 * circle in the picker, the workout and the template, so an exercise has one
 * visual identity everywhere. See `docs/PROGRESSION.md`.
 *
 * `exercises.primary_muscle` is nullable free text and is currently unpopulated
 * for all 86 rows, so `muscleBadge` has to degrade rather than assume. There is
 * deliberately no CHECK constraint on the column: adding one would force a table
 * rebuild, which `PROJECT.md` records as the migration shape that has already
 * produced broken SQL here.
 *
 * Two groups share an initial - Chest and Calves are both `C` - exactly as they
 * do in the reference app. The colour is what disambiguates them, which is why
 * the initial alone is never enough and the circle is never monochrome.
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

/** Neutral circle for an exercise whose group is unknown, matching the `?`
 *  avatar Progression shows for an unconfigured program day. */
const UNKNOWN = { initial: '?', color: '#424655' } as const

export interface MuscleBadge {
  initial: string
  color: string
}

function isMuscle(value: string): value is Muscle {
  return (MUSCLES as readonly string[]).includes(value)
}

/**
 * The circle to draw for an exercise.
 *
 * Accepts whatever is in the column, including `null` and values that are not
 * in `MUSCLES`, because the column is free text and mostly empty. Matching is
 * case-insensitive and trims, so a hand-typed `"Back "` still lands.
 */
export function muscleBadge(primaryMuscle: string | null | undefined): MuscleBadge {
  if (!primaryMuscle) return { ...UNKNOWN }
  const key = primaryMuscle.trim().toLowerCase()
  if (!isMuscle(key)) return { ...UNKNOWN }
  return { initial: key.charAt(0).toUpperCase(), color: MUSCLE_COLORS[key] }
}
