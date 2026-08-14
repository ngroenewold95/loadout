/**
 * In-workout UI state that has to outlive the screen showing it.
 *
 * `nav.ts` records that **a pushed screen unmounts the one below it**, and flags
 * the first push from inside a live workout as where that has to be
 * reconsidered. That push now exists, and the consequence was measured on device
 * rather than predicted: opening the summary and tapping `Back to workout`
 * returned to exercise **1 of 10** instead of the exercise being performed,
 * because the pager index was `useState` inside `ActiveSession`.
 *
 * So the index lives out here, next to the stack it has to survive. Same shape
 * and same reasoning as `nav.ts`: outside React, one workout at a time.
 *
 * **Scoped to a session id, not global.** A stale index left over from
 * yesterday's workout would open a different template at whatever page that one
 * ended on, which is worse than starting at the first exercise. `indexFor`
 * answers 0 for any session it does not recognise, so the guard cannot be
 * forgotten at a call site.
 */
import { create } from 'zustand'

interface WorkoutState {
  /** Which session `index` belongs to. Null before any workout is opened. */
  sessionId: number | null
  index: number
  /** Move the pager, recording which session the position belongs to. */
  setIndex: (sessionId: number, index: number) => void

  /**
   * Absolute instant the current rest ends, or null when nothing is resting.
   *
   * Here rather than in `ActiveSession` because the pill that renders it lives
   * in `AppHeader`, which the shell renders ABOVE the logging screen. Absolute
   * rather than a remaining duration, for the reason the native side already
   * works this way: the bubble, the notification and this all draw from the same
   * instant, so they cannot disagree, and none of them needs the app to have
   * been awake.
   */
  restEndsAt: number | null
  /** The rest's full length, for the draining fill. */
  restTotalMs: number
  startRest: (endsAt: number, totalMs: number) => void
  extendRest: (ms: number) => void
  clearRest: () => void
}

export const useWorkout = create<WorkoutState>((set) => ({
  sessionId: null,
  index: 0,
  setIndex: (sessionId, index) => set({ sessionId, index }),

  restEndsAt: null,
  restTotalMs: 0,
  startRest: (endsAt, totalMs) => set({ restEndsAt: endsAt, restTotalMs: totalMs }),
  extendRest: (ms) =>
    set((s) =>
      s.restEndsAt == null
        ? s
        : { restEndsAt: s.restEndsAt + ms, restTotalMs: s.restTotalMs + ms },
    ),
  clearRest: () => set({ restEndsAt: null, restTotalMs: 0 }),
}))

/** The pager position for `sessionId`, or 0 for any other session. */
export const useExerciseIndex = (sessionId: number): number =>
  useWorkout((s) => (s.sessionId === sessionId ? s.index : 0))
