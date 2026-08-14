/**
 * The logging loop.
 *
 * Everything here serves one constraint: logging a set is about two taps. The
 * fields arrive pre-filled from the previous set (or last session's first), so
 * the common case is LOG SET alone, and the rest timer starts as a side effect
 * of logging rather than as a separate tap.
 *
 * Last session's sets are on screen permanently. That is the highest-value
 * thing the app shows, and hiding it behind a tap would defeat the point.
 *
 * **Three regions, and only the middle one scrolls.** Header and entry bar are
 * pinned, so the entry fields and LOG SET stay in the same place relative to
 * the thumb no matter what appears above them. This is the fix for the thing
 * `PROJECT.md` records as a real mis-tap: the layout used to shift as the rest
 * bar and the set chips appeared, and a tap meant for LOG SET landed on
 * *Finish workout*. Those two are no longer neighbours either.
 *
 * **Sets are pre-created slots, and the entry bar is the only editor.** Tapping
 * a filled slot points the bar at that set: the scrub and the keypad correct it
 * exactly as they enter a fresh one, so there is no second number editor to
 * drift. It is also why `Undo` is gone - deleting the last slot is the same
 * action, and any other slot can be corrected too, which `Undo` never allowed.
 *
 * **Exercises are a horizontal pager, not a tap strip.** The middle region is a
 * scroll-snap scroller holding one page per exercise, each with its own vertical
 * scroller, so the three regions survive intact. The strip asked for an accurate
 * tap on a small chip; a swipe asks for nothing. What remains of it is a row of
 * muscle badges, which is a jump target and a position indicator at once.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useDeleteSet,
  useRecentPerformance,
  useLogSet,
  useSessionSets,
  useTemplateExercises,
  useUpdateSet,
} from '../state/queries.ts'
import {
  localDateOf,
  prefillFor,
  type LastPerformance,
  type PerformedSet,
  type SessionRow,
  type TemplateExerciseRow,
} from '../db/repo.ts'
import {
  entryShape,
  formatDuration,
  formatRepTarget,
  formatTarget,
  parseReps,
  parseWeight,
  stepDuration,
  stepReps,
  stepWeight,
  WEIGHT_STEPS,
} from '../logic/entry.ts'
import { shouldIncreaseLoad } from '../logic/plan.ts'
import { isComplete, nextIncompleteIndex } from '../logic/session.ts'
import { setSlots, type SetSlot } from '../logic/slots.ts'
import { useNav } from '../state/nav.ts'
import { formatWeight, type Unit } from '../logic/units.ts'
import { startRest } from '../native/restTimer.ts'
import { EntryField } from './EntryField.tsx'
import { HistoryCard } from './HistoryCard.tsx'
import { MuscleBadge } from './MuscleBadge.tsx'
import { RestBar } from './RestBar.tsx'

interface Props {
  session: SessionRow
}

/** Render a set the way it was performed, whatever shape it is. */
function describeSet(set: PerformedSet, unit: Unit): string {
  const parts: string[] = []
  if (set.weightKg != null) parts.push(`${formatWeight(set.weightKg, unit)}`)
  if (set.reps != null) parts.push(parts.length > 0 ? `× ${set.reps}` : `${set.reps} reps`)
  if (set.durationS != null) parts.push(formatDuration(set.durationS))
  if (set.distanceM != null) parts.push(`${set.distanceM} m`)
  return parts.join(' ')
}

