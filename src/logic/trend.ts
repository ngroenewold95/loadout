/**
 * What a chart of one exercise is a chart OF.
 *
 * Four tracking types and an inverted number between them, so "best set" is not
 * one column and cannot be. The repo returns every candidate per session and
 * this picks, which keeps the choice testable without a database and keeps the
 * chart component free of any opinion about what it is drawing.
 *
 * **`assistance` inverts, and the axis inverts with it.** A higher number on an
 * Assisted Chinup is an easier set - 422 sets of the imported history run that
 * way - so the best set is the LEAST assistance, and a line that falls is
 * progress. Drawing it like load would read five years of getting stronger as
 * decline, which is the exact failure `sessionTotals` and the volume expression
 * already avoid elsewhere.
 */
import type { TrackingType } from '../db/schema.ts'

/** The least a session row has to be. Mirrors `ExerciseSessionRow`. */
export interface SessionCandidate {
  localDate: string
  bestWeightKg: number | null
  leastAssistKg: number | null
  bestReps: number | null
  bestDurationS: number | null
  bestDistanceM: number | null
}

export interface TrendPoint {
  localDate: string
  /** In the series' own unit - see `TrendSeries.measure`. */
  value: number
}

export interface TrendSeries {
  points: TrendPoint[]
  /** What the numbers are, so the caller formats them without guessing. */
  measure: 'weight' | 'assistance' | 'reps' | 'duration' | 'distance'
  /** What this exercise's best set is called, for the axis and the heading. */
  label: string
  /** True when a FALLING line is improvement. Only assistance is. */
  lowerIsBetter: boolean
}

/**
 * The series to draw for one exercise.
 *
 * Sessions with nothing to plot are dropped rather than drawn as zero: a set
 * logged without the number this exercise is measured by is a gap in the
 * record, and a zero would be a claim about a session that never made it.
 */
export function trendSeries(
  sessions: readonly SessionCandidate[],
  trackingType: TrackingType,
  loadMode: string,
): TrendSeries {
  /**
   * Bodyweight work is measured by whichever number it actually carries, and
   * the choice is made ONCE for the whole series rather than per session.
   *
   * `Chinup` and `Chest Dip` appear both weighted and unweighted, so a per
   * session choice would plot pounds and rep counts on one axis and the line
   * would be meaningless where it crossed over.
   */
  const weighted =
    trackingType !== 'bodyweight' || sessions.some((s) => s.bestWeightKg != null)
  const shape = seriesShape(trackingType, loadMode, weighted)
  const points: TrendPoint[] = []

  for (const session of sessions) {
    const value = shape.pick(session)
    if (value == null) continue
    points.push({ localDate: session.localDate, value })
  }

  return { points, measure: shape.measure, label: shape.label, lowerIsBetter: shape.lowerIsBetter }
}

function seriesShape(
  trackingType: TrackingType,
  loadMode: string,
  weighted: boolean,
): {
  pick: (s: SessionCandidate) => number | null
  measure: TrendSeries['measure']
  label: string
  lowerIsBetter: boolean
} {
  if (loadMode === 'assistance') {
    return {
      pick: (s) => s.leastAssistKg,
      measure: 'assistance',
      label: 'Least assistance',
      lowerIsBetter: true,
    }
  }

  switch (trackingType) {
    case 'duration':
      return {
        pick: (s) => s.bestDurationS,
        measure: 'duration',
        label: 'Longest set',
        lowerIsBetter: false,
      }
    case 'distance_time':
      return {
        pick: (s) => s.bestDistanceM,
        measure: 'distance',
        label: 'Furthest',
        lowerIsBetter: false,
      }
    case 'bodyweight':
      return weighted
        ? {
            pick: (s: SessionCandidate) => s.bestWeightKg,
            measure: 'weight' as const,
            label: 'Heaviest set',
            lowerIsBetter: false,
          }
        : {
            pick: (s: SessionCandidate) => s.bestReps,
            measure: 'reps' as const,
            label: 'Most reps',
            lowerIsBetter: false,
          }
    default:
      return {
        pick: (s) => s.bestWeightKg,
        measure: 'weight',
        label: 'Heaviest set',
        lowerIsBetter: false,
      }
  }
}

/** The best point of a series, with the date it was performed. */
export interface BestPoint extends TrendPoint {
  /** Carried through so the caller formats the number without re-deciding. */
  measure: TrendSeries['measure']
  /** Short enough for a stat tile: `Best`, `Most reps`, `Least assist`. */
  label: string
}

/**
 * Short labels, for the tile. `TrendSeries.label` is a heading over a chart and
 * says `Heaviest set`; a three-across tile has room for one word.
 */
const TILE_LABEL: Record<TrendSeries['measure'], string> = {
  weight: 'Best',
  assistance: 'Least assist',
  reps: 'Most reps',
  duration: 'Longest',
  distance: 'Furthest',
}

/**
 * The best set ever performed, out of the same series the chart draws.
 *
 * No new query and no second opinion about what "best" means: the series
 * already picked the measure this exercise is judged by, and the best point is
 * the highest of it - or the LOWEST where `lowerIsBetter`, which is assistance
 * and only assistance.
 *
 * **This is what stops a bodyweight exercise reading `BEST -`.** `Chest Dip`
 * has no weight to be best at, so its series is reps and its best set is a rep
 * count. The screen used to ask the repo for a heaviest weight, get null, and
 * print a dash over five years of work.
 *
 * Ties go to the EARLIEST session, so the date answers "when was this first
 * reached" rather than "when was it last repeated".
 */
export function bestOf(series: TrendSeries): BestPoint | null {
  let best: TrendPoint | null = null
  for (const point of series.points) {
    if (best == null) {
      best = point
      continue
    }
    const better = series.lowerIsBetter ? point.value < best.value : point.value > best.value
    if (better) best = point
  }
  if (best == null) return null
  return { ...best, measure: series.measure, label: TILE_LABEL[series.measure] }
}
