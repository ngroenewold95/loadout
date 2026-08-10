/**
 * What to hang on the bar.
 *
 * Modelled on Progression's calculator (see `docs/PROGRESSION.md`), which was
 * measured rather than guessed, including the two rules that are easy to get
 * wrong:
 *
 * 1. **It solves against real inventory, not an idealised set.** The plates
 *    actually owned here are 2.5, 5, 10, 25, 35 and 45 lb - note there is no 20
 *    - and a solver that only knew denominations would cheerfully propose one.
 * 2. **An unreachable target is reported, never rounded away.** Progression
 *    shows the shortfall as a visually distinct dashed chip. A chip row that
 *    quietly lies about the load is worse than no chip row, because the number
 *    in the database is the one you typed either way.
 *
 * Counts are **totals owned**, halved for per-side, which is how Progression
 * stores them and also the only form a person can check by looking at the rack.
 * Confirmed by overloading its solver: an inventory of 8 caps at 4 per side.
 */
import { DISPLAY_STEP, fromKg, roundForDisplay, toKg, type Unit } from './units.ts'
// Type-only, so the schema's drizzle imports are erased and none of it reaches
// the device bundle. The enum lives with the CHECK constraint that enforces it.
import type { Loading } from '../db/schema.ts'

export type { Loading }

/** Only these put plates in your hands. */
export function isPlateLoaded(loading: Loading | null | undefined): boolean {
  return loading === 'plates_per_side' || loading === 'plates_total'
}

export interface PlateStock {
  /** Canonical kg, as everywhere else in the app. */
  kg: number
  /** How many are owned in total, across both sides. */
  count: number
}

export interface PlateCount {
  kg: number
  count: number
}

export interface PlateSolution {
  /** Descending by size. What to load on ONE side for `plates_per_side`. */
  plates: PlateCount[]
  /** True when `plates` describes one side rather than the whole implement. */
  perSide: boolean
  /**
   * Load that could not be made from stock, on the same basis as `plates`.
   * Zero when the target is exactly reachable. Never negative.
   */
  remainderKg: number
}

const EMPTY: PlateSolution = { plates: [], perSide: false, remainderKg: 0 }

/**
 * Solve for the plates to load.
 *
 * `totalKg` is the whole recorded load, which is the invariant the imported
 * history proved: `"Machine weight 100" + 7x45/side` reconciles exactly to a
 * logged 730 lb. `baseKg` is whatever is already there before plates - the bar,
 * the sled, the carriage.
 *
 * Greedy descending, which is optimal for any real plate set and is what
 * Progression does. It is **not** optimal in general once counts bind, so the
 * result is checked rather than trusted: whatever greedy could not place comes
 * back as `remainderKg` instead of being silently dropped.
 */
export function platesFor(
  totalKg: number,
  baseKg: number | null,
  inventory: readonly PlateStock[],
  loading: Loading | null | undefined,
  unit: Unit = 'lb',
): PlateSolution {
  if (!isPlateLoaded(loading)) return EMPTY

  const perSide = loading === 'plates_per_side'

  // Everything below is integer arithmetic in units of the display step, and
  // that is the whole trick. Subtracting quantised KG values accumulates error
  // exactly as `units.ts` warns: a 170 lb bar came out one 2.5 lb plate short,
  // because the running total landed 0.0001 kg under the plate it needed. A
  // plate is a display-unit object anyway - a 45 is 45 lb, not 20.4117 kg - so
  // `stepWeight`'s trick of round-tripping through the display unit applies
  // here too, and integers make it exact rather than merely close.
  const step = DISPLAY_STEP[unit]
  const units = (kg: number) => Math.round(roundForDisplay(fromKg(kg, unit), unit) / step)
  const kilos = (n: number) => toKg(n * step, unit)

  const loadable = units(totalKg) - units(baseKg ?? 0)

  // Below the bare implement. Not an error - it is what an empty bar or a
  // mistyped digit looks like - but there is nothing to hang.
  if (loadable <= 0) return { plates: [], perSide, remainderKg: 0 }

  // An odd number of steps cannot be split evenly across two sides; the leftover
  // falls through to the remainder rather than being rounded onto one side.
  const target = perSide ? Math.floor(loadable / 2) : loadable

  const available = inventory
    .map((p) => ({
      size: units(p.kg),
      // Counts are totals owned, so a per-side solution gets half of them.
      have: perSide ? Math.floor(p.count / 2) : p.count,
    }))
    .filter((p) => p.size > 0 && p.have > 0)
    .sort((a, b) => b.size - a.size)

  const plates: PlateCount[] = []
  let left = target

  for (const plate of available) {
    const count = Math.min(plate.have, Math.floor(left / plate.size))
    if (count <= 0) continue
    plates.push({ kg: kilos(plate.size), count })
    left -= count * plate.size
    if (left === 0) break
  }

  return { plates, perSide, remainderKg: kilos(left) }
}

/** Total the solution actually accounts for, on the same basis as `plates`. */
export function solutionWeight(solution: PlateSolution): number {
  return solution.plates.reduce((sum, p) => sum + p.kg * p.count, 0)
}
