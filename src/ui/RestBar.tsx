/**
 * In-app rest countdown.
 *
 * The native overlay bubble deliberately hides itself while loadout is in
 * front, so this owns the countdown on screen. Both render from the same
 * absolute `endsAt`, which is why they cannot disagree - and why neither
 * depends on the app having been awake the whole time.
 *
 * Past zero it turns red and counts UP, matching the bubble.
 */
import { useEffect, useState } from 'react'
import { RestTimer } from '../native/restTimer.ts'
import { formatDuration } from '../logic/entry.ts'

interface Props {
  endsAt: number | null
  /** Push the end instant out by `ms`; the parent owns it. */
  onExtend: (ms: number) => void
  onSkip: () => void
}

export function RestBar({ endsAt, onExtend, onSkip }: Props) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (endsAt == null) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [endsAt])

  if (endsAt == null) return null

  const remainingS = Math.round((endsAt - now) / 1000)
  const over = remainingS < 0

  return (
    <div
      className={`mx-5 mt-3 flex items-center gap-3 rounded-xl px-4 py-3 ${
        over ? 'bg-red-950' : 'bg-neutral-900'
      }`}
    >
      <span
        className={`text-2xl font-semibold tabular-nums ${
          over ? 'text-red-400' : 'text-neutral-200'
        }`}
      >
        {over ? '+' : ''}
        {formatDuration(Math.abs(remainingS))}
      </span>
      <span className="flex-1 text-xs text-neutral-500">rest</span>
      <button
        className="rounded-lg bg-neutral-800 px-3 py-2 text-sm active:bg-neutral-700"
        onClick={() => {
          void RestTimer.extend({ ms: 30_000 })
          onExtend(30_000)
        }}
      >
        +30s
      </button>
      <button
        className="rounded-lg bg-neutral-800 px-3 py-2 text-sm active:bg-neutral-700"
        onClick={() => {
          void RestTimer.cancel()
          onSkip()
        }}
      >
        Skip
      </button>
    </div>
  )
}
