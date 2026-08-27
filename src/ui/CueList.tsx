/**
 * Coaching cues as bullets, wherever they are shown.
 *
 * Two surfaces render these now: the exercise detail screen, and the info sheet
 * the logging screen opens with a bar in front of you. They were one component
 * from the moment there was a second caller, for the same reason the entry bar
 * is the only number editor - a second copy is free to drift from the first.
 */
import { guidanceCues } from '../logic/exerciseGuidance.ts'

export function CueList({
  guidance,
  empty = 'No guidance yet.',
}: {
  guidance: string | null | undefined
  /** What to say when nothing is authored. Only the programme's lifts are. */
  empty?: string
}) {
  const cues = guidanceCues(guidance)

  if (cues.length === 0) {
    return <p className="text-text-dim mt-2 text-sm">{empty}</p>
  }

  return (
    <ul className="mt-2 flex flex-col gap-2">
      {cues.map((cue) => (
        <li key={cue} className="flex gap-2 text-sm">
          <span className="text-text-dim" aria-hidden="true">
            ·
          </span>
          <span>{cue}</span>
        </li>
      ))}
    </ul>
  )
}
