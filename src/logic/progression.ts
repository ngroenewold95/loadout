/**
 * Progression export -> loadout domain model.
 *
 * Four things in this file exist because the raw export lies about its own
 * shape. Each is load-bearing; see the comment at each site.
 */
import { parseClock, parseNumber, parseInteger } from './csv'
import { toKg } from './units'
import type { LoadMode, SetType, TrackingType } from '../db/schema'

export const COLUMNS = {
  date: 'Date',
  time: 'Time',
  workoutName: 'Workout Name',
  workoutDescription: 'Workout Description',
  exercise: 'Exercise Name',
  setOrder: 'Set Order',
  setTimestamp: 'Set Timestamp',
  weight: 'Weight',
  weightUnit: 'Weight Unit',
  reps: 'Repetitions',
  distance: 'Distance',
  distanceUnit: 'Distance Unit',
  setDuration: 'Set Duration (s)',
  rpe: 'RPE',
  setComment: 'Set Comment',
  sessionComment: 'Session Comment',
  sessionDuration: 'Session Duration (s)',
} as const

/**
 * Exercises whose logged number is machine ASSISTANCE, not load: a higher
 * value means an EASIER set, so PR detection must invert.
 *
 * Assisted Chinup runs 115 lb (2023) down to 25 lb (2026) - that decline is
 * the user getting stronger. Reps confirm it: 115 lb averages 9.1 reps while
 * 25 lb averages 6.7.
 *
 * `Chinup` and `Chest Dip` carry no "Assisted" marker but behave identically,
 * so this cannot be inferred from the name. Note the rule only applies to rows
 * that HAVE a weight - Chinup's unweighted 2025 period and Chest Dip's 53
 * blank rows are plain bodyweight, which falls out of this automatically
 * without needing date ranges.
 */
export const ASSISTED_EXERCISES = new Set([
  'Assisted Chinup',
  'Assisted Pullup',
  'Chinup',
  'Chest Dip',
])

/** Two-handed dumbbell work logs the PAIR total; single-arm logs one bell. */
export const DUMBBELL_PAIR_HINT = /^(?!Single-Arm)(.*\bDumbbell\b.*)$/

export interface RawRow {
  record: Record<string, string>
  line: number
}

export interface MappedSet {
  sessionKey: string
  exerciseName: string
  /** Position within the exercise - the export's `Set Order`. */
  setIndex: number
  /** Position within the session, derived by sorting set timestamps. */
  orderIndex: number
  performedAtUtc: number | null
  weightKg: number | null
  enteredValue: number | null
  enteredUnit: 'kg' | 'lb' | null
  loadMode: LoadMode
  reps: number | null
  durationS: number | null
  distanceM: number | null
  rpe: number | null
  setType: SetType
  notes: string | null
  sourceLine: number
}

export interface MappedSession {
  key: string
  name: string | null
  localDate: string
  startedAtUtc: number
  endedAtUtc: number
  notes: string | null
}

export interface Anomaly {
  kind: string
  detail: string
  sessionKey?: string
  line?: number
}

export interface MappedExport {
  sessions: MappedSession[]
  sets: MappedSet[]
  exercises: { name: string; trackingType: TrackingType; loadMode: LoadMode }[]
  anomalies: Anomaly[]
}

/**
 * Convert a local wall-clock date + seconds-after-midnight to an epoch.
 *
 * The export contains NO timezone information anywhere. Rather than let the
 * importing machine's TZ leak into stored values - which would make re-running
 * the import on another machine produce different numbers - the wall clock is
 * interpreted as UTC. `local_date` remains the field that carries real meaning;
 * this epoch is explicitly the derived, lossy one.
 */
export function wallClockToEpoch(localDate: string, secondsOfDay: number): number {
  return Date.parse(`${localDate}T00:00:00Z`) + Math.round(secondsOfDay * 1000)
}

function sessionKeyOf(r: Record<string, string>): string {
  return `${r[COLUMNS.date]} ${r[COLUMNS.time]}`
}

/** Infer the shape of an exercise from the rows actually logged against it. */
function inferTrackingType(rows: RawRow[]): TrackingType {
  const has = (col: string) =>
    rows.some(({ record }) => parseNumber(record[col]) !== null)
  if (has(COLUMNS.distance)) return 'distance_time'
  if (has(COLUMNS.weight)) return 'weight_reps'
  if (has(COLUMNS.reps)) return 'bodyweight'
  if (has(COLUMNS.setDuration)) return 'duration'
  return 'weight_reps'
}

