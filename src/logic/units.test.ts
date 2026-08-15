import { describe, it, expect } from 'vitest'
import {
  toKg,
  fromKg,
  formatWeight,
  roundForDisplay,
  weightsEqual,
  compactWeight,
  LB_TO_KG,
} from './units'

/**
 * Every distinct weight in the real Progression export (105 values, all lb).
 * Numbers only - no private data. This is the set the importer will actually
 * push through the conversion, so it is the set worth proving against.
 */
const REAL_LB_WEIGHTS = [
  5, 10, 15, 17.5, 20, 22.5, 25, 30, 32.5, 35, 37.25, 37.5, 40, 42.5, 45, 47.5,
  50, 52.5, 55, 57.5, 60, 65, 70, 75, 80, 85, 87.5, 90, 95, 97.5, 100, 105, 110,
  115, 120, 125, 130, 135, 140, 145, 150, 155, 160, 165, 170, 175, 180, 185,
  190, 195, 200, 205, 210, 215, 220, 225, 230, 235, 240, 245, 250, 255, 260,
  265, 270, 275, 280, 285, 290, 295, 300, 305, 310, 315, 320, 325, 330, 335,
  340, 345, 350, 355, 365, 370, 375, 390, 395, 400, 410, 415, 420, 435, 460,
  510, 550, 640, 645, 690, 730, 750, 760, 770, 780, 820, 840,
]

describe('lb/kg round trip', () => {
  it('recovers every real logged weight to display precision', () => {
    for (const lb of REAL_LB_WEIGHTS) {
      const back = roundForDisplay(fromKg(toKg(lb, 'lb'), 'lb'), 'lb')
      expect(back, `${lb} lb failed to round trip`).toBe(lb)
    }
  })

  it('formats every real weight back to its original string', () => {
    for (const lb of REAL_LB_WEIGHTS) {
      expect(formatWeight(toKg(lb, 'lb'), 'lb')).toBe(String(lb))
    }
  })

  it('is stable under repeated conversion', () => {
    // Editing a set re-parses what was rendered. Ten cycles must not drift.
    for (const lb of [145, 225, 37.25, 840]) {
      let kg = toKg(lb, 'lb')
      for (let i = 0; i < 10; i++) {
        kg = toKg(roundForDisplay(fromKg(kg, 'lb'), 'lb'), 'lb')
      }
      expect(formatWeight(kg, 'lb')).toBe(String(lb))
    }
  })
})

describe('display rounding', () => {
  it('preserves 37.25 lb, which nearest-0.5 rounding would corrupt', () => {
    // This value is really in the export. Rounding display to the nearest half
    // pound would render it as 37.5 and quietly invent a lift never performed.
    expect(formatWeight(toKg(37.25, 'lb'), 'lb')).toBe('37.25')
    expect(roundForDisplay(37.25, 'lb')).toBe(37.25)
  })

  it('rounds kg to one decimal', () => {
    expect(roundForDisplay(68.0388555, 'kg')).toBe(68)
    expect(roundForDisplay(102.0582, 'kg')).toBe(102.1)
  })
})

describe('weightsEqual', () => {
  it('matches a stored weight against a freshly computed one', () => {
    // The PR-detection shape: one side came out of the database (quantised),
    // the other was just computed from user input (not on the grid).
    // 150 lb is one of the 9 values that fails a bit-exact round trip.
    const stored = toKg(150, 'lb')
    const recomputed = (150 * LB_TO_KG * 3) / 3
    expect(stored === recomputed).toBe(false)
    expect(weightsEqual(stored, recomputed)).toBe(true)
  })

  it('matches across every real weight, stored vs recomputed', () => {
    for (const lb of REAL_LB_WEIGHTS) {
      expect(weightsEqual(toKg(lb, 'lb'), lb * LB_TO_KG), `${lb} lb`).toBe(true)
    }
  })

  it('still separates genuinely different loads', () => {
    // The smallest real increment anywhere in the data is 0.25 lb.
    expect(weightsEqual(toKg(37.25, 'lb'), toKg(37.5, 'lb'))).toBe(false)
  })
})

describe('kg entry', () => {
  it('round trips kg input unchanged', () => {
    for (const kg of [20, 60, 100, 102.5, 2.5]) {
      expect(formatWeight(toKg(kg, 'kg'), 'kg')).toBe(String(kg))
    }
  })
})

describe('compactWeight', () => {
  it('shortens only what is too long to read', () => {
    // Five years of history, the figure the import reconciled exactly.
    expect(compactWeight(toKg(7_543_590, 'lb'), 'lb')).toBe('7.5M')
    expect(compactWeight(toKg(184_000, 'lb'), 'lb')).toBe('184k')
    // A session volume stays exact: four digits are read at a glance, and
    // "5.7k lb" would be a worse rendering of 5,680.
    expect(compactWeight(toKg(5680, 'lb'), 'lb')).toBe('5680')
  })
})
