/**
 * One number in the docked entry bar.
 *
 * Three ways to change it, taken from Progression (see `docs/PROGRESSION.md`)
 * because together they remove the need for any one of them to be good at
 * everything:
 *
 * - tap a step button for a single step
 * - drag vertically on a step button to scrub, about one step per 40 CSS px
 * - tap the number itself for the system numeric keypad
 *
 * The scrub is what makes a large change cheap and the keypad is what makes
 * precision cheap, which is why the secondary step button (the old −2.5 / +2.5
 * row) is not here. `PROJECT.md` flagged that pair as an open question to settle
 * with a thumb rather than a table; this is the version to settle it against.
 *
 * **The handles stack into one column beside the number rather than flanking
 * it**, so weight and reps fit on a single row. That row is the whole point:
 * the two numbers you are about to log are read together, and stacked they were
 * two glances and 130 px of the screen.
 *
 * The field carries its own `bg-field` box for the same reason. Side by side,
 * "which number is which" has to be answerable without reading the unit, and a
 * box does that where the old full-width rows did not need to.
 */
import { useRef, useState } from 'react'
import { scrubSteps, type Parsed } from '../logic/entry.ts'

interface Props {
  /** The value as it reads when nothing is being typed into the field. */
  display: string
  /** `lb`, `reps`, or nothing at all for a duration. */
  unit?: string
  /** Step button text, unsigned: `5`, `1`, `15s`. */
  stepLabel: string
  /** Apply `steps` whole steps, signed. One scrub frame can deliver several. */
  onStep: (steps: number) => void
  /** Omitted for a field with no keypad path, which is how duration renders. */
  parse?: (text: string) => Parsed<number>
  onParsed?: (value: number | null) => void
}

export function EntryField({ display, unit, stepLabel, onStep, parse, onParsed }: Props) {
  // Null means "showing the model value". Text that does not parse is held here
  // so it stays on screen while it is being typed, without anything being
  // written - `parseWeight` distinguishes a cleared field from garbage exactly
  // so a slipped thumb cannot log a set with no weight.
  const [draft, setDraft] = useState<string | null>(null)
  const parsed = draft != null && parse ? parse(draft) : null

  // A step lands on the model, so a half-typed draft is no longer what the
  // field shows. Without this, stepping while the keypad is open does nothing
  // visible.
  const step = (steps: number) => {
    setDraft(null)
    onStep(steps)
  }

  return (
    <div className="bg-field flex min-w-0 flex-1 items-center gap-1 rounded-2xl p-1.5">
      {/*
        A label, so the whole box left of the handles opens the keypad rather
        than only the glyphs themselves.

        The number is no longer a fixed-width column. That rule existed to line
        the weight up with the reps when they were stacked rows; side by side
        there is nothing to line up with, and a fixed column here would push
        `137.5` into the handles. It stays right-aligned so the unit does not
        wander as digits change.
      */}
      <label className="flex min-w-0 flex-1 cursor-text items-baseline justify-center gap-1 px-1">
        {parse && onParsed ? (
          <input
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="-"
            value={draft ?? display}
            className={`min-w-0 flex-1 bg-transparent text-right text-3xl font-semibold tabular-nums outline-none select-text ${
              parsed != null && !parsed.ok ? 'text-danger' : ''
            }`}
            // Selecting on focus makes the keypad replace rather than append,
            // which is what "type 225" should mean when 215 is already there.
            onFocus={(e) => {
              setDraft(display)
              e.currentTarget.select()
            }}
            onChange={(e) => {
              const text = e.currentTarget.value
              setDraft(text)
              const result = parse(text)
              if (result.ok) onParsed(result.value)
            }}
            onBlur={() => setDraft(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
        ) : (
          <span className="min-w-0 flex-1 text-right text-3xl font-semibold tabular-nums">
            {display}
          </span>
        )}
        {unit && <span className="text-text-dim shrink-0 text-sm">{unit}</span>}
      </label>

      {/* Plus above minus, the way a stepper reads. */}
      <div className="flex shrink-0 flex-col gap-1">
        <ScrubHandle label={`+${stepLabel}`} direction={1} onStep={step} />
        <ScrubHandle label={`−${stepLabel}`} direction={-1} onStep={step} />
      </div>
    </div>
  )
}

/**
 * A step button that is also the drag handle.
 *
 * Dragging **up** increases on either button, matching the reference app: the
 * handle's own sign only decides what a tap does. Screen coordinates grow
 * downward, hence the negation.
 *
 * `size-tap` is 48 px, Android's own minimum. These are smaller than the
 * flanking handles they replace (which measured about 64x60) and there is no
 * room to go below this: the whole point of the row is that two of them fit
 * beside two numbers.
 */
function ScrubHandle({
  label,
  direction,
  onStep,
}: {
  label: string
  direction: 1 | -1
  onStep: (steps: number) => void
}) {
  const lastY = useRef(0)
  const carryPx = useRef(0)
  const scrubbed = useRef(false)

  return (
    <button
      type="button"
      // `bg-muted`, not `bg-surface-3`: sitting ON the field now rather than on
      // the entry bar, and #272a32 against the field's #282c38 is not a step at
      // all. Looked at on the phone, the handles read as floating text rather
      // than as buttons. The reference app is no help here, since its steppers
      // are bare chevrons with no fill to measure.
      className="bg-muted active:bg-surface-3 flex size-tap shrink-0 items-center justify-center rounded-xl px-1 font-semibold tabular-nums select-none"
      // The gesture is vertical and must not scroll the page behind it as well.
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        // Capture, so a drag that wanders off the button keeps scrubbing.
        e.currentTarget.setPointerCapture(e.pointerId)
        lastY.current = e.clientY
        carryPx.current = 0
        scrubbed.current = false
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
        // Carry the leftover travel into the next frame, or a slow drag would
        // cover less ground than a fast one over the same distance.
        carryPx.current += lastY.current - e.clientY
        lastY.current = e.clientY
        const { steps, remainderPx } = scrubSteps(carryPx.current)
        carryPx.current = remainderPx
        if (steps === 0) return
        scrubbed.current = true
        onStep(steps)
      }}
      // A drag too short to earn a step never emitted one, so it is still a tap.
      onClick={() => {
        if (!scrubbed.current) onStep(direction)
      }}
    >
      {label}
    </button>
  )
}
