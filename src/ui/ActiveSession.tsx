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
 */
import { useEffect, useMemo, useState } from 'react'
import {
  useDeleteSet,
  useRecentPerformance,
  useLogSet,
  useSessionSets,
  useTemplateExercises,
  useUpdateSet,
} from '../state/queries.ts'
import { prefillFor, type PerformedSet, type SessionRow } from '../db/repo.ts'
import {
  entryShape,
  formatDuration,
  formatTarget,
  parseReps,
  parseWeight,
  stepDuration,
  stepReps,
  stepWeight,
  WEIGHT_STEPS,
} from '../logic/entry.ts'
import { shouldIncreaseLoad } from '../logic/plan.ts'
import { setSlots, type SetSlot } from '../logic/slots.ts'
import { formatWeight, type Unit } from '../logic/units.ts'
import { startRest } from '../native/restTimer.ts'
import { EntryField } from './EntryField.tsx'
import { MuscleBadge } from './MuscleBadge.tsx'
import { RestBar } from './RestBar.tsx'

interface Props {
  session: SessionRow
  onFinish: () => void
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

export function ActiveSession({ session, onFinish }: Props) {
  const { data: planned } = useTemplateExercises(session.templateId)
  const { data: sets } = useSessionSets(session.id)
  const exerciseIds = useMemo(() => (planned ?? []).map((p) => p.exerciseId), [planned])
  const { data: history } = useRecentPerformance(exerciseIds, session.id)

  const [index, setIndex] = useState(0)
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
  // Several sessions back are available now; stage 7 stacks them as cards. The
  // most recent is what prefills and what the panel shows today.
  const lastTime = current ? history?.get(current.exerciseId)?.[0] : undefined

  const slots = useMemo(
    () => setSlots(doneHere, current?.targetSets ?? null, editingSetId),
    [doneHere, current, editingSetId],
  )

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

  const earnedIncrease =
    current.targetRepMax != null &&
    shouldIncreaseLoad(
      doneHere.map((s) => s.reps ?? 0),
      current.targetSets ?? doneHere.length,
      current.targetRepMax,
    )

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
            {/* Deliberately small, and nowhere near LOG SET. */}
            <button className="active:text-text" onClick={onFinish}>
              Finish
            </button>
          </div>
        </div>

        <p className="text-text-dim px-5 pt-1 text-sm">{targetLine}</p>

        {/* Exercise strip. Tapping moves between them; supersets just work,
            since order_index follows what actually happened rather than this
            list. Pinned rather than trailing the page, because navigation you
            have to scroll to find is not navigation. Stage 7 replaces it with
            a swipe pager. */}
        <div className="mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
          {planned.map((p, i) => {
            const count = (sets ?? []).filter((s) => s.exerciseId === p.exerciseId).length
            const complete = p.targetSets != null && count >= p.targetSets
            return (
              <button
                key={p.exerciseId}
                onClick={() => setIndex(i)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs ${
                  i === index
                    ? 'bg-primary text-on-primary'
                    : complete
                      ? 'bg-surface-1 text-text opacity-60'
                      : 'bg-surface-1 text-text-dim'
                }`}
              >
                <MuscleBadge primaryMuscle={p.primaryMuscle} size="sm" />
                {p.name}
                {p.targetSets != null && ` ${count}/${p.targetSets}`}
              </button>
            )
          })}
        </div>
      </div>

      {/* Region 2: the only thing that scrolls. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-4">
        {/* Last session, always visible. */}
        <div className="bg-surface-1 rounded-xl p-3">
          <p className="text-text-dim text-xs tracking-wide uppercase">
            {lastTime ? `Last time · ${lastTime.localDate}` : 'No history yet'}
          </p>
          {lastTime && (
            // Separate elements, not a joined string: HTML collapses runs of
            // whitespace, so "355 × 8   355 × 8" rendered as one unreadable line.
            <div className="text-text mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
              {lastTime.sets.map((s) => (
                <span key={s.id}>{describeSet(s, unit)}</span>
              ))}
            </div>
          )}
        </div>

        {/* Today's sets, listed before they are performed. */}
        <div className="mt-3 flex flex-col gap-2">
          {slots.map((slot) => (
            <SlotRow
              key={slot.set?.id ?? `empty-${slot.index}`}
              slot={slot}
              unit={unit}
              disabled={busy}
              // Tapping the slot already being corrected puts the bar back to
              // entering, so the row is its own cancel.
              onSelect={(id) => setEditingSetId((prev) => (prev === id ? null : id))}
            />
          ))}
        </div>

        {earnedIncrease && (
          <p className="mt-3 rounded-xl bg-amber-950 px-3 py-2 text-sm text-amber-300">
            Top of the range on every set - add load next time.
          </p>
        )}
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
 * One set, whether or not it has happened yet.
 *
 * The badge is lit for the slot that owns the entry bar and muted otherwise,
 * which is the treatment measured off the reference app: `#B4C5FF` for the
 * active set badge, `#424655` for an inactive one.
 */
function SlotRow({
  slot,
  unit,
  disabled,
  onSelect,
}: {
  slot: SetSlot<PerformedSet>
  unit: Unit
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
        {set ? describeSet(set, unit) : '-'}
      </span>
    </button>
  )
}
