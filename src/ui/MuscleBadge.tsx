/**
 * The coloured circle that gives an exercise a visual identity.
 *
 * A template is 21 names that mostly begin with "Machine" or "Cable", and
 * reading them under a bar is slow. `docs/PROGRESSION.md` records why this
 * works in the reference app: the same circle appears in the picker, the
 * workout and the template, so the exercise is recognised rather than read.
 *
 * The initial alone is never enough - Chest and Calves are both `C` - so the
 * colour is the identity and the letter is the reminder. Both always render
 * together for that reason.
 */
import { muscleBadge } from '../logic/muscles.ts'

interface Props {
  primaryMuscle: string | null | undefined
  /** `md` in the exercise header, `sm` in the strip. */
  size?: 'sm' | 'md'
}

const SIZES = {
  sm: 'h-5 w-5 text-[0.625rem]',
  md: 'h-8 w-8 text-sm',
} as const

export function MuscleBadge({ primaryMuscle, size = 'md' }: Props) {
  const { initial, color } = muscleBadge(primaryMuscle)
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${SIZES[size]}`}
      style={{ backgroundColor: color }}
      // The colour is the identity, so the group has to reach a screen reader
      // and anyone who cannot separate these hues.
      aria-label={primaryMuscle ? `${primaryMuscle} exercise` : 'muscle group not set'}
    >
      {initial}
    </span>
  )
}
