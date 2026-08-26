/**
 * What to load on the bar, above the number you are about to log.
 *
 * `platesFor` has been written, tested against chip rows measured off the
 * reference app, and called by nothing since the day it landed. This is the
 * caller.
 *
 * Three rules it inherits and this component must not soften:
 *
 * - **A shortfall is shown, never rounded away.** The weight in the database is
 *   the one that was typed either way, so a chip row that lies is worse than no
 *   chip row. The remainder renders as a dashed chip.
 * - **Nothing is drawn unless the loading is known.** A pin stack and an
 *   unclassified machine both render null, so the row simply is not there.
 * - **`count` is the total owned and the solver halves it**, which is why the
 *   label says `per side` rather than the chips being doubled.
 *
 * It sits above the entry fields inside the docked bar, so it grows the bar
 * upward and `LOG SET` does not move. That is the same property that lets
 * `Cancel` and `Delete set` sit above the primary button.
 */
import { useMemo } from 'react'
import { isPlateLoaded, platesFor, type Loading, type PlateStock } from '../logic/plates.ts'
import { formatWeight, type Unit } from '../logic/units.ts'

interface Props {
  /** The whole recorded load, bar included. Null while the field is empty. */
  weightKg: number | null
  /** Bar, carriage or sled before plates. Null means there is none recorded. */
  baseKg: number | null
  loading: Loading | null | undefined
  inventory: PlateStock[] | undefined
  unit: Unit
}

export function PlateChips({ weightKg, baseKg, loading, inventory, unit }: Props) {
  // Arithmetic over six plate sizes, so this is cheap - the memo is only to
  // stop a fresh array being allocated on every scrub frame.
  const solution = useMemo(
    () =>
      weightKg == null || !inventory
        ? null
        : platesFor(weightKg, baseKg, inventory, loading, unit),
    [weightKg, baseKg, inventory, loading, unit],
  )

  if (!isPlateLoaded(loading) || !solution) return null
  if (solution.plates.length === 0 && solution.remainderKg === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1">
      {solution.plates.map((plate) => (
        <span
          key={plate.kg}
          className="bg-muted rounded-lg px-2 py-1 text-xs font-semibold tabular-nums"
        >
          {formatWeight(plate.kg, unit)}
          {plate.count > 1 && <span className="opacity-70"> × {plate.count}</span>}
        </span>
      ))}

      {solution.remainderKg > 0 && (
        <span className="text-text-dim border-muted rounded-lg border border-dashed px-2 py-1 text-xs tabular-nums">
          {formatWeight(solution.remainderKg, unit)} short
        </span>
      )}

      <span className="text-text-dim ml-1 text-xs">
        {solution.perSide ? 'per side' : 'total'}
        {baseKg != null && ` · ${formatWeight(baseKg, unit)} base`}
      </span>
    </div>
  )
}
