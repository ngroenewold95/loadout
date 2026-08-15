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
 *
 * **What a tap does depends on the state, and that is the point.** The
 * reference app skips the rest on any tap while running. Here a tap while
 * counting down opens an editor instead, because the rest is a number you
 * adjust far more often than one you abandon - the machine is taken, or the set
 * was harder than planned - and losing a running rest to a mistimed tap is not
 * recoverable, the service having thrown it away. **Past zero, a tap cancels**:
 * the rest is over, the pill is only still there because it never
 * auto-dismisses, and dismissing it is the only thing left to want.
 *
 * It renders from the same absolute `endsAt` the service and the bubble draw
 * from, so the three cannot disagree.
 */
import { useEffect, useState } from 'react'
import { RestTimer, currentRest, startRest as startNativeRest } from '../native/restTimer.ts'
import { formatDuration } from '../logic/entry.ts'
import { useWorkout } from '../state/workout.ts'
import { ActionItem, ActionSheet } from './ActionSheet.tsx'

export function RestPill() {
  const endsAt = useWorkout((s) => s.restEndsAt)
  const totalMs = useWorkout((s) => s.restTotalMs)
  const startRest = useWorkout((s) => s.startRest)
  const clearRest = useWorkout((s) => s.clearRest)

  const [now, setNow] = useState(() => Date.now())
  const [editing, setEditing] = useState(false)

  /**
   * The editor closes itself when the rest runs out.
   *
   * Past zero there is nothing left to adjust - the only thing to want is the
   * pill gone, which is what a tap does in that state. Leaving the sheet up
   * measurably produced two wrong things at once: a title reading `0:24 LEFT`
   * for a rest that had finished 24 seconds earlier, because the pill's
   * `Math.abs` display is shared with it, and an `Add 30 seconds` that
   * restarted from now rather than adding to an end that was already behind us.
   * Both were mistaken for an arithmetic bug before the plugin log showed the
   * requested duration and gave the real answer.
   */
  useEffect(() => {
    if (editing && endsAt != null && Date.now() > endsAt) setEditing(false)
  }, [editing, endsAt, now])

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

  const cancel = () => {
    void RestTimer.cancel()
    clearRest()
  }

  /**
   * Shift the end instant, and tell the service in the same terms.
   *
   * `RestTimer.start` rather than `extend`, in both directions: it takes an
   * absolute end and a total, which is exactly what the pill needs to keep its
   * fill honest after a change, and it is the call the service already handles
   * for a rest beginning. Extending by a negative number would be the same
   * arithmetic through a name that says the opposite.
   *
   * **Read through `getState()`, not the render's `endsAt`.** The first version
   * closed over the rendered value and `Add 30 seconds` measurably ran the clock
   * *down*: 1:09 to 0:56 to 0:16 over three taps, and the plugin log showed a
   * `totalMs` of 15,000 for a pill reading 0:16, which is a value one whole step
   * out of date. The store is the only thing that knows what the last tap left
   * behind, so ask it rather than a closure that may predate it. Same reasoning
   * as the back listener in `nav.ts`.
   *
   * **Clamped so a rest cannot be shortened into the past.** Taking 30 s off a
   * 12-second rest should land on zero and let the count-up start, not create a
   * rest that was already over 18 seconds ago and drew a full red pill.
   */
  const shift = (ms: number) => {
    const live = useWorkout.getState()
    if (live.restEndsAt == null) return
    const nextEndsAt = Math.max(Date.now(), live.restEndsAt + ms)
    // The total is what the draining fill is a fraction of, so it has to move
    // with the end or the pill would jump backwards while the clock went on.
    const nextTotal = Math.max(1000, live.restTotalMs + ms)
    void startNativeRest(Math.round((nextEndsAt - Date.now()) / 1000))
    live.startRest(nextEndsAt, nextTotal)
  }

  return (
    <>
    <button
      type="button"
      aria-label={over ? `Rest over by ${seconds} seconds` : `Rest ${seconds} seconds left`}
      onClick={over ? cancel : () => setEditing(true)}
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

      {editing && !over && (
        <ActionSheet
          // The live clock, so the sheet says what it is acting on rather than
          // making you close it to check. `over` is guarded above as well as in
          // the effect, so the title cannot render the count-up as time "left"
          // even for the frame between the two.
          title={`Rest · ${formatDuration(seconds)} left`}
          onClose={() => setEditing(false)}
        >
          {/* The sheet stays open on a step, because trimming a rest is
              usually two taps of the same button and reopening between them
              would be the slow way to do the common thing. */}
          <ActionItem label="Add 30 seconds" onClick={() => shift(30_000)} />
          <ActionItem label="Take off 30 seconds" onClick={() => shift(-30_000)} />
          <ActionItem
            label="Skip the rest"
            danger
            onClick={() => {
              cancel()
              setEditing(false)
            }}
          />
        </ActionSheet>
      )}
    </>
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
