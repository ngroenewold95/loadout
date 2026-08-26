/**
 * Set-entry rules: what fields an exercise shows, and how the steppers move.
 *
 * Pure, so the two-tap logging loop can be tested without rendering anything.
 *
 * The stepper sizes are measured, not guessed: 5,793 of the 5,866 weighted sets
 * in five years of history are whole pounds and only 73 are not multiples of 5.
 * So ±5 lb is the primary control, ±2.5 lb the secondary, and the numeric keypad
 * hides behind a tap on the number itself - it is the rare path.
 *
 * There are three ways to change a number here, copied from Progression (see
 * `docs/PROGRESSION.md`) because together they remove the need for any of them
 * to be good at everything: tap a stepper for one step, **drag** it for a
 * continuous scrub, or tap the number for the keypad. The scrub is what makes
 * a large change cheap, so the keypad stays the rare path it was designed to be.
 */
import { fromKg, roundForDisplay, toKg, type Unit } from './units.ts'
import type { TrackingType } from '../db/schema.ts'

/**
 * Which fields a set records.
 *
 * `weight: 'optional'` is not a nicety - `Chinup` and `Chest Dip` appear both
 * weighted and unweighted in the same history, and 274 imported rows have no
 * weight at all. A weight-first UI would block logging them.
 */
export interface EntryShape {
  weight: 'required' | 'optional' | 'none'
  reps: boolean
  duration: boolean
  distance: boolean
}

const SHAPES: Record<TrackingType, EntryShape> = {
  weight_reps: { weight: 'required', reps: true, duration: false, distance: false },
  bodyweight: { weight: 'optional', reps: true, duration: false, distance: false },
  duration: { weight: 'none', reps: false, duration: true, distance: false },
  distance_time: { weight: 'none', reps: false, duration: true, distance: true },
}

export function entryShape(trackingType: TrackingType): EntryShape {
  return SHAPES[trackingType]
}

/** Primary and secondary weight steps, per unit. */
export const WEIGHT_STEPS: Record<Unit, readonly [number, number]> = {
  lb: [5, 2.5],
  kg: [2.5, 1],
}

/**
 * How big one tap on the weight handle is, in the display unit.
 *
 * Most specific first, the same shape as the base-weight chain:
 *
 * 1. the exercise's own `default_increment_kg` - a stack that moves in 10s or
 *    15s is not a 5 lb lift, and the scrub is only as good as its step
 * 2. the global setting, which is `Increment (Weight)` in the gym settings
 * 3. `WEIGHT_STEPS`, which is what the app used before either column had a
 *    reader and is what a database with no settings row still gets
 *
 * Returned in the display unit because that is what the step button is labelled
 * with and what `stepWeight` takes.
 */
export function stepForExercise(
  exerciseIncrementKg: number | null | undefined,
  settingsIncrementKg: number | null | undefined,
  unit: Unit,
): number {
  const kg = exerciseIncrementKg ?? settingsIncrementKg
  if (kg == null || kg <= 0) return WEIGHT_STEPS[unit][0]
  return roundForDisplay(fromKg(kg, unit), unit)
}

/**
 * Move a stored kg weight by a step expressed in the DISPLAY unit.
 *
 * Round-trips through the display unit deliberately: the user thinks in pounds,
 * so "+5 lb" must land exactly on a pound value, not on 5 lb converted to kg and
 * accumulated with drift. The result is re-quantised on the way back to storage.
 */
export function stepWeight(kg: number | null, delta: number, unit: Unit): number {
  const current = kg == null ? 0 : fromKg(kg, unit)
  return toKg(Math.max(0, roundForDisplay(current + delta, unit)), unit)
}

/** Reps never go below 1 - the schema's `reps > 0` check would reject 0. */
export function stepReps(reps: number | null, delta: number): number {
  return Math.max(1, (reps ?? 0) + delta)
}

export function stepDuration(seconds: number | null, delta: number): number {
  return Math.max(0, (seconds ?? 0) + delta)
}

/**
 * Travel required to move one step when dragging on a stepper.
 *
 * Measured off Progression, which calls the control a "drag handle": a 246 px
 * drag moved 2 steps and a 500 px drag moved 5, on a 420 dpi screen. That is
 * roughly 40 dp per step, and CSS pixels in the WebView are already
 * density-independent, so the number transfers directly.
 */
export const SCRUB_PX_PER_STEP = 40

