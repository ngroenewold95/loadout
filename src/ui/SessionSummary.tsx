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
  usePreviousSessionTotals,
  useSession,
  useSessionSets,
  useSetSessionNotes,
} from '../state/queries.ts'
import { useNav } from '../state/nav.ts'
import { formatDuration } from '../logic/entry.ts'
import { relativeDay } from '../logic/dates.ts'
import { groupByExercise, isWorkingSet, sessionTotals } from '../logic/session.ts'
import { localDateOf, type PerformedSet } from '../db/repo.ts'
import { formatWeight, DEFAULT_UNIT } from '../logic/units.ts'
import { copyText } from './copyText.ts'
import { GroupRail } from './GroupTag.tsx'
import { describeSet } from './setText.ts'
import { shareText } from './shareText.ts'
import { Stat } from './Stat.tsx'

interface Props {
  sessionId: number
}

/**
 * A difference, signed.
 *
 * The `+` has to be added by hand - `String(2)` is `2` while `String(-2)`
 * already carries its sign - and a difference with no sign on it reads as a
 * total, which is exactly the number beside it.
 */
function delta(value: number, format: (v: number) => string): string {
  return value > 0 ? `+${format(value)}` : format(value)
}

/** How many of these count. Warm-ups are listed here but totalled nowhere. */
function workingCount(sets: readonly PerformedSet[]): number {
  return sets.filter(isWorkingSet).length
}

/**
 * The badge each row carries.
 *
 * A warm-up reads `W` and does not take a number, so the working sets are
 * numbered 1, 2, 3 exactly as the history cards and the logging screen's slots
 * number them. Numbering straight down the list would put every screen
 * describing the same session one apart.
 */
function numberSets(
  sets: readonly PerformedSet[],
): { set: PerformedSet; label: string }[] {
  let n = 0
  return sets.map((set) => ({
    set,
    label: isWorkingSet(set) ? String(++n) : 'W',
  }))
}

