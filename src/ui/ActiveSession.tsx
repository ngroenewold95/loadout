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
 */
import { useEffect, useMemo, useState } from 'react'
import {
  useRecentPerformance,
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
  parseReps,
  parseWeight,
  stepDuration,
  stepReps,
  stepWeight,
  WEIGHT_STEPS,
} from '../logic/entry.ts'
import { shouldIncreaseLoad } from '../logic/plan.ts'
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

  const logSet = useLogSet()
  const undoLastSet = useUndoLastSet()

  const current = planned?.[index]
  const shape = current ? entryShape(current.trackingType) : null
  const unit: Unit = current?.preferredUnit ?? 'lb'

  const doneHere = useMemo(
    () => (sets ?? []).filter((s) => s.exerciseId === current?.exerciseId),
    [sets, current],
  )
  // Several sessions back are available now; stage 5 stacks them as cards. The
  // most recent is what prefills and what the panel shows today.
  const lastTime = current ? history?.get(current.exerciseId)?.[0] : undefined

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

        <p className="text-text-dim px-5 pt-1 text-sm">
          {formatTarget(current.targetSets, current.targetRepMin, current.targetRepMax)}
          {current.notes ? ` · ${current.notes}` : ''}
          {current.restS ? ` · rest ${formatDuration(current.restS)}` : ''}
        </p>

        {/* Exercise strip. Tapping moves between them; supersets just work,
            since order_index follows what actually happened rather than this
            list. Pinned rather than trailing the page, because navigation you
            have to scroll to find is not navigation. Stage 5 replaces it with
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

        {/* This session so far, with Undo beside the chip it removes. */}
        {doneHere.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {doneHere.map((s) => (
              <span
                key={s.id}
                className="rounded-lg bg-emerald-950 px-2 py-1 text-sm tabular-nums text-emerald-300"
              >
                {describeSet(s, unit)}
              </span>
            ))}
            <button
              className="text-text-dim active:text-text px-1 py-1 text-sm disabled:opacity-40"
              disabled={(sets ?? []).length === 0 || undoLastSet.isPending}
              onClick={() => undoLastSet.mutate(session.id)}
            >
              Undo
            </button>
          </div>
        )}

        {earnedIncrease && (
          <p className="mt-3 rounded-xl bg-amber-950 px-3 py-2 text-sm text-amber-300">
            Top of the range on every set - add load next time.
          </p>
        )}
      </div>

      {/* Region 3: docked, and it never moves. */}
      <div className="bg-surface-1 pb-safe-b shrink-0">
        <div className="flex flex-col gap-3 px-4 pt-3 pb-3">
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

          {shape.duration && (
            <EntryField
              display={formatDuration(durationS ?? 0)}
              stepLabel="15s"
              onStep={(steps) => setDurationS((d) => stepDuration(d, steps * 15))}
            />
          )}

          <button
            className="bg-primary text-on-primary rounded-2xl py-5 text-xl font-semibold tracking-wide active:opacity-90 disabled:opacity-40"
            disabled={!canLog || logSet.isPending}
            onClick={handleLog}
          >
            LOG SET
          </button>
        </div>
      </div>
    </div>
  )
}
