/**
 * One labelled number in a tile.
 *
 * Lifted out of `SessionSummary.tsx` when Home grew stats of its own. Two stat
 * tiles free to drift apart is the same fault the entry bar avoids by being the
 * only number editor in the app: a workout's volume and a lifetime volume should
 * not be able to end up in different type sizes because they were written twice.
 */
import type { Unit } from '../logic/units.ts'

interface Props {
  label: string
  value: string
  unit?: Unit
}

export function Stat({ label, value, unit }: Props) {
  return (
    <div className="bg-surface-1 rounded-xl px-3 py-3">
      <p className="text-text-dim text-xs tracking-wide uppercase">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">
        {value}
        {unit && <span className="text-text-dim ml-1 text-sm font-normal">{unit}</span>}
      </p>
    </div>
  )
}
