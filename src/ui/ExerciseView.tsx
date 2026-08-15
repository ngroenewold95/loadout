/**
 * The logging loop: one exercise at a time, pushed from `WorkoutOverview`.
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
 * **Exercises are a horizontal pager, and nothing else.** The middle region is a
 * scroll-snap scroller holding one page per exercise, each with its own vertical
 * scroller, so the three regions survive intact.
 *
 * The row of muscle badges that used to sit above it is **gone**, and with it
 * two faults measured on device: a tap more than one page away snapped back,
 * because the smooth scroll it started dragged intermediate pages through the
 * `IntersectionObserver` and the index effect then re-targeted the scroll at
 * one of them; and the ring around the selected badge was clipped, because a
 * horizontally scrolling container clips on both axes. Both were the same
 * mistake - a 20 px moving target asked to act as navigation. Swipe to a
 * neighbour, back out to the overview for anywhere else.
 *
 * What replaces it is a segmented progress bar, one segment per exercise,
 * filled by sets logged. It answers "where am I" without asking for a tap.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  useDeleteSet,
  useRecentPerformance,
  useLogSet,
  useSessionExercises,
  useSessionSets,
  useSetPlannedSets,
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
import { useEntryDraft, useExerciseIndex, useWorkout } from '../state/workout.ts'
import { formatWeight, weightsEqual, type Unit } from '../logic/units.ts'
import { startRest } from '../native/restTimer.ts'
import { EntryField } from './EntryField.tsx'
import { HistoryCard } from './HistoryCard.tsx'
import { GroupRail, GroupWord } from './GroupTag.tsx'

interface Props {
  session: SessionRow
  /** Where to open. The pager owns the position from there - see `workout.ts`. */
  openAt: number
}

/**
 * Compare two nullable numbers, one of which may be a weight.
 *
 * Weights must go through `weightsEqual`, never `===`: 9 of the 105 distinct
 * weights in five years of history fail a bit-exact lb->kg->lb round trip, and
 * this is exactly the shape that bites - a stored value against a freshly
 * computed one.
 */