export function ActiveSession({ session }: Props) {
  const push = useNav((s) => s.push)
  const openSummary = () => push({ kind: 'summary', sessionId: session.id })

  const { data: planned } = useTemplateExercises(session.templateId)
  const { data: sets } = useSessionSets(session.id)
  const exerciseIds = useMemo(() => (planned ?? []).map((p) => p.exerciseId), [planned])
  const { data: history } = useRecentPerformance(exerciseIds, session.id)

  const [index, setIndex] = useState(0)
  const pagerRef = useRef<HTMLDivElement>(null)
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null)
  /** The set the entry bar is pointed at, or null when it is entering a new one. */
  const [editingSetId, setEditingSetId] = useState<number | null>(null)

  const logSet = useLogSet()
  const updateSet = useUpdateSet()
  const deleteSet = useDeleteSet()

  const current = planned?.[index]
  const shape = current ? entryShape(current.trackingType) : null
  const unit: Unit = current?.preferredUnit ?? 'lb'

  const doneHere = useMemo(
    () => (sets ?? []).filter((s) => s.exerciseId === current?.exerciseId),
    [sets, current],
  )
  // The most recent session is what prefills; the pages stack all of them.
  const lastTime = current ? history?.get(current.exerciseId)?.[0] : undefined

  // Computed once for the whole screen rather than per card. It only changes at
  // midnight, and a workout that crosses midnight has bigger problems.
  const today = useMemo(() => localDateOf(), [])

  // Draft entry. Re-seeded whenever the exercise changes or a set lands, which
  // is what makes the next set a single tap.
  const [weightKg, setWeightKg] = useState<number | null>(null)
  const [reps, setReps] = useState<number | null>(null)
  const [durationS, setDurationS] = useState<number | null>(null)

  // Moving to another exercise must drop the edit target with it, or the bar
  // would still be pointed at a set that is no longer on screen.
  const exerciseId = current?.exerciseId
  useEffect(() => {
    setEditingSetId(null)
  }, [exerciseId])

  /**
   * Swiping updates the index.
   *
   * An `IntersectionObserver` rather than a scroll handler: it fires when a page
   * has actually settled into view instead of on every frame of the gesture, so
   * the header does not flicker between two exercises mid-swipe.
   */
  useEffect(() => {
    const pager = pagerRef.current
    if (!pager) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const at = Number((entry.target as HTMLElement).dataset.pageIndex)
          if (!Number.isNaN(at)) setIndex(at)
        }
      },
      // Against the pager itself, not the viewport, and past half a page so
      // exactly one page can qualify at a time.
      { root: pager, threshold: 0.6 },
    )

    for (const page of pager.children) observer.observe(page)
    return () => observer.disconnect()
  }, [planned?.length])

  /**
   * ...and the index scrolls the pager, for every other way it can change.
   *
   * There is no "is this scroll programmatic" flag, and deliberately not: the
   * position is checked first, so when the observer set the index because the
   * user swiped there, the pager is already in place and nothing is issued. The
   * two can therefore never chase each other. Stage 8's auto-advance is the
   * caller this exists for.
   */
  useEffect(() => {
    const pager = pagerRef.current
    if (!pager) return
    const target = index * pager.clientWidth
    if (Math.abs(pager.scrollLeft - target) < pager.clientWidth / 4) return
    pager.scrollTo({ left: target, behavior: 'smooth' })
  }, [index])

  useEffect(() => {
    if (!current) return
    // Correcting a set seeds from that set; otherwise from the prefill chain.
    const editing = (sets ?? []).find((s) => s.id === editingSetId)
    if (editing) {
      setWeightKg(editing.weightKg)
      setReps(editing.reps)
      setDurationS(editing.durationS)
      return
    }
    const fill = prefillFor(sets ?? [], current.exerciseId, lastTime)
    setWeightKg(fill.weightKg)
    setReps(fill.reps ?? current.targetRepMin ?? null)
    setDurationS(fill.durationS)
  }, [current, sets, lastTime, editingSetId])

  if (!planned || !current || !shape) {
    return <p className="px-5 py-8 text-text-dim">Loading session…</p>
  }

  const canLog =
    (shape.weight !== 'required' || weightKg != null) &&
    (!shape.reps || reps != null) &&
    (!shape.duration || durationS != null)

  const busy = logSet.isPending || updateSet.isPending || deleteSet.isPending

  /**
   * The three values a set carries, in the shape both paths need.
   *
   * `enteredValue` and `enteredUnit` travel WITH `weightKg`, never without it.
   * They hold what was actually typed so history renders in the unit it was
   * logged in, and a save that patched only `weightKg` would leave a corrected
   * set showing its old number for good, with no error anywhere.
   */
  const payload = {
    weightKg: shape.weight === 'none' ? null : weightKg,
    enteredValue: weightKg == null ? null : Number(formatWeight(weightKg, unit)),
    enteredUnit: weightKg == null ? null : unit,
    reps: shape.reps ? reps : null,
    durationS: shape.duration ? durationS : null,
  }

  const handleLog = async () => {
    await logSet.mutateAsync({
      sessionId: session.id,
      exerciseId: current.exerciseId,
      ...payload,
      baseWeightKg: current.baseWeightKg,
    })
    // Rest starts as a consequence of logging, never as its own tap.
    if (current.restS) setRestEndsAt(await startRest(current.restS))

    /**
     * Auto-advance, but only on the set that completes the exercise.
     *
     * The count is computed here rather than read back from the query, because
     * the refetch this mutation triggers has not landed yet - `doneHere` is
     * still one set behind at this point.
     */
    if (!isComplete(current, doneHere.length + 1)) return

    // Same reason: the set just logged has to be counted by hand, or the
    // exercise it belongs to would look one short and we would advance to it.
    const after = [...(sets ?? []), { exerciseId: current.exerciseId }]
    const next = nextIncompleteIndex(planned, after, index)
    if (next == null) openSummary()
    else setIndex(next)
  }

  const handleSave = async () => {
    if (editingSetId == null) return
    await updateSet.mutateAsync({
      setId: editingSetId,
      sessionId: session.id,
      patch: payload,
    })
    // Back to entering, which re-seeds the draft from the prefill chain.
    setEditingSetId(null)
  }

  const handleDelete = async () => {
    if (editingSetId == null) return
    // The repo closes the numbering gap a middle delete leaves, so the slots
    // renumber themselves on the refetch.
    await deleteSet.mutateAsync({ setId: editingSetId, sessionId: session.id })
    setEditingSetId(null)
  }

  // Progress as a fraction, always visible - `docs/PROGRESSION.md` lists it as
  // worth taking, and the app showed a target but never how far through it was.
  const targetLine = [
    formatTarget(current.targetSets, current.targetRepMin, current.targetRepMax),
    current.targetSets == null
      ? `${doneHere.length} sets`
      : `${doneHere.length}/${current.targetSets} sets`,
    current.notes,
    current.restS ? `rest ${formatDuration(current.restS)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Region 1: pinned. Navigation and the answer to "where am I". */}
      <div className="shrink-0">
        <RestBar
          endsAt={restEndsAt}
          onExtend={(ms) => setRestEndsAt((e) => (e == null ? e : e + ms))}
          onSkip={() => setRestEndsAt(null)}
        />

        <div className="flex items-center justify-between gap-3 px-5 pt-3">
          <div className="flex min-w-0 items-center gap-2">
            <MuscleBadge primaryMuscle={current.primaryMuscle} />
            <h2 className="truncate text-xl font-semibold">{current.name}</h2>
          </div>
          <div className="text-text-dim flex shrink-0 items-center gap-4 text-sm">
            <span className="tabular-nums">
              {index + 1}/{planned.length}
            </span>
            {/* Deliberately small, and nowhere near LOG SET. It opens the
                summary rather than ending the session: nothing is saved by
                finishing, so nothing should be decided by a stray tap here. */}
            <button className="active:text-text" onClick={openSummary}>
              Finish
            </button>
          </div>
        </div>

        <p className="text-text-dim px-5 pt-1 text-sm">{targetLine}</p>

        {/* What is left of the tap strip: badges only, no names.

            The strip was 11 text chips asking for an accurate tap while the
            layout moved. The pager is now how you move between exercises, so
            this is a position indicator first and a jump target second - but it
            stays tappable, because swiping from exercise 1 to exercise 9 is
            eight gestures and one tap. A complete exercise is dimmed. */}
        <div className="mt-3 flex gap-1.5 overflow-x-auto px-5 pb-1">
          {planned.map((p, i) => {
            const count = (sets ?? []).filter((s) => s.exerciseId === p.exerciseId).length
            const complete = p.targetSets != null && count >= p.targetSets
            return (
              <button
                key={p.exerciseId}
                aria-label={p.name}
                onClick={() => setIndex(i)}
                className={`flex size-tap shrink-0 items-center justify-center rounded-full ${
                  i === index ? 'ring-primary ring-2' : complete ? 'opacity-40' : ''
                }`}
              >
                <MuscleBadge primaryMuscle={p.primaryMuscle} size="sm" />
              </button>
            )
          })}
        </div>
      </div>

      {/* Region 2: the pager. It is the only thing that scrolls, horizontally
          between exercises and vertically inside each one.

          `overscroll-x-contain` keeps a swipe past the last page from turning
          into a browser navigation. Whether it also competes with the Android
          edge-swipe back gesture is a device question, deliberately left to be
          measured rather than pre-emptively worked around in native code. */}
      <div
        ref={pagerRef}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
      >
        {planned.map((p, i) => (
          <ExercisePage
            key={p.exerciseId}
            pageIndex={i}
            planned={p}
            sets={sets ?? []}
            history={history?.get(p.exerciseId) ?? []}
            today={today}
            // Only the page in view owns the entry bar, so no other page may
            // render a slot as `editing`.
            editingSetId={i === index ? editingSetId : null}
            disabled={busy}
            onSelectSet={(id) => setEditingSetId((prev) => (prev === id ? null : id))}
          />
        ))}
      </div>

      {/* Region 3: docked, and it never moves. */}
      <div className="bg-surface-1 pb-safe-b shrink-0">
        <div className="flex flex-col gap-3 px-4 pt-3 pb-3">
          {/* Weight then reps, on ONE row, in the order they are spoken: "355
              for 8". Each field carries its own stacked handles, so the row
              needs nothing but a gap. A shape with only one field just gets a
              full-width version of the same component. */}
          <div className="flex items-stretch gap-3">
            {shape.weight !== 'none' && (
              <EntryField
                display={weightKg == null ? '' : formatWeight(weightKg, unit)}
                unit={unit}
                stepLabel={String(WEIGHT_STEPS[unit][0])}
                onStep={(steps) =>
                  setWeightKg((kg) => stepWeight(kg, steps * WEIGHT_STEPS[unit][0], unit))
                }
                parse={(text) => parseWeight(text, unit)}
                onParsed={setWeightKg}
              />
            )}

            {shape.reps && (
              <EntryField
                display={reps == null ? '' : String(reps)}
                unit="reps"
                stepLabel="1"
                onStep={(steps) => setReps((r) => stepReps(r, steps))}
                parse={parseReps}
                onParsed={setReps}
              />
            )}
          </div>

          {/* Duration keeps a row of its own. It never coexists with reps, so
              pairing it with the weight would leave a lopsided row. */}
          {shape.duration && (
            <div className="flex items-stretch gap-3">
              <EntryField
                display={formatDuration(durationS ?? 0)}
                stepLabel="15s"
                onStep={(steps) => setDurationS((d) => stepDuration(d, steps * 15))}
              />
            </div>
          )}

          {/* Cancel and Delete sit ABOVE the primary button, not beside it. The
              bar is docked, so growing it moves its top edge and leaves the
              primary exactly where LOG SET was - which is the whole point of
              region 3. Delete is also then nowhere near the button a thumb is
              aiming for. */}
          {editingSetId != null && (
            <div className="flex items-center justify-between px-1 text-sm">
              <button
                className="text-text-dim active:text-text px-2 py-1"
                onClick={() => setEditingSetId(null)}
              >
                Cancel
              </button>
              <button
                className="text-danger px-2 py-1 disabled:opacity-40"
                disabled={busy}
                onClick={handleDelete}
              >
                Delete set
              </button>
            </div>
          )}

          <button
            className="bg-primary text-on-primary rounded-2xl py-5 text-xl font-semibold tracking-wide active:opacity-90 disabled:opacity-40"
            disabled={!canLog || busy}
            onClick={editingSetId == null ? handleLog : handleSave}
          >
            {editingSetId == null ? 'LOG SET' : 'SAVE'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * One exercise's page in the pager: its history, then today's slots.
 *
 * Every page renders, not just the one in view. That is what makes the swipe
 * show real content rather than a blank that fills in on arrival, and it costs
 * nothing: the queries behind it are already fetched for the whole template in
 * one statement each, so a page is arithmetic over arrays that are in memory.
 */
function ExercisePage({
  pageIndex,
  planned,
  sets,
  history,
  today,
  editingSetId,
  disabled,
  onSelectSet,
}: {
  pageIndex: number
  planned: TemplateExerciseRow
  /** Every set in the session; the page filters to its own exercise. */
  sets: PerformedSet[]
  history: LastPerformance[]
  today: string
  editingSetId: number | null
  disabled: boolean
  onSelectSet: (setId: number) => void
}) {
  const unit: Unit = planned.preferredUnit
  const done = useMemo(
    () => sets.filter((s) => s.exerciseId === planned.exerciseId),
    [sets, planned.exerciseId],
  )
  const slots = useMemo(
    () => setSlots(done, planned.targetSets ?? null, editingSetId),
    [done, planned.targetSets, editingSetId],
  )

  // Which set the entry bar is aiming at, which is the row the history cards
  // light. Null when nothing is aimed anywhere, so no stale row stays lit.
  const activeIndex =
    slots.find((s) => s.state === 'active' || s.state === 'editing')?.index ?? null

  const earnedIncrease =
    planned.targetRepMax != null &&
    shouldIncreaseLoad(
      done.map((s) => s.reps ?? 0),
      planned.targetSets ?? done.length,
      planned.targetRepMax,
    )

  // What an unperformed slot reads. The reference app puts the rep target here
  // rather than a placeholder, which is better for the obvious reason: the row
  // tells you what you are aiming for while you are aiming at it.
  const repTarget = formatRepTarget(planned.targetRepMin, planned.targetRepMax)
  const emptyLabel = repTarget ? `${repTarget} reps` : '-'

  return (
    <div
      // Read back by the IntersectionObserver, which knows the element but not
      // its position in the list.
      data-page-index={pageIndex}
      className="w-full shrink-0 snap-center snap-always overflow-y-auto px-5 pt-3 pb-4"
    >
      {/* Today's sets first: what you are about to do outranks what you did in
          July, and it is what the thumb reaches for to correct a set. */}
      <div className="flex flex-col gap-2">
        {slots.map((slot) => (
          <SlotRow
            key={slot.set?.id ?? `empty-${slot.index}`}
            slot={slot}
            unit={unit}
            emptyLabel={emptyLabel}
            disabled={disabled}
            // Tapping the slot already being corrected puts the bar back to
            // entering, so the row is its own cancel.
            onSelect={onSelectSet}
          />
        ))}
      </div>

      {earnedIncrease && (
        <p className="mt-3 rounded-xl bg-amber-950 px-3 py-2 text-sm text-amber-300">
          Top of the range on every set - add load next time.
        </p>
      )}

      {/* Then the history stack, newest first. */}
      <div className="mt-4 flex flex-col gap-2">
        {history.length === 0 ? (
          <p className="text-text-dim text-sm">No history yet</p>
        ) : (
          history.map((past) => (
            <HistoryCard
              key={past.sessionId}
              localDate={past.localDate}
              today={today}
              sets={past.sets}
              unit={unit}
              activeIndex={activeIndex}
              describe={describeSet}
            />
          ))
        )}
      </div>
    </div>
  )
}

/**
 * One set, whether or not it has happened yet.
 *
 * The badge is lit for the slot that owns the entry bar and muted otherwise,
 * which is the treatment measured off the reference app: `#B4C5FF` for the
 * active set badge, `#424655` for an inactive one.
 */
function SlotRow({
  slot,
  unit,
  emptyLabel,
  disabled,
  onSelect,
}: {
  slot: SetSlot<PerformedSet>
  unit: Unit
  /** What an unperformed slot reads: the rep target it is asking for. */
  emptyLabel: string
  disabled: boolean
  onSelect: (setId: number) => void
}) {
  const { set, state, beyondTarget, index } = slot
  const lit = state === 'active' || state === 'editing'

  return (
    <button
      type="button"
      // An empty slot is not a target: it fills by logging, not by tapping.
      disabled={!set || disabled}
      onClick={() => set && onSelect(set.id)}
      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left ${
        // Dashed for a set nobody asked for, following the plate solver's
        // remainder chip. A solid card would claim it was part of the plan.
        beyondTarget ? 'border border-dashed border-muted' : 'bg-surface-1'
      } ${state === 'editing' ? 'ring-primary ring-2' : ''}`}
    >
      <span
        className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums ${
          lit ? 'bg-primary text-on-primary' : 'bg-muted text-text'
        }`}
      >
        {index + 1}
      </span>
      <span className={`tabular-nums ${set ? 'text-text' : 'text-text-dim'}`}>
        {set ? describeSet(set, unit) : emptyLabel}
      </span>
    </button>
  )
}
