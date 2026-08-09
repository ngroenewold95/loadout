/**
 * Set-entry rules: what fields an exercise shows, and how the steppers move.
 *
 * Pure, so the two-tap logging loop can be tested without rendering anything.
 *
 * The stepper sizes are measured, not guessed: 5,793 of the 5,866 weighted sets
 * in five years of history are whole pounds and only 73 are not multiples of 5.
 * So ±5 lb is the primary control, ±2.5 lb the secondary, and the numeric keypad
 * hides behind a tap on the number itself - it is the rare path.
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

/** The rep target as the UI writes it: `2 × 5-8`, or `2 × 10` when fixed. */
export function formatTarget(
  sets: number | null,
  repMin: number | null,
  repMax: number | null,
): string | null {
  if (sets == null && repMin == null) return null
  const reps =
    repMin == null
      ? null
      : repMax == null || repMax === repMin
        ? String(repMin)
        : `${repMin}-${repMax}`
  if (sets == null) return reps
  return reps == null ? `${sets} sets` : `${sets} × ${reps}`
}
