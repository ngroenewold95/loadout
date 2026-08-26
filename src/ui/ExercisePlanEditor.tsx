/**
 * What an exercise is asking for: sets, rep range and rest.
 *
 * **Mounted from both the template editor and the live workout**, writing
 * through one repo function to whichever table the scope names. That is the
 * insight taken from the reference app and the whole reason stage 13 exists as
 * a stage: the same editor in both places is what stops the programme and the
 * performance of it drifting apart.
 *
 * The numbers are `EntryField`s, not a new control. That component already
 * carries the stepper, the drag scrub and the keypad, all measured on device;
 * a second number editor here would be free to diverge from the one the whole
 * app is built around, which is the argument stage 6 used to refuse a modal set
 * editor and it has not changed.
 *
 * Nothing here is destructive, so nothing here confirms. `Remove` keeps its
 * second tap, in the menu this opens from.
 */
import { useState } from 'react'
import { formatDuration, parseReps } from '../logic/entry.ts'
import type { ExercisePlanPatch, TemplateExerciseRow } from '../db/repo.ts'
import { ActionSheet } from './ActionSheet.tsx'
import { EntryField } from './EntryField.tsx'

interface Props {
  row: TemplateExerciseRow
  /** Lowest the set count may go. The session editor clamps at sets performed. */
  minSets?: number
  busy?: boolean
  onSave: (patch: ExercisePlanPatch) => void | Promise<void>
  onClose: () => void
}

/** Rest moves in 15 s steps, which is the granularity the rest pill edits in. */
const REST_STEP = 15

export function ExercisePlanEditor({ row, minSets = 1, busy = false, onSave, onClose }: Props) {
  const [sets, setSets] = useState<number | null>(row.targetSets)
  const [repMin, setRepMin] = useState<number | null>(row.targetRepMin)
  const [repMax, setRepMax] = useState<number | null>(row.targetRepMax)
  const [restS, setRestS] = useState<number | null>(row.restS)

  // The CHECK constraint would refuse this anyway and the repo throws before it
  // gets there. Saying so here means the button is simply unavailable rather
  // than an error appearing after a tap.
  const backwards = repMin != null && repMax != null && repMax < repMin

  const step = (
    value: number | null,
    steps: number,
    size: number,
    floor: number,
  ): number => Math.max(floor, (value ?? 0) + steps * size)

  return (
    <ActionSheet title={row.name} onClose={onClose}>
      <div className="flex flex-col gap-3 px-5 pt-1 pb-4">
        <Row label="Sets">
          <PlanField
            display={sets == null ? '' : String(sets)}
            stepLabel="1"
            onStep={(steps) => setSets((v) => step(v, steps, 1, minSets))}
            onParsed={setSets}
          />
        </Row>

        <Row label="Reps">
          <div className="flex items-stretch gap-3">
            <PlanField
              display={repMin == null ? '' : String(repMin)}
              unit="min"
              stepLabel="1"
              onStep={(steps) => setRepMin((v) => step(v, steps, 1, 1))}
              onParsed={setRepMin}
            />
            <PlanField
              display={repMax == null ? '' : String(repMax)}
              unit="max"
              stepLabel="1"
              onStep={(steps) => setRepMax((v) => step(v, steps, 1, 1))}
              onParsed={setRepMax}
            />
          </div>
        </Row>

        <Row label="Rest">
          <PlanField
            display={restS == null ? '' : formatDuration(restS)}
            stepLabel={`${REST_STEP}s`}
            onStep={(steps) => setRestS((v) => step(v, steps, REST_STEP, 0))}
          />
        </Row>

        {backwards && (
          <p className="text-danger text-sm">
            The rep range ends below where it starts.
          </p>
        )}

        <button
          type="button"
          className="bg-primary text-on-primary rounded-2xl py-4 font-semibold active:opacity-90 disabled:opacity-40"
          disabled={busy || backwards}
          onClick={() => {
            void onSave({
              targetSets: sets,
              targetRepMin: repMin,
              targetRepMax: repMax,
              restS,
            })
          }}
        >
          Save
        </button>
      </div>
    </ActionSheet>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-text-dim mb-1 text-xs tracking-wide uppercase">{label}</p>
      {children}
    </div>
  )
}

/**
 * An `EntryField` with the keypad wired to whole reps.
 *
 * Every number on this sheet is a small integer, so they all parse the same
 * way. Rest is the exception and takes no keypad: it reads `4:00`, which is not
 * what a numeric keypad would produce.
 */
function PlanField({
  display,
  unit,
  stepLabel,
  onStep,
  onParsed,
}: {
  display: string
  unit?: string
  stepLabel: string
  onStep: (steps: number) => void
  onParsed?: (value: number | null) => void
}) {
  return (
    <EntryField
      display={display}
      unit={unit}
      stepLabel={stepLabel}
      onStep={onStep}
      parse={onParsed ? parseReps : undefined}
      onParsed={onParsed}
    />
  )
}