export function mapExport(rows: RawRow[]): MappedExport {
  const anomalies: Anomaly[] = []

  // ---- sessions ---------------------------------------------------------
  const bySession = new Map<string, RawRow[]>()
  for (const row of rows) {
    const key = sessionKeyOf(row.record)
    const bucket = bySession.get(key)
    if (bucket) bucket.push(row)
    else bySession.set(key, [row])
  }

  const sessions: MappedSession[] = []
  const sets: MappedSet[] = []

  for (const [key, group] of bySession) {
    const first = group[0].record
    const localDate = first[COLUMNS.date]
    const endSec = parseClock(first[COLUMNS.time])
    const durationS = parseNumber(first[COLUMNS.sessionDuration])

    if (endSec === null) {
      anomalies.push({ kind: 'unparsable-time', detail: first[COLUMNS.time], sessionKey: key })
      continue
    }

    /**
     * `Time` is the session END, not the start. Measured: Time minus the LAST
     * set timestamp has a median of 37 s, while Time minus the FIRST is ~59 min
     * - the session length. Treating it as the start would shift every one of
     * the 339 sessions forward by about 72 minutes.
     */
    const endedAtUtc = wallClockToEpoch(localDate, endSec)
    const startedAtUtc = endedAtUtc - (durationS ?? 0) * 1000

    const setTimes = group.map(({ record }) => parseClock(record[COLUMNS.setTimestamp]))
    const lastSet = Math.max(...setTimes.filter((s): s is number => s !== null))

    /**
     * Consistency check, not a duration threshold. Session Duration legitimately
     * ranges 1,409-7,598 s and 68 sessions exceed 4,850 s, so thresholding
     * produces false positives. Comparing the header time against the last set
     * isolates exactly one bad session (2025-12-02, left running 119 hours).
     */
    if (Number.isFinite(lastSet) && endSec < lastSet - 2) {
      anomalies.push({
        kind: 'end-time-before-last-set',
        detail: `header Time ${first[COLUMNS.time]} precedes last set; session likely left running`,
        sessionKey: key,
      })
    }

    sessions.push({
      key,
      name: first[COLUMNS.workoutName]?.trim() || null,
      localDate,
      startedAtUtc,
      endedAtUtc,
      notes: first[COLUMNS.sessionComment]?.trim() || null,
    })

    /**
     * `Set Order` is the index within an EXERCISE (max 4), not within the
     * session - the export never records exercise order. Recover it by sorting
     * on set timestamp, which also preserves the 12 sessions where exercises
     * genuinely interleave as supersets.
     */
    const ordered = group
      .map((row, i) => ({ row, t: setTimes[i] ?? Number.POSITIVE_INFINITY }))
      .sort((a, b) => a.t - b.t)

    ordered.forEach(({ row, t }, orderIndex) => {
      const rec = row.record
      const rawWeight = parseNumber(rec[COLUMNS.weight])
      const unit = (rec[COLUMNS.weightUnit]?.trim() || null) as 'kg' | 'lb' | null
      const exerciseName = rec[COLUMNS.exercise]

      if (rawWeight !== null && unit === null) {
        anomalies.push({ kind: 'weight-without-unit', detail: exerciseName, line: row.line })
      }

      const reps = parseInteger(rec[COLUMNS.reps])
      if (reps === null && rec[COLUMNS.reps]?.trim()) {
        anomalies.push({
          kind: 'fractional-reps',
          detail: `${exerciseName}: ${rec[COLUMNS.reps]}`,
          line: row.line,
        })
      }

      sets.push({
        sessionKey: key,
        exerciseName,
        setIndex: parseInteger(rec[COLUMNS.setOrder]) ?? 0,
        orderIndex,
        performedAtUtc: t === Number.POSITIVE_INFINITY ? null : wallClockToEpoch(localDate, t),
        weightKg: rawWeight === null ? null : toKg(rawWeight, unit ?? 'lb'),
        enteredValue: rawWeight,
        enteredUnit: rawWeight === null ? null : unit,
        loadMode:
          rawWeight !== null && ASSISTED_EXERCISES.has(exerciseName)
            ? 'assistance'
            : 'total',
        reps,
        durationS: parseInteger(rec[COLUMNS.setDuration]),
        // The export records distance in km; storage is metres.
        distanceM: (() => {
          const d = parseNumber(rec[COLUMNS.distance])
          if (d === null) return null
          const du = rec[COLUMNS.distanceUnit]?.trim()
          if (du && du !== 'km') {
            anomalies.push({ kind: 'unexpected-distance-unit', detail: du, line: row.line })
          }
          return Math.round(d * 1000)
        })(),
        rpe: parseNumber(rec[COLUMNS.rpe]),
        // The export has no set-type column. Warm-up ramps demonstrably exist
        // (~20 of 2,124 blocks) but cannot be classified here, so say so
        // rather than defaulting everything to 'working'.
        setType: 'unknown',
        notes: rec[COLUMNS.setComment]?.trim() || null,
        sourceLine: row.line,
      })
    })
  }

  // ---- exercises --------------------------------------------------------
  const byExercise = new Map<string, RawRow[]>()
  for (const row of rows) {
    const name = row.record[COLUMNS.exercise]
    const bucket = byExercise.get(name)
    if (bucket) bucket.push(row)
    else byExercise.set(name, [row])
  }

  const exercises = [...byExercise].map(([name, exRows]) => ({
    name,
    trackingType: inferTrackingType(exRows),
    loadMode: (ASSISTED_EXERCISES.has(name) ? 'assistance' : 'total') as LoadMode,
  }))

  sessions.sort((a, b) => a.startedAtUtc - b.startedAtUtc)

  return { sessions, sets, exercises, anomalies }
}
