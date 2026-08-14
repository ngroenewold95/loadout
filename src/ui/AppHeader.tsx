/**
 * The app bar.
 *
 * Its left slot is the whole point: a back arrow when there is something to go
 * back to, the wordmark when there is not. The arrow and the system back
 * gesture run through the same `back()`, so the two can never disagree about
 * where "back" is.
 *
 * Stage 10 puts the rest-timer pill in the right slot, which is why that slot
 * takes arbitrary children rather than a fixed action.
 */
import type { ReactNode } from 'react'
import { useNav } from '../state/nav.ts'

interface Props {
  /** Shown once a screen is pushed. At the root the wordmark stands in. */
  title?: string
  right?: ReactNode
}

export function AppHeader({ title, right }: Props) {
  const canGoBack = useNav((s) => s.stack.length > 0)
  const back = useNav((s) => s.back)

  return (
    <header className="flex shrink-0 items-center justify-between gap-3 px-3 pt-4 pb-2">
      <div className="flex min-w-0 items-center gap-1">
        {canGoBack ? (
          <>
            {/* Padded out to the full tap target and pulled back optically, so
                the arrow lines up with the content below it without being a
                24 px target for a chalky thumb. */}
            <button
              aria-label="Back"
              className="active:bg-surface-3 -m-1 flex size-tap items-center justify-center rounded-full"
              onClick={() => back()}
            >
              <BackArrow />
            </button>
            <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          </>
        ) : (
          <h1 className="px-2 text-2xl font-semibold tracking-tight">loadout</h1>
        )}
      </div>

      {right && <div className="flex shrink-0 items-center gap-3 px-2">{right}</div>}
    </header>
  )
}

function BackArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </svg>
  )
}