export function SessionSummary({ sessionId }: Props) {
  const { data: session, isLoading } = useSession(sessionId)
  const { data: sets } = useSessionSets(sessionId)
  const { data: previous } = usePreviousSessionTotals(sessionId)
  const saveNotes = useSetSessionNotes(sessionId)
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

  /**
   * `Copy` says `Copied` for a moment and then goes back.
   *
   * Android's own clipboard toast is gone on API 33+, so without this the tap
   * has no feedback at all and the only way to know it worked is to leave the
   * app and paste.
   */
  const [copied, setCopied] = useState(false)

  /**
   * The note being typed, or null when the stored one is being shown.
   *
   * Held here rather than written on every keystroke: a note is a sentence, and
   * a write per character would be a write per character across the bridge.
   */
  const [draftNotes, setDraftNotes] = useState<string | null>(null)

  if (isLoading || !session) {
    return <p className="text-text-dim px-5 py-8">Loading session…</p>
  }

  const unit = DEFAULT_UNIT
  const totals = sessionTotals(sets ?? [])
  const finished = session.endedAtUtc != null
  const busy = endSession.isPending || discardSession.isPending

  // A session still running is timed to now, so the number on screen is the one
  // the clock says rather than one frozen when the screen opened.
  const durationS = Math.max(
    0,
    Math.round(((session.endedAtUtc ?? Date.now()) - session.startedAtUtc) / 1000),
  )

  // Sets under their exercise, in the order they were performed. Shared with
  // the share text, so the screen and the clipboard cannot disagree about what
  // the workout was.
  const byExercise = groupByExercise(sets ?? [])

  const handleCopy = async () => {
    if (await copyText(shareText(session, sets ?? [], unit))) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
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
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-2xl font-semibold">{session.name ?? 'Workout'}</h2>
            <p className="text-text-dim text-sm">
              {session.localDate} · {relativeDay(session.localDate, localDateOf())}
            </p>
          </div>
          {/* Outside the docked bar on purpose: that bar is hidden once the
              session is finished, and a past workout is exactly the one most
              likely to be worth sending to someone. */}
          <button
            type="button"
            className="bg-surface-1 text-text-dim active:text-text shrink-0 rounded-xl px-3 py-2 text-sm"
            onClick={handleCopy}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Stat label="Duration" value={formatDuration(durationS)} />
          <Stat label="Sets" value={String(totals.sets)} />
          <Stat label="Reps" value={String(totals.reps)} />
          <Stat label="Volume" value={formatWeight(totals.volumeKg, unit)} unit={unit} />
        </div>

        {/* What this workout was, against the last time it was performed. The
            screen said what happened and never whether it was any good, which
            is the question it is open to answer. */}
        {previous && (
          <p className="text-text-dim mt-2 text-xs tabular-nums">
            vs {previous.localDate}
            {' · '}
            {delta(totals.volumeKg - (previous.volumeKg ?? 0), (v) => formatWeight(v, unit))}{' '}
            {unit}
            {' · '}
            {delta(totals.sets - previous.sets, String)} sets
            {' · '}
            {delta(totals.reps - previous.reps, String)} reps
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2">
          {byExercise.map((group) => (
            <div key={group.exerciseId} className="bg-surface-1 rounded-xl px-3 py-2">
              <div className="flex items-stretch gap-3">
                <GroupRail primaryMuscle={group.primaryMuscle} />
                <span className="truncate font-medium">{group.name}</span>
                <span className="text-text-dim ml-auto shrink-0 text-sm tabular-nums">
                  {/* Working sets, so this agrees with the SETS tile above and
                      with the fraction the logging screen showed. The warm-ups
                      are still listed below, marked. */}
                  {workingCount(group.sets)}{' '}
                  {workingCount(group.sets) === 1 ? 'set' : 'sets'}
                </span>
              </div>

              {/* The sets themselves, numbered the way the history cards number
                  them. A summary that only counted them made a 22-set workout
                  read as `3 sets` eleven times. */}
              <div className="mt-1 flex flex-col gap-0.5 pl-5">
                {numberSets(group.sets).map(({ set, label }) => (
                  <p key={set.id} className="flex items-baseline gap-2 text-sm tabular-nums">
                    <span className="text-text-dim w-4 shrink-0 text-right text-xs">
                      {label}
                    </span>
                    <span className="text-text-dim">{describeSet(set, unit)}</span>
                    {/* A set note is usually the machine's own base weight or
                        a plate breakdown, which is exactly the thing you want
                        beside the number rather than one screen away. */}
                    {set.notes && (
                      <span className="text-text-dim truncate text-xs italic">
                        {set.notes}
                      </span>
                    )}
                  </p>
                ))}
              </div>
            </div>
          ))}
          {byExercise.length === 0 && (
            <p className="text-text-dim text-sm">No sets logged.</p>
          )}
        </div>

        {/* `sessions.notes` has been in the schema since the first migration and
            the import fills it; until now nothing in the app could write it. */}
        <section className="mt-4">
          <h3 className="text-text-dim text-xs tracking-wide uppercase">Note</h3>
          {draftNotes == null ? (
            <button
              type="button"
              className="bg-surface-1 active:bg-surface-3 mt-2 w-full rounded-xl px-4 py-3 text-left text-sm"
              onClick={() => setDraftNotes(session.notes ?? '')}
            >
              {session.notes ?? (
                <span className="text-text-dim">How did it go?</span>
              )}
            </button>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              <textarea
                autoFocus
                rows={3}
                value={draftNotes}
                onChange={(e) => setDraftNotes(e.target.value)}
                placeholder="How did it go?"
                className="bg-field text-text placeholder:text-text-dim w-full rounded-xl px-4 py-3 text-base"
              />
              <div className="flex items-center justify-end gap-2 text-sm">
                <button
                  className="text-text-dim active:text-text px-3 py-1"
                  onClick={() => setDraftNotes(null)}
                >
                  Cancel
                </button>
                <button
                  className="bg-primary text-on-primary rounded-xl px-4 py-2 font-medium disabled:opacity-40"
                  disabled={saveNotes.isPending}
                  onClick={async () => {
                    await saveNotes.mutateAsync(draftNotes)
                    setDraftNotes(null)
                  }}
                >
                  Save note
                </button>
              </div>
            </div>
          )}
        </section>
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
