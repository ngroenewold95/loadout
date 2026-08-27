import { describe, it, expect } from 'vitest'
import { trendSeries, type SessionCandidate } from './trend.ts'

const empty: Omit<SessionCandidate, 'localDate'> = {
  bestWeightKg: null,
  leastAssistKg: null,
  bestReps: null,
  bestDurationS: null,
  bestDistanceM: null,
}

const on = (localDate: string, fields: Partial<SessionCandidate>): SessionCandidate => ({
  ...empty,
  localDate,
  ...fields,
})

describe('trendSeries', () => {
  it('plots the heaviest set of ordinary weight work', () => {
    const series = trendSeries(
      [
        on('2026-07-19', { bestWeightKg: 160, bestReps: 8 }),
        on('2026-08-10', { bestWeightKg: 165, bestReps: 8 }),
      ],
      'weight_reps',
      'total',
    )
    expect(series.points.map((p) => p.value)).toEqual([160, 165])
    expect(series.measure).toBe('weight')
    expect(series.lowerIsBetter).toBe(false)
  })

  /**
   * The whole reason this is a function and not a column. A higher number on an
   * Assisted Chinup is an easier set, so the best one is the least assistance
   * and a falling line is five years of getting stronger.
   */
  it('plots the LEAST assistance, and says a lower line is better', () => {
    const series = trendSeries(
      [
        on('2023-12-18', { leastAssistKg: 52 }),
        on('2026-07-22', { leastAssistKg: 11 }),
      ],
      'weight_reps',
      'assistance',
    )
    expect(series.points.map((p) => p.value)).toEqual([52, 11])
    expect(series.measure).toBe('assistance')
    expect(series.lowerIsBetter).toBe(true)
  })

  it('measures unweighted bodyweight work in reps', () => {
    const series = trendSeries(
      [on('2025-02-20', { bestReps: 6 }), on('2025-04-02', { bestReps: 9 })],
      'bodyweight',
      'total',
    )
    expect(series.points.map((p) => p.value)).toEqual([6, 9])
    expect(series.measure).toBe('reps')
    expect(series.label).toBe('Most reps')
  })

  /**
   * Chosen once for the series, never per session: pounds and rep counts on one
   * axis would be a line that means two different things at either end.
   */
  it('switches the whole bodyweight series to weight once any session carried some', () => {
    const series = trendSeries(
      [
        on('2025-02-20', { bestReps: 9 }),
        on('2025-03-02', { bestWeightKg: 10, bestReps: 6 }),
      ],
      'bodyweight',
      'total',
    )
    expect(series.measure).toBe('weight')
    // The unweighted session is dropped rather than plotted as zero: it is a
    // gap in the record, not a session where nothing was lifted.
    expect(series.points).toEqual([{ localDate: '2025-03-02', value: 10 }])
  })

  it('plots duration and distance work by their own number', () => {
    expect(
      trendSeries([on('2026-01-01', { bestDurationS: 90 })], 'duration', 'total'),
    ).toMatchObject({ measure: 'duration', points: [{ value: 90 }] })
    expect(
      trendSeries([on('2026-01-01', { bestDistanceM: 5000 })], 'distance_time', 'total'),
    ).toMatchObject({ measure: 'distance', points: [{ value: 5000 }] })
  })

  it('survives an exercise with one session, and with none', () => {
    expect(trendSeries([on('2026-08-10', { bestWeightKg: 60 })], 'weight_reps', 'total').points)
      .toHaveLength(1)
    expect(trendSeries([], 'weight_reps', 'total').points).toEqual([])
  })

  it('drops a session that has nothing to plot', () => {
    const series = trendSeries(
      [on('2026-08-01', {}), on('2026-08-10', { bestWeightKg: 60 })],
      'weight_reps',
      'total',
    )
    expect(series.points).toEqual([{ localDate: '2026-08-10', value: 60 }])
  })
})
