/**
 * What a workout added up to.
 *
 * **This is not a save.** Every set was written to the database the moment it
 * was logged, which is why the primary button says `Finish workout` rather than
 * `Save`, and why backing out of this screen discards nothing. A summary that
 * implied otherwise would make the back gesture frightening, and the back
 * gesture is how Android users leave every screen.
 *
 * It serves two jobs, which is why it takes a `sessionId` rather than a live
 * session: the end of a workout, and reading a past one from Home. A finished
 * session has no actions left, so it renders the same numbers with none of the
 * buttons.
 */
import { useState } from 'react'
import {
  useDiscardSession,
  useEndSession,
  useSession,
  useSessionSets,
} from '../state/queries.ts'
import { useNav } from '../state/nav.ts'
import { formatDuration } from '../logic/entry.ts'
import { relativeDay } from '../logic/dates.ts'
import { sessionTotals } from '../logic/session.ts'
import { localDateOf } from '../db/repo.ts'
import { formatWeight, type Unit } from '../logic/units.ts'
import { MuscleBadge } from './MuscleBadge.tsx'

interface Props {
  sessionId: number
}

export function SessionSummary({ sessionId }: Props) {
  const { data: session, isLoading } = useSession(sessionId)
  const { data: sets } = useSessionSets(sessionId)
  const endSession = useEndSession()
  const discardSession = useDiscardSession()
  const back = useNav((s) => s.back)
  const reset = useNav((s) => s.reset)

  /**
   * Discard confirms with a second tap on the same button.
   *
   * There is no dialog primitive anywhere in this codebase, and stage 6 already
   * turned down building one to be used once. A button that states what the next
   * tap will do is honest, costs no new component, and cannot be dismissed by
   * accident the way a dialog can be.
   */
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  if (isLoading || !session) {
    return <p className="text-text-dim px-5 py-8">Loading session…</p>
  }

  const unit: Unit = 'lb'
  const totals = sessionTotals(sets ?? [])
  const finished = session.endedAtUtc != null
  const busy = endSession.isPending || discardSession.isPending

  // A session still running is timed to now, so the number on screen is the one
  // the clock says rather than one frozen when the screen opened.
  const durationS = Math.max(
    0,
    Math.round(((session.endedAtUtc ?? Date.now()) - session.startedAtUtc) / 1000),
  )

  // Sets grouped by exercise, in the order they were performed. `order_index`
  // follows what actually happened, so a superset interleaves truthfully and
  // this still lists each exercise once.
  const byExercise: {
    exerciseId: number
    name: string
    primaryMuscle: string | null
    sets: NonNullable<typeof sets>
  }[] = []
  for (const set of sets ?? []) {
    let group = byExercise.find((g) => g.exerciseId === set.exerciseId)
    if (!group) {
      group = {
        exerciseId: set.exerciseId,
        name: set.exerciseName,
        primaryMuscle: set.primaryMuscle,
        sets: [],
      }
      byExercise.push(group)
    }
    group.sets.push(set)
  }

  const handleFinish = async () => {
    await endSession.mutateAsync(sessionId)
    // All the way out, not one screen back: the workout is over, and popping to
    // the session underneath would land on a screen that no longer exists.
    reset()
  }

  const handleDiscard = async () => {
    if (!confirmDiscard) {
      setConfirmDiscard(true)
      return
    }
    await discardSession.mutateAsync(sessionId)
    reset()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-4">
        <h2 className="text-2xl font-semibold">{session.name ?? 'Workout'}</h2>
        <p className="text-text-dim text-sm">
          {session.localDate} · {relativeDay(session.localDate, localDateOf())}
        </p>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Duration" value={formatDuration(durationS)} />
          <Stat label="Sets" value={String(totals.sets)} />
          <Stat label="Volume" value={formatWeight(totals.volumeKg, unit)} unit={unit} />
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {byExercise.map((group) => (
            <div key={group.exerciseId} className="bg-surface-1 rounded-xl px-3 py-2">
              <div className="flex items-center gap-2">
                <MuscleBadge primaryMuscle={group.primaryMuscle} size="sm" />
                <span className="truncate font-medium">{group.name}</span>
                <span className="text-text-dim ml-auto shrink-0 text-sm tabular-nums">
                  {group.sets.length} {group.sets.length === 1 ? 'set' : 'sets'}
                </span>
              </div>
            </div>
          ))}
          {byExercise.length === 0 && (
            <p className="text-text-dim text-sm">No sets logged.</p>
          )}
        </div>
      </div>

      {/* Docked, like the entry bar, so the primary button is where a thumb
          already expects to find one. */}
      {!finished && (
        <div className="bg-surface-1 pb-safe-b shrink-0">
          <div className="flex flex-col gap-3 px-4 pt-3 pb-3">
            <div className="flex items-center justify-between px-1 text-sm">
              <button
                className="text-text-dim active:text-text px-2 py-1"
                onClick={() => back()}
              >
                Back to workout
              </button>
              {/* Destructive, so it sits away from the button being aimed at -
                  the lesson from the mis-tap that landed on Finish workout. */}
              <button
                className="text-danger px-2 py-1 disabled:opacity-40"
                disabled={busy}
                onClick={handleDiscard}
              >
                {confirmDiscard ? 'Tap again to discard' : 'Discard workout'}
              </button>
            </div>

            <button
              className="bg-primary text-on-primary rounded-2xl py-5 text-xl font-semibold tracking-wide active:opacity-90 disabled:opacity-40"
              disabled={busy}
              onClick={handleFinish}
            >
              FINISH WORKOUT
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: Unit }) {
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