function bothNullOr(
  a: number | null,
  b: number | null,
  equal: (x: number, y: number) => boolean,
): boolean {
  if (a == null || b == null) return a == null && b == null
  return equal(a, b)
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

export function ExerciseView({ session, openAt }: Props) {
  const push = useNav((s) => s.push)
  const openSummary = () => push({ kind: 'summary', sessionId: session.id })

  // The session's own copy of the plan, never the template: editing a workout
  // in progress must not rewrite the programme. See `session_exercises`.
  const { data: planned } = useSessionExercises(session.id)
  const { data: sets } = useSessionSets(session.id)
  const exerciseIds = useMemo(() => (planned ?? []).map((p) => p.exerciseId), [planned])
  const { data: history } = useRecentPerformance(exerciseIds, session.id)

  // Outside the component, so pushing the summary and coming back does not
  // reset the pager to the first exercise. Measured on device; see workout.ts.
  const index = useExerciseIndex(session.id)
  /**
   * Move the pager, and keep the nav stack saying the same thing.
   *
   * The screen entry carries the index it was opened at, and this screen gets
   * re-mounted every time something pushed over it pops. Without the `replace`
   * the entry would still hold the page you *arrived* on, and coming back from
   * the summary would land there instead of where you had swiped to - which is
   * the exact bug stage 8 already fixed once, in a different place.
   *
   * Stable, so the observer effect below is not torn down and rebuilt on every
   * render just to close over a fresh copy of it.
   */
  const setIndex = useCallback(
    (at: number) => {
      useWorkout.getState().setIndex(session.id, at)
      useNav.getState().replace({ kind: 'exercise', sessionId: session.id, index: at })
    },
    [session.id],
  )

  const pagerRef = useRef<HTMLDivElement>(null)
  // The rest lives in the store, not here: the pill that renders it sits in the
  // app bar, which is above this screen and outlives it.
  const startRestTimer = useWorkout((s) => s.startRest)

  const logSet = useLogSet()
  const updateSet = useUpdateSet()
  const deleteSet = useDeleteSet()
  const planSets = useSetPlannedSets()

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

  /**
   * Draft entry, held in the store rather than here.
   *
   * This screen is pushed, so opening the summary or the picker unmounts it,
   * and a half-typed weight held in `useState` would be gone on the way back.
   * `useEntryDraft` returns null for any other exercise, so there is no stale
   * value to guard against at the call sites below.
   */
  const exerciseId = current?.exerciseId
  const draft = useEntryDraft(session.id, exerciseId)
  const patchDraft = useWorkout((s) => s.patchDraft)
  const clearDraft = useWorkout((s) => s.clearDraft)
  const weightKg = draft?.weightKg ?? null
  const reps = draft?.reps ?? null
  const durationS = draft?.durationS ?? null
  /** The set the entry bar is pointed at, or null when it is entering a new one. */
  const editingSetId = draft?.editingSetId ?? null

  // `patchDraft` marks the draft touched, which is what makes it survive a
  // push. Every one of these is a hand edit, so that is exactly right.
  const stepWeightBy = (steps: number) =>
    patchDraft({ weightKg: stepWeight(weightKg, steps, unit) })
  const stepRepsBy = (steps: number) => patchDraft({ reps: stepReps(reps, steps) })
  const stepDurationBy = (steps: number) =>
    patchDraft({ durationS: stepDuration(durationS, steps) })

  /**
   * Put the pager on the right page, and tell the store, before anything
   * observes either.
   *
   * A layout effect setting `scrollLeft` directly rather than scrolling
   * smoothly, for a reason that is a race rather than a preference: the observer
   * below would otherwise register while page 0 was still in view, fire, and
   * reset the position. Positioning synchronously before paint means the
   * observer's first callback agrees with the state instead of fighting it.
   *
   * **`openAt` is the authority here, not the rendered `index`.** Doing this in
   * two effects - one to write `openAt` into the store, one to position the
   * pager - looked equivalent and was not: the second read the index from a
   * render that had not seen the first, positioned the pager at page 0, and the
   * observer then claimed page 0 as the truth. Measured on device, opening
   * exercise 9 of 10 from the overview landed on 2 of 10. One effect, one
   * source, no window in between.
   */
  const [pagerReady, setPagerReady] = useState(false)
  useLayoutEffect(() => {
    const pager = pagerRef.current
    if (!pager || pagerReady || !planned?.length) return
    // Clamped: an exercise removed from the overview can leave a nav entry
    // pointing past the end of the list.
    const at = Math.min(Math.max(openAt, 0), planned.length - 1)
    useWorkout.getState().setIndex(session.id, at)
    pager.scrollLeft = at * pager.clientWidth
    setPagerReady(true)
  }, [planned, pagerReady, openAt, session.id])

  /**
   * Swiping updates the index.
   *
   * An `IntersectionObserver` rather than a scroll handler: it fires when a page
   * has actually settled into view instead of on every frame of the gesture, so
   * the header does not flicker between two exercises mid-swipe.
   */
  useEffect(() => {
    const pager = pagerRef.current
    if (!pager || !pagerReady) return

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
  }, [planned?.length, pagerReady, setIndex])

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
    if (!pager || !pagerReady) return
    const target = index * pager.clientWidth
    if (Math.abs(pager.scrollLeft - target) < pager.clientWidth / 4) return
    pager.scrollTo({ left: target, behavior: 'smooth' })
  }, [index, pagerReady])

  /**
   * Seed the draft, and re-seed it whenever the answer it holds goes stale.
   *
   * **A hand-edited draft is left alone.** Everything below is the prefill
   * chain's own answer, and re-deriving it is right up until the moment a
   * number has been typed - after that, overwriting it would throw away the
   * only value in the bar nobody could recompute. `touched` is the whole
   * difference, and it is what lets the draft survive a push at all.
   *
   * Aiming the bar at a set is a hand edit as well, so `handleSelectSet` loads
   * that set's numbers itself rather than leaving it to this effect. One place
   * decides what the bar holds in each case, instead of two taking turns.
   */
  const setDraft = useWorkout((s) => s.setDraft)
  useEffect(() => {
    if (!current) return
    const live = useWorkout.getState().draft
    const mine =
      live && live.sessionId === session.id && live.exerciseId === current.exerciseId
        ? live
        : null
    const fill = prefillFor(sets ?? [], current.exerciseId, lastTime)
    const reps = fill.reps ?? current.targetRepMin ?? null

    /**
     * Two ways to already be right, and **both** are load-bearing.
     *
     * `touched` is the one this exists for: a hand-edited draft is never
     * overwritten. The value comparison is what stops the effect looping - it
     * writes a fresh object, and `draft` is a dependency, so seeding an
     * untouched draft that is already correct would re-trigger this and seed
     * again, forever. That is React error #185, and it took the screen down on
     * device before this check existed.
     */
    if (
      mine &&
      (mine.touched ||
        (bothNullOr(mine.weightKg, fill.weightKg, weightsEqual) &&
          mine.reps === reps &&
          mine.durationS === fill.durationS &&
          mine.editingSetId === null))
    ) {
      return
    }

    setDraft({
      sessionId: session.id,
      exerciseId: current.exerciseId,
      weightKg: fill.weightKg,
      reps,
      durationS: fill.durationS,
      editingSetId: null,
      touched: false,
    })
    // `draft` is a dependency so that dropping it - logging a set, saving a
    // correction, cancelling - re-seeds immediately rather than waiting for the
    // refetch to hand back a new `sets` array.
  }, [current, sets, lastTime, session.id, setDraft, draft])

  /**
   * Point the bar at a set, or back at entering a new one.
   *
   * Tapping the slot already being corrected is its own cancel, and cancelling
   * drops the draft entirely so the effect above re-seeds from the prefill
   * chain - which is what "back to entering" has to mean.
   */
  const handleSelectSet = (setId: number) => {
    if (!current) return
    if (editingSetId === setId) {
      clearDraft()
      return
    }
    const set = (sets ?? []).find((s) => s.id === setId)
    if (!set) return
    setDraft({
      sessionId: session.id,
      exerciseId: current.exerciseId,
      weightKg: set.weightKg,
      reps: set.reps,
      durationS: set.durationS,
      editingSetId: setId,
      touched: true,
    })
  }

  if (!planned || !current || !shape) {
    return <p className="px-5 py-8 text-text-dim">Loading session…</p>
  }

  const canLog =
    (shape.weight !== 'required' || weightKg != null) &&
    (!shape.reps || reps != null) &&
    (!shape.duration || durationS != null)

  const busy =
    logSet.isPending ||
    updateSet.isPending ||
    deleteSet.isPending ||
    planSets.isPending

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
    // The draft has served its purpose, and it is `touched`, so leaving it would
    // pin the numbers just logged instead of letting the prefill chain answer
    // for the next set. Dropping it is what re-seeds.
    clearDraft()
    // Rest starts as a consequence of logging, never as its own tap.
    if (current.restS) {
      startRestTimer(await startRest(current.restS), current.restS * 1000)
    }

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
    clearDraft()
  }

  const handleDelete = async () => {
    if (editingSetId == null) return
    // The repo closes the numbering gap a middle delete leaves, so the slots
    // renumber themselves on the refetch.
    await deleteSet.mutateAsync({ setId: editingSetId, sessionId: session.id })
    clearDraft()
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
        <div className="flex items-center justify-between gap-3 px-5 pt-3">
          <div className="flex min-w-0 items-stretch gap-3">
            <GroupRail primaryMuscle={current.primaryMuscle} />
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold">{current.name}</h2>
              <GroupWord primaryMuscle={current.primaryMuscle} />
            </div>
          </div>
          {/* `Finish` is gone from here: it lives on the overview now, which is
              one back gesture away and is not a screen a thumb aims at while
              logging. The mis-tap `PROJECT.md` records landed on exactly that
              button. */}
          <span className="text-text-dim shrink-0 text-sm tabular-nums">
            {index + 1}/{planned.length}
          </span>
        </div>

        <p className="text-text-dim px-5 pt-1 text-sm">{targetLine}</p>

        {/* Where you are in the workout, as progress rather than navigation.

            One segment per exercise, filled when its target is met and lit for
            the one in view. It replaces the badge strip, which asked for an
            accurate tap on a 20 px target while the layout moved and got two
            faults on device for it. Nothing here is tappable: going anywhere
            other than a neighbour is what the overview is for. */}
        <div className="mt-3 flex gap-1 px-5 pb-1" aria-hidden="true">
          {planned.map((p, i) => {
            const count = (sets ?? []).filter((s) => s.exerciseId === p.exerciseId).length
            const complete = p.targetSets != null && count >= p.targetSets
            return (
              <span
                key={p.exerciseId}
                className={`h-1 flex-1 rounded-full ${
                  i === index ? 'bg-primary' : complete ? 'bg-text-dim' : 'bg-muted'
                }`}
              />
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
            onSelectSet={handleSelectSet}
            onPlanSets={(exerciseId, targetSets) =>
              planSets.mutate({ sessionId: session.id, exerciseId, targetSets })
            }
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
                onStep={(steps) => stepWeightBy(steps * WEIGHT_STEPS[unit][0])}
                parse={(text) => parseWeight(text, unit)}
                onParsed={(kg) => patchDraft({ weightKg: kg })}
              />
            )}

            {shape.reps && (
              <EntryField
                display={reps == null ? '' : String(reps)}
                unit="reps"
                stepLabel="1"
                onStep={stepRepsBy}
                parse={parseReps}
                onParsed={(r) => patchDraft({ reps: r })}
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
                onStep={(steps) => stepDurationBy(steps * 15)}
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
                onClick={clearDraft}
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
  onPlanSets,
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
  /** Raise or lower how many sets THIS session is asking for. */
  onPlanSets: (exerciseId: number, targetSets: number) => void
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
            // A planned set nobody has performed can be un-planned, which is
            // what makes `Add set` reversible. The ACTIVE slot is deliberately
            // not removable: it is where the next set lands, and taking it away
            // would leave LOG SET with nowhere to put anything.
            onUnplan={
              slot.set == null && slot.state === 'pending' && planned.targetSets != null
                ? () => onPlanSets(planned.exerciseId, planned.targetSets! - 1)
                : undefined
            }
          />
        ))}

        {/* `Add set` is a ROW, not a button, in the same badge column as the
            set numbers - measured off the reference app. It raises this
            session's target, so `2/2 sets` becomes `2/3` and the fraction stays
            honest, rather than an extra set just happening and the denominator
            never moving. */}
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onPlanSets(planned.exerciseId, (planned.targetSets ?? done.length) + 1)
          }
          className="border-muted text-text-dim active:text-text flex items-center gap-3 rounded-xl border border-dashed px-3 py-2 text-left disabled:opacity-40"
        >
          <span className="bg-muted text-text flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
            +
          </span>
          <span className="text-sm">Add set</span>
        </button>
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

      {/* Plan edits used to sit here as a row of four. They are on the overview
          card now, which is where the reference app puts them and where they
          act on an exercise you are looking at rather than one you are lifting.
          `Move earlier` / `Move later` are gone outright: with a list to jump
          from, reordering a live workout answers no question. */}
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
  onUnplan,
}: {
  slot: SetSlot<PerformedSet>
  unit: Unit
  /** What an unperformed slot reads: the rep target it is asking for. */
  emptyLabel: string
  disabled: boolean
  onSelect: (setId: number) => void
  /** Given only for a planned set that can be taken back off the plan. */
  onUnplan?: () => void
}) {
  const { set, state, beyondTarget, index } = slot
  const lit = state === 'active' || state === 'editing'

  return (
    <div
      className={`flex items-center gap-3 rounded-xl pr-1 pl-3 ${
        // Dashed for a set nobody asked for, following the plate solver's
        // remainder chip. A solid card would claim it was part of the plan.
        beyondTarget ? 'border border-dashed border-muted' : 'bg-surface-1'
      } ${state === 'editing' ? 'ring-primary ring-2' : ''}`}
    >
      <button
        type="button"
        // An empty slot is not a target: it fills by logging, not by tapping.
        disabled={!set || disabled}
        onClick={() => set && onSelect(set.id)}
        className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
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

      {onUnplan && (
        <button
          type="button"
          aria-label={`Remove set ${index + 1}`}
          disabled={disabled}
          onClick={onUnplan}
          className="text-text-dim active:text-text flex size-tap shrink-0 items-center justify-center disabled:opacity-40"
        >
          ×
        </button>
      )}
    </div>
  )
}
