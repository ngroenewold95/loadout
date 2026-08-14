/**
 * The rest countdown, as a pill in the app bar.
 *
 * Replaces `RestBar.tsx`, which was a full-width bar that pushed the content
 * down when it appeared. That is the thing this fixes: the pill costs no
 * vertical space and cannot shift the layout, which matters on a screen whose
 * whole design is that nothing moves under a thumb aiming at LOG SET.
 *
 * Appearance measured off the reference app (`docs/PROGRESSION.md`): counting
 * down it is a pill with the fill **draining right to left**; past zero it is
 * solid red counting **up**, with no `+` prefix, and it never auto-dismisses.
 * A tap while running skips the rest immediately, with no confirmation - the
 * gesture is cheap to repeat and a dialog mid-workout is not.
 *
 * It renders from the same absolute `endsAt` the service and the bubble draw
 * from, so the three cannot disagree.
 */
import { useEffect, useState } from 'react'
import { RestTimer, currentRest } from '../native/restTimer.ts'
import { formatDuration } from '../logic/entry.ts'
import { useWorkout } from '../state/workout.ts'

export function RestPill() {
  const endsAt = useWorkout((s) => s.restEndsAt)
  const totalMs = useWorkout((s) => s.restTotalMs)
  const startRest = useWorkout((s) => s.startRest)
  const clearRest = useWorkout((s) => s.clearRest)

  const [now, setNow] = useState(() => Date.now())

  /**
   * Recover a rest that is already running.
   *
   * The countdown lives in memory, so a killed app lost it while the service
   * kept counting: reopening mid-rest showed nothing in the app while the
   * bubble was still going. The service holds the end instant, so nothing has
   * to be persisted to fix this - only asked for.
   */
  useEffect(() => {
    let cancelled = false
    void currentRest().then((rest) => {
      if (!cancelled && rest) startRest(rest.endsAt, rest.totalMs)
    })
    return () => {
      cancelled = true
    }
  }, [startRest])

  // Only ticks while something is counting. 250 ms is four times the rate the
  // seconds actually change, which is enough that the digit never looks late.
  useEffect(() => {
    if (endsAt == null) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [endsAt])

  if (endsAt == null) {
    // Idle: a plain alarm outline.
    //
    // `h-9` matches the pill exactly, and that is the whole point rather than a
    // detail. Measured on device with a bare icon here: the exercise header
    // still moved about 11 device px when a rest started, because the icon was
    // shorter than the pill replacing it. A smaller version of the bug this
    // stage exists to kill is still that bug. Not interactive - the full-screen
    // timer page the reference app opens on an idle tap is a later stage.
    return (
      <span className="flex h-9 items-center">
        <AlarmIcon className="text-muted size-6" />
      </span>
    )
  }

  const remainingMs = endsAt - now
  const over = remainingMs < 0
  const seconds = Math.round(Math.abs(remainingMs) / 1000)

  // How much of the rest is left, as a percentage, for the draining fill.
  const remaining = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0
  const drained = `${Math.round(remaining * 100)}%`

  return (
    <button
      type="button"
      aria-label={over ? `Rest over by ${seconds} seconds` : `Rest ${seconds} seconds left`}
      onClick={() => {
        void RestTimer.cancel()
        clearRest()
      }}
      className="text-text flex h-9 items-center gap-2 rounded-full px-3 text-sm font-semibold tabular-nums"
      // `--color-rest` and `--color-rest-over` were sampled off the reference
      // app when the palette was built and have been defined and unused ever
      // since. This is what they were for.
      //
      // The drain is a hard-edged gradient rather than a nested element: one
      // box, no layout, and it cannot round differently from the pill it fills.
      style={
        over
          ? { background: 'var(--color-rest-over)' }
          : {
              background: `linear-gradient(to right, var(--color-rest) ${drained}, var(--color-track) ${drained})`,
            }
      }
    >
      <AlarmIcon className="size-4" />
      {formatDuration(seconds)}
    </button>
  )
}

function AlarmIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2 2" />
      <path d="m5 3-2 2" />
      <path d="m19 3 2 2" />
    </svg>
  )
}
