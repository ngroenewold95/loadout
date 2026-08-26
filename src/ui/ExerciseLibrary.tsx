/**
 * Every exercise, as a screen of its own.
 *
 * A wrapper around the picker rather than a second list. `ExercisePicker.tsx`
 * was split from its session wiring on the day it was written, with a comment
 * saying so; this is the second consumer that split was for, and the whole
 * screen is the twenty lines below.
 *
 * The limit is raised because this is the library rather than a picker: the
 * point is that all 87 are reachable, and 50 would silently hide the tail of
 * five years.
 */
import { ExercisePicker } from './ExercisePicker.tsx'
import { useNav } from '../state/nav.ts'

/** More than the 87 that exist, so nothing is cut off as the list grows. */
const ALL = 200

export function ExerciseLibrary() {
  const push = useNav((s) => s.push)

  return (
    <ExercisePicker
      limit={ALL}
      onPick={(exerciseId) => push({ kind: 'exerciseInfo', exerciseId })}
    />
  )
}
