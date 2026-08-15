/**
 * A menu that floats over the screen instead of growing inside it.
 *
 * The first version of the overview's exercise menu expanded the card in place.
 * On the phone that was wrong twice over: every card below it jumped down as it
 * opened, and on the LAST card the menu appeared below the fold, so choosing
 * `Remove` meant scrolling first. A menu that moves the thing you are aiming at
 * is the same fault the docked entry bar exists to prevent, one screen along.
 *
 * So it is an overlay. It costs the list no height, it is identical for the
 * first card and the last, and nothing under it moves.
 *
 * **A bottom sheet rather than a popover anchored to the row.** Anchoring needs
 * the row's position, a flip when it is near an edge, and a re-measure when the
 * list scrolls - three chances to be subtly wrong for no gain on a screen this
 * width. A sheet is also where a thumb already is.
 *
 * `PROJECT.md` twice records turning down a dialog primitive as "a component
 * built to be used once". This is the third call site and the template editor
 * is a fourth, so it now earns its place - but it is still a MENU, not a
 * confirm: destructive choices confirm in place with a second tap, exactly as
 * `Discard workout` does, so nothing here can be dismissed by accident.
 */
import { useEffect } from 'react'
import { useNav } from '../state/nav.ts'

interface Props {
  /** Names what the menu acts on, so a stray open is obvious. */
  title: string
  onClose: () => void
  children: React.ReactNode
}

export function ActionSheet({ title, onClose, children }: Props) {
  const setDismiss = useNav((s) => s.setDismiss)

  /**
   * Hand the back gesture a way to close this first.
   *
   * Without it, back would pop the screen underneath and leave the workout,
   * which is a long way to travel for a menu you opened by mistake. Cleared on
   * unmount so a closed sheet cannot go on swallowing the gesture.
   */
  useEffect(() => {
    setDismiss(onClose)
    return () => setDismiss(null)
  }, [setDismiss, onClose])

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Tapping outside closes, which is the cheapest exit and the one a
          thumb finds without looking. */}
      <button
        aria-label="Close menu"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-surface-1 pb-safe-b relative rounded-t-2xl"
      >
        <p className="text-text-dim truncate px-5 pt-4 pb-2 text-xs tracking-wide uppercase">
          {title}
        </p>
        <div className="flex flex-col pb-2">{children}</div>
      </div>
    </div>
  )
}

/**
 * One row of the sheet.
 *
 * Full width and full tap height, because a menu is a list of targets and a
 * cramped one is the reason the badge strip had to go.
 */
export function ActionItem({
  label,
  danger = false,
  disabled = false,
  onClick,
}: {
  label: string
  /** Red, and by convention the caller makes it confirm before it acts. */
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`active:bg-surface-3 px-5 py-4 text-left text-base disabled:opacity-30 ${
        danger ? 'text-danger' : 'text-text'
      }`}
    >
      {label}
    </button>
  )
}
