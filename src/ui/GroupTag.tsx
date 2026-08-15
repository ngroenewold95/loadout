/**
 * An exercise's identity: a colour rail and the group, said outright.
 *
 * This replaces the coloured letter circle taken from the reference app. The
 * three were put side by side on the phone, on both programme days, and the
 * circle lost on the fault it always had: Chest and Calves are both `C`, Back
 * and Biceps both `B`, so the letter carried nothing and the colour carried
 * everything - and at row size `Machine Calf Raise` maroon and `Chest Dip` red,
 * four rows apart, are close to the same colour. A body map was tried too and
 * failed differently: at 28 px the figure is most of the mark and the coloured
 * region is a few pixels, so every row read as "a small person".
 *
 * Saying `BICEPS` needs no colour learned first, cannot collide, and reaches
 * anyone who cannot separate these hues without a screen reader. The colour
 * stays as a rail, which is the part that survives being glanced at rather than
 * read, and it is the part `docs/PROGRESSION.md` actually measured.
 *
 * Two pieces rather than one component, because they are used at different
 * altitudes: the rail wherever there is a row to edge, the word wherever there
 * is a line to put it on. A screen that has room for both uses both.
 */
import { muscleMark } from '../logic/muscles.ts'

/** A colour edge for a row. Decorative: the word beside it carries the meaning. */
export function GroupRail({ primaryMuscle }: { primaryMuscle: string | null | undefined }) {
  const { color } = muscleMark(primaryMuscle)
  return (
    <span
      aria-hidden="true"
      className="w-1 shrink-0 self-stretch rounded-full"
      style={{ backgroundColor: color }}
    />
  )
}

/**
 * The group, said rather than encoded.
 *
 * Renders nothing at all when the group is unknown. The four unclassified
 * exercises are cardio and general mobility, which have no single primary
 * group, and an empty space is the honest answer where the circle used to
 * insist on a `?`.
 */
export function GroupWord({ primaryMuscle }: { primaryMuscle: string | null | undefined }) {
  const { muscle, color } = muscleMark(primaryMuscle)
  if (!muscle) return null
  return (
    <span className="text-[0.65rem] font-semibold tracking-wide uppercase" style={{ color }}>
      {muscle}
    </span>
  )
}
