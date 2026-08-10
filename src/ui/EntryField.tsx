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
    <div className="flex items-center gap-2">
      <ScrubHandle label={`−${stepLabel}`} direction={-1} onStep={step} />

      {/*
        A label, so the whole gap between the handles opens the keypad rather
        than only the glyphs themselves.

        Both columns are fixed width, which is what lines the weight and the
        reps up with each other: the numbers end on one edge and the units
        begin on another, whether the value is `8` or `355`. Letting the number
        take the space instead left `lb` stranded against the + handle.
      */}
      <label className="flex min-w-0 flex-1 cursor-text items-baseline justify-center gap-1">
        {parse && onParsed ? (
          <input
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="-"
            value={draft ?? display}
            className={`w-28 min-w-0 bg-transparent text-right text-4xl font-semibold tabular-nums outline-none select-text ${
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
          <span className="w-28 text-right text-4xl font-semibold tabular-nums">{display}</span>
        )}
        <span className="text-text-dim w-12 shrink-0 text-left">{unit}</span>
      </label>

      <ScrubHandle label={`+${stepLabel}`} direction={1} onStep={step} />
    </div>
  )
}

/**
 * A step button that is also the drag handle.
 *
 * Dragging **up** increases on either button, matching the reference app: the
 * handle's own sign only decides what a tap does. Screen coordinates grow
 * downward, hence the negation.
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
      className="bg-surface-3 active:bg-muted shrink-0 rounded-xl px-5 py-4 text-lg font-semibold tabular-nums select-none"
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
