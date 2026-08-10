/**
 * The four barbell cases here were read off Progression's own chip row, so this
 * file is a conformance test against measured behaviour rather than against an
 * idea of how a plate solver should work. See `docs/PROGRESSION.md`.
 */
import { describe, it, expect } from 'vitest'
import { fromKg, toKg } from './units.ts'
import { isPlateLoaded, platesFor, solutionWeight, type PlateStock } from './plates.ts'

const lb = (n: number) => toKg(n, 'lb')

/** Exactly what the phone reports owning: note there is no 20. */
const OWNED: PlateStock[] = [
  { kg: lb(2.5), count: 8 },
  { kg: lb(5), count: 8 },
  { kg: lb(10), count: 8 },
  { kg: lb(25), count: 8 },
  { kg: lb(35), count: 8 },
  { kg: lb(45), count: 8 },
]

const BAR = lb(45)

/** Plate sizes in lb, descending, one entry per plate rather than per stack. */
const asLb = (kg: number) => Math.round(fromKg(kg, 'lb') * 100) / 100
const flatten = (plates: { kg: number; count: number }[]) =>
  plates.flatMap((p) => Array<number>(p.count).fill(asLb(p.kg)))

describe('platesFor, against the measured chip rows', () => {
  it.each([
    [215, [45, 35, 5]],
    [185, [45, 25]],
    [195, [45, 25, 5]],
    [170, [45, 10, 5, 2.5]],
  ])('%i lb loads %j per side', (total, expected) => {
    const solution = platesFor(lb(total), BAR, OWNED, 'plates_per_side')
    expect(flatten(solution.plates)).toEqual(expected)
    expect(solution.perSide).toBe(true)
    expect(solution.remainderKg).toBe(0)
  })

  it('never proposes a plate that is not owned', () => {
    // 20 lb would be the tidy answer for 85 lb; there is no 20 lb plate.
    const solution = platesFor(lb(85), BAR, OWNED, 'plates_per_side')
    expect(flatten(solution.plates)).not.toContain(20)
    expect(solution.remainderKg).toBe(0)
  })

  it('accounts for exactly the load above the bar', () => {
    const solution = platesFor(lb(215), BAR, OWNED, 'plates_per_side')
    expect(solutionWeight(solution)).toBeCloseTo(lb((215 - 45) / 2), 6)
  })
})

describe('platesFor, inventory limits', () => {
  it('caps a per-side solution at half the total owned', () => {
    // Progression's own answer to an absurd weight: 8 owned becomes 4 per side.
    const solution = platesFor(lb(100_000), BAR, OWNED, 'plates_per_side')
    for (const plate of solution.plates) expect(plate.count).toBe(4)
    expect(solution.remainderKg).toBeGreaterThan(0)
  })

  it('reports the shortfall rather than rounding it away', () => {
    const solution = platesFor(lb(100_000), BAR, OWNED, 'plates_per_side')
    const perSide = (100_000 - 45) / 2
    const placed = 4 * (45 + 35 + 25 + 10 + 5 + 2.5)
    expect(asLb(solution.remainderKg)).toBeCloseTo(perSide - placed, 1)
  })

  it('leaves a remainder when the target falls between owned sizes', () => {
    // 1 lb per side is below the smallest plate owned.
    const solution = platesFor(lb(47), BAR, OWNED, 'plates_per_side')
    expect(solution.plates).toEqual([])
    expect(asLb(solution.remainderKg)).toBeCloseTo(1, 2)
  })

  it('ignores denominations owned in odd numbers that cannot be paired', () => {
    const single: PlateStock[] = [{ kg: lb(45), count: 1 }]
    const solution = platesFor(lb(135), BAR, single, 'plates_per_side')
    expect(solution.plates).toEqual([])
  })
})

describe('platesFor, loading modes', () => {
  it('does not halve a plates_total machine', () => {
    // Base 100 lb sled, 45 lb hung on one pin.
    const solution = platesFor(lb(145), lb(100), OWNED, 'plates_total')
    expect(flatten(solution.plates)).toEqual([45])
    expect(solution.perSide).toBe(false)
  })

  it('reproduces the machine press already in the imported history', () => {
    // PROJECT.md: "Machine weight 100" + 7x45/side reconciles to a logged 730.
    // A commercial gym is not the plate rack this phone is configured with, so
    // the stock has to be generous for the case to be reachable at all.
    const gym: PlateStock[] = [{ kg: lb(45), count: 20 }]
    const solution = platesFor(lb(730), lb(100), gym, 'plates_per_side')
    expect(flatten(solution.plates)).toEqual(Array<number>(7).fill(45))
    expect(solution.remainderKg).toBe(0)
  })

  it('shows nothing for a stack machine or a fixed implement', () => {
    expect(platesFor(lb(100), null, OWNED, 'stack').plates).toEqual([])
    expect(platesFor(lb(100), null, OWNED, 'fixed').plates).toEqual([])
  })

  it('shows nothing when loading is unknown, which is every row today', () => {
    expect(platesFor(lb(225), BAR, OWNED, null).plates).toEqual([])
    expect(platesFor(lb(225), BAR, OWNED, undefined).plates).toEqual([])
  })

  it('treats an empty or sub-bar load as nothing to hang, not an error', () => {
    expect(platesFor(lb(45), BAR, OWNED, 'plates_per_side')).toEqual({
      plates: [],
      perSide: true,
      remainderKg: 0,
    })
    expect(platesFor(lb(20), BAR, OWNED, 'plates_per_side').remainderKg).toBe(0)
  })

  it('treats a missing base as no base rather than assuming a bar', () => {
    const solution = platesFor(lb(90), null, OWNED, 'plates_per_side')
    expect(flatten(solution.plates)).toEqual([45])
  })
})

describe('isPlateLoaded', () => {
  it('is true only for the two plate modes', () => {
    expect(isPlateLoaded('plates_per_side')).toBe(true)
    expect(isPlateLoaded('plates_total')).toBe(true)
    expect(isPlateLoaded('stack')).toBe(false)
    expect(isPlateLoaded('fixed')).toBe(false)
    expect(isPlateLoaded(null)).toBe(false)
  })
})