/**
 * Whole steps earned by a drag, and the travel left over.
 *
 * Pure so the gesture is testable without a pointer. The caller accumulates:
 * add the frame's movement to the carried remainder, pass the total here, apply
 * `steps`, then carry `remainderPx` into the next frame. Dropping the remainder
 * instead would make a slow drag travel further than a fast one over the same
 * distance, which is exactly the drift that makes a scrub feel unreliable.
 *
 * `deltaPx` is positive for "increase". Screen coordinates grow downward and
 * dragging **up** should add load, so the caller negates `clientY` deltas.
 *
 * Truncation rather than rounding is deliberate: no step is emitted until a
 * full step has been travelled, in either direction, so the value cannot twitch
 * under a resting thumb.
 */
export function scrubSteps(
  deltaPx: number,
  pxPerStep: number = SCRUB_PX_PER_STEP,
): { steps: number; remainderPx: number } {
  if (!Number.isFinite(deltaPx) || !(pxPerStep > 0)) {
    return { steps: 0, remainderPx: 0 }
  }
  // `|| 0` normalises the -0 that Math.trunc returns for any drag shorter than
  // one step in the negative direction. Nothing downstream cares - -0 === 0 -
  // but a primitive that reports two different zeroes is a trap for the next
  // caller.
  const steps = Math.trunc(deltaPx / pxPerStep) || 0
  return { steps, remainderPx: deltaPx - steps * pxPerStep }
}

/**
 * The outcome of typing into a number field.
 *
 * Three states, not two: a cleared field is a legitimate value (`bodyweight`
 * gives weight as optional, and 274 imported rows have no weight at all),
 * whereas `-` or `1.2.3` is garbage the caller must reject without writing
 * anything. Collapsing those two into `null` would quietly log a set with no
 * weight every time a thumb slipped.
 */
export type Parsed<T> = { ok: true; value: T | null } | { ok: false }

const INVALID: Parsed<never> = { ok: false }

/** Accepts a comma as the decimal separator, since the numeric keypad offers one. */
function toNumber(text: string): number | null {
  const cleaned = text.trim().replace(',', '.')
  if (cleaned === '') return null
  // Number('') is 0 and Number(' ') is 0, both already excluded above.
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

/**
 * Parse a typed weight in the display unit into storage kg.
 *
 * Quantises through the same path as `stepWeight`, so a weight that was typed
 * and a weight that was stepped to the same number are byte-identical in the
 * database rather than differing in the fourteenth decimal place.
 */
export function parseWeight(text: string, unit: Unit): Parsed<number> {
  const raw = text.trim()
  if (raw === '') return { ok: true, value: null }
  const value = toNumber(raw)
  if (value == null || value < 0) return INVALID
  return { ok: true, value: toKg(roundForDisplay(value, unit), unit) }
}

/**
 * Parse typed reps.
 *
 * Whole numbers of at least 1, because the schema's `reps > 0` CHECK will
 * reject anything else and a rejected INSERT mid-workout is the worst possible
 * time to find out. Note the import parses historical reps as floats first
 * (they arrive as `"8.00"`) and only then requires integrality; the same
 * two-step applies here so `8.` and `8.0` are accepted.
 */
export function parseReps(text: string): Parsed<number> {
  const raw = text.trim()
  if (raw === '') return { ok: true, value: null }
  const value = toNumber(raw)
  if (value == null || !Number.isInteger(value) || value < 1) return INVALID
  return { ok: true, value }
}

/** `M:SS`, or `H:MM:SS` past an hour. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const pad = (n: number) => String(n).padStart(2, '0')
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(s % 60)}`
    : `${minutes}:${pad(s % 60)}`
}

/**
 * Just the rep half of a target: `5-8`, or `10` when min and max agree.
 *
 * Separate from `formatTarget` because a set slot that has not been performed
 * yet shows the reps it is asking for and nothing else. Measured off the
 * reference app, where an unperformed row reads `5–8 Reps` rather than a
 * placeholder - it tells you what you are aiming for while you are aiming.
 */
export function formatRepTarget(
  repMin: number | null,
  repMax: number | null,
): string | null {
  if (repMin == null) return null
  return repMax == null || repMax === repMin ? String(repMin) : `${repMin}-${repMax}`
}

/** The rep target as the UI writes it: `2 × 5-8`, or `2 × 10` when fixed. */
export function formatTarget(
  sets: number | null,
  repMin: number | null,
  repMax: number | null,
): string | null {
  if (sets == null && repMin == null) return null
  const reps = formatRepTarget(repMin, repMax)
  if (sets == null) return reps
  return reps == null ? `${sets} sets` : `${sets} × ${reps}`
}
