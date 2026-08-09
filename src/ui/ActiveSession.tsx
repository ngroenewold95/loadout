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
 */
import { useEffect, useMemo, useState } from 'react'
import {
  useLastPerformance,
  useLogSet,
  useSessionSets,
  useTemplateExercises,
  useUndoLastSet,
} from '../state/queries.ts'
import { prefillFor, type PerformedSet, type SessionRow } from '../db/repo.ts'
import {
  entryShape,
  formatDuration,
  formatTarget,
  stepDuration,
  stepReps,
  stepWeight,
  WEIGHT_STEPS,
} from '../logic/entry.ts'
import { shouldIncreaseLoad } from '../logic/plan.ts'
import { formatWeight, type Unit } from '../logic/units.ts'
import { startRest } from '../native/restTimer.ts'
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
  const { data: previous } = useLastPerformance(exerciseIds, session.id)

  const [index, setIndex] = useState(0)
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null)

  const logSet = useLogSet()
  const undoLastSet = useUndoLastSet()

  const current = planned?.[index]
  const shape = current ? entryShape(current.trackingType) : null
  const unit: Unit = current?.preferredUnit ?? 'lb'

  const doneHere = useMemo(
    () => (sets ?? []).filter((s) => s.exerciseId === current?.exerciseId),
    [sets, current],
  )
  const lastTime = current ? previous?.get(current.exerciseId) : undefined

  // Draft entry. Re-seeded whenever the exercise changes or a set lands, which
  // is what makes the next set a single tap.
  const [weightKg, setWeightKg] = useState<number | null>(null)
  const [reps, setReps] = useState<number | null>(null)
  const [durationS, setDurationS] = useState<number | null>(null)

  useEffect(() => {
    if (!current) return
    const fill = prefillFor(sets ?? [], current.exerciseId, lastTime)
    setWeightKg(fill.weightKg)
    setReps(fill.reps ?? current.targetRepMin ?? null)
    setDurationS(fill.durationS)
  }, [current, sets, lastTime])

  if (!planned || !current || !shape) {
    return <p className="px-5 py-8 text-neutral-500">Loading session…</p>
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

  const handleLog = async () => {
    await logSet.mutateAsync({
      sessionId: session.id,
      exerciseId: current.exerciseId,
      weightKg: shape.weight === 'none' ? null : weightKg,
      // What was typed, kept so history renders in the unit it was logged in.
      enteredValue: weightKg == null ? null : Number(formatWeight(weightKg, unit)),
      enteredUnit: weightKg == null ? null : unit,
      reps: shape.reps ? reps : null,
      durationS: shape.duration ? durationS : null,
      baseWeightKg: current.baseWeightKg,
    })
    // Rest starts as a consequence of logging, never as its own tap.
    if (current.restS) setRestEndsAt(await startRest(current.restS))
  }

  const stepBtn =
    'rounded-xl bg-neutral-800 px-3 py-4 text-lg font-semibold tabular-nums active:bg-neutral-700'

  return (
    <div className="flex flex-1 flex-col">
      <RestBar
        endsAt={restEndsAt}
        onExtend={(ms) => setRestEndsAt((e) => (e == null ? e : e + ms))}
        onSkip={() => setRestEndsAt(null)}
      />

      <div className="flex items-baseline justify-between px-5 pt-3">
        <h2 className="text-xl font-semibold">{current.name}</h2>
        <span className="text-sm text-neutral-500">
          {index + 1}/{planned.length}
        </span>
      </div>

      <p className="px-5 text-sm text-neutral-500">
        {formatTarget(current.targetSets, current.targetRepMin, current.targetRepMax)}
        {current.notes ? ` · ${current.notes}` : ''}
        {current.restS ? ` · rest ${formatDuration(current.restS)}` : ''}
      </p>

      {/* Last session, always visible. */}
      <div className="mx-5 mt-3 rounded-xl bg-neutral-900 p-3">
        <p className="text-xs tracking-wide text-neutral-500 uppercase">
          {lastTime ? `Last time · ${lastTime.localDate}` : 'No history yet'}
        </p>
        {lastTime && (
          // Separate elements, not a joined string: HTML collapses runs of
          // whitespace, so "355 × 8   355 × 8" rendered as one unreadable line.
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-neutral-300">
            {lastTime.sets.map((s) => (
              <span key={s.id}>{describeSet(s, unit)}</span>
            ))}
          </div>
        )}
      </div>

      {/* This session so far. */}
      {doneHere.length > 0 && (
        <div className="mx-5 mt-2 flex flex-wrap gap-2">
          {doneHere.map((s) => (
            <span
              key={s.id}
              className="rounded-lg bg-emerald-950 px-2 py-1 text-sm tabular-nums text-emerald-300"
            >
              {describeSet(s, unit)}
            </span>
          ))}
        </div>
      )}

      {earnedIncrease && (
        <p className="mx-5 mt-2 rounded-xl bg-amber-950 px-3 py-2 text-sm text-amber-300">
          Top of the range on every set - add load next time.
        </p>
      )}

      {/* Entry. */}
      <div className="mt-4 flex flex-col gap-3 px-5">
        {shape.weight !== 'none' && (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <button
              className={stepBtn}
              onClick={() => setWeightKg(stepWeight(weightKg, -WEIGHT_STEPS[unit][0], unit))}
            >
              −{WEIGHT_STEPS[unit][0]}
            </button>
            <div className="min-w-28 text-center">
              <span className="text-4xl font-semibold tabular-nums">
                {weightKg == null ? '-' : formatWeight(weightKg, unit)}
              </span>
              <span className="ml-1 text-neutral-500">{unit}</span>
            </div>
            <button
              className={stepBtn}
              onClick={() => setWeightKg(stepWeight(weightKg, WEIGHT_STEPS[unit][0], unit))}
            >
              +{WEIGHT_STEPS[unit][0]}
            </button>
            <button
              className={`${stepBtn} text-sm`}
              onClick={() => setWeightKg(stepWeight(weightKg, -WEIGHT_STEPS[unit][1], unit))}
            >
              −{WEIGHT_STEPS[unit][1]}
            </button>
            <span />
            <button
              className={`${stepBtn} text-sm`}
              onClick={() => setWeightKg(stepWeight(weightKg, WEIGHT_STEPS[unit][1], unit))}
            >
              +{WEIGHT_STEPS[unit][1]}
            </button>
          </div>
        )}

        {shape.reps && (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <button className={stepBtn} onClick={() => setReps(stepReps(reps, -1))}>
              −1
            </button>
            <div className="min-w-28 text-center">
              <span className="text-4xl font-semibold tabular-nums">{reps ?? '-'}</span>
              <span className="ml-1 text-neutral-500">reps</span>
            </div>
            <button className={stepBtn} onClick={() => setReps(stepReps(reps, 1))}>
              +1
            </button>
          </div>
        )}

        {shape.duration && (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <button className={stepBtn} onClick={() => setDurationS(stepDuration(durationS, -15))}>
              −15s
            </button>
            <span className="min-w-28 text-center text-4xl font-semibold tabular-nums">
              {formatDuration(durationS ?? 0)}
            </span>
            <button className={stepBtn} onClick={() => setDurationS(stepDuration(durationS, 15))}>
              +15s
            </button>
          </div>
        )}

        <button
          className="rounded-2xl bg-emerald-700 py-6 text-xl font-semibold tracking-wide active:bg-emerald-600 disabled:opacity-40"
          disabled={!canLog || logSet.isPending}
          onClick={handleLog}
        >
          LOG SET
        </button>

        <div className="grid grid-cols-2 gap-3">
          <button
            className="rounded-xl bg-neutral-800 py-3 text-sm active:bg-neutral-700 disabled:opacity-40"
            disabled={(sets ?? []).length === 0 || undoLastSet.isPending}
            onClick={() => undoLastSet.mutate(session.id)}
          >
            Undo last set
          </button>
          <button
            className="rounded-xl bg-neutral-800 py-3 text-sm active:bg-neutral-700"
            onClick={onFinish}
          >
            Finish workout
          </button>
        </div>
      </div>

      {/* Exercise strip. Tapping moves between them; supersets just work, since
          order_index follows what actually happened rather than this list. */}
      <div className="mt-5 flex gap-2 overflow-x-auto px-5 pb-4">
        {planned.map((p, i) => {
          const count = (sets ?? []).filter((s) => s.exerciseId === p.exerciseId).length
          const complete = p.targetSets != null && count >= p.targetSets
          return (
            <button
              key={p.exerciseId}
              onClick={() => setIndex(i)}
              className={`shrink-0 rounded-lg px-3 py-2 text-xs ${
                i === index
                  ? 'bg-neutral-200 text-neutral-900'
                  : complete
                    ? 'bg-emerald-950 text-emerald-400'
                    : 'bg-neutral-900 text-neutral-400'
              }`}
            >
              {p.name}
              {count > 0 && ` ${count}`}
            </button>
          )
        })}
      </div>
    </div>
  )
}
