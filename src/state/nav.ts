/**
 * The navigation stack.
 *
 * Until now there was no navigation at all: the shell picked Home or
 * ActiveSession from a query result, and the only other screen (the debug
 * spikes) was a boolean. Everything queued behind this stage - the summary
 * screen, the exercise picker, the library, the template editor - is a screen
 * you push and expect to come back from.
 *
 * Three properties this shape buys, all of which the alternative (a `screen`
 * enum plus a pile of `useState`) does not:
 *
 * - **The root is not on the stack.** An empty stack means "wherever the app
 *   would start", which is Home or the active workout depending on the
 *   database, not a screen anyone navigated to. Keeping it off the stack means
 *   resuming into a workout on cold start cannot leave a phantom entry behind
 *   the back arrow.
 * - **`back()` reports whether it did anything.** That is exactly the question
 *   the Android back button has to answer, since the alternative to popping is
 *   leaving the app, and only the caller can decide that.
 * - **It lives outside React.** The back listener is registered once against
 *   the plugin and reads `getState()`, so it never goes stale and never needs
 *   re-registering when a component re-renders.
 *
 * A router was the obvious alternative and is not worth it here. There are no
 * URLs, no deep links and no server; `zustand` was already a dependency and,
 * until now, unused.
 */
import { useEffect } from 'react'
import { App } from '@capacitor/app'
import { create } from 'zustand'

/**
 * Everything that can sit on the stack.
 *
 * Deliberately only what exists today. Later stages add their own members
 * rather than this union being written out in advance, so an unhandled screen
 * is a type error at the point that renders it.
 */
export type Screen =
  | { kind: 'spikes' }
  /** What a workout added up to. **Not a save** - see `SessionSummary.tsx`. */
  | { kind: 'summary'; sessionId: number }
  /**
   * Choose an exercise for a live workout. With `replacing` set it swaps that
   * exercise in place, keeping its sets, reps and rest; without, it appends.
   */
  | { kind: 'picker'; sessionId: number; replacing?: number }
  /**
   * A template, read-only, before any session exists.
   *
   * Home used to start a workout the instant a template was tapped, so there
   * was no way to look at what was coming without committing to it. Read-only
   * because there is nothing to write: `session_exercises` is a snapshot
   * `startSession` takes, so editing before the start would have no home.
   */
  | { kind: 'template'; templateId: number }
  /**
   * Log one exercise of a live workout. `index` is only where to open - the
   * pager moves from there, and `state/workout.ts` owns the position.
   */
  | { kind: 'exercise'; sessionId: number; index: number }
  /** Every finished workout, newest first. Rows open the summary. */
  | { kind: 'history' }

interface NavState {
  /** Root first. Empty means the root screen, which is not a member. */
  stack: Screen[]
  /**
   * How to close whatever overlay is open, or null when none is.
   *
   * An action sheet is not a screen - it does not belong on the stack, and
   * pushing one would put a back arrow in the app bar for something a tap
   * outside dismisses. But back must still close it before popping the screen
   * underneath, or the first back gesture after opening a menu would leave the
   * workout entirely. So `back()` asks here first.
   */
  dismiss: (() => void) | null
  setDismiss: (fn: (() => void) | null) => void
  push: (screen: Screen) => void
  /**
   * Swap the top screen without deepening the stack. **No-op at the root**,
   * which is not a screen and so cannot be replaced.
   */
  replace: (screen: Screen) => void
  /** Pop one screen. **False means there was nothing to pop.** */
  back: () => boolean
  /** Straight back to the root, however deep the stack is. */
  reset: () => void
}

export const useNav = create<NavState>((set, get) => ({
  stack: [],
  dismiss: null,
  setDismiss: (fn) => set({ dismiss: fn }),
  push: (screen) => set((s) => ({ stack: [...s.stack, screen] })),
  // The length guard is load-bearing: `[...[].slice(0, -1), screen]` is
  // `[screen]`, so without it a replace at the root would PUSH instead, giving
  // the root screen a back arrow with nothing behind it.
  replace: (screen) =>
    set((s) => (s.stack.length === 0 ? s : { stack: [...s.stack.slice(0, -1), screen] })),
  back: () => {
    // An overlay closes first, and counts as having handled the gesture even at
    // the root - which is exactly the case that matters, since the workout
    // overview IS the root and a menu open over it must not exit the app.
    const dismiss = get().dismiss
    if (dismiss) {
      set({ dismiss: null })
      dismiss()
      return true
    }
    if (get().stack.length === 0) return false
    set((s) => ({ stack: s.stack.slice(0, -1) }))
    return true
  },
  reset: () => set({ stack: [], dismiss: null }),
}))

/** The screen on top, or null at the root. Referentially stable per stack. */
export const useCurrentScreen = (): Screen | null =>
  useNav((s) => s.stack.at(-1) ?? null)

/**
 * Route the Android back button, and with it the system back gesture.
 *
 * On Android 10+ the edge swipe and the old three-button back deliver the same
 * event, so there is nothing gesture-specific to handle. Registering any
 * `backButton` listener **replaces** Capacitor's default handling rather than
 * running alongside it, so leaving the app is now ours to do explicitly.
 *
 * Call once, from the shell.
 */
export function useSystemBack(): void {
  useEffect(() => {
    // `addListener` is async, and React 19 StrictMode runs this effect twice in
    // development. Without the flag the second cleanup can run before the first
    // handle resolves, leaving a listener registered against an unmounted tree.
    let cancelled = false
    let remove: (() => void) | undefined

    void App.addListener('backButton', () => {
      // Reading through getState rather than closing over the stack: this
      // listener outlives any single render and a captured value would be the
      // stack as it was when the app started.
      if (!useNav.getState().back()) void App.exitApp()
    }).then((handle) => {
      if (cancelled) void handle.remove()
      else remove = () => void handle.remove()
    })

    return () => {
      cancelled = true
      remove?.()
    }
  }, [])
}
