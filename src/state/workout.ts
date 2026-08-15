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

/**
 * The numbers in the entry bar, and which set they are aimed at.
 *
 * Out here for the same reason the pager index is, and now for a case that
 * happens routinely rather than once: the exercise view is a PUSHED screen, so
 * opening the summary, the picker or an exercise's detail unmounts it. Held in
 * `useState` a half-typed weight would be gone on the way back. `PROJECT.md`
 * recorded that loss as known and unsolved; this is where it gets solved.
 *
 * **`touched` is what makes restoring safe.** A pristine draft is only ever the
 * prefill chain's own answer, and that answer can go stale while the screen is
 * away - a set logged from somewhere else, an exercise swapped out. So a
 * pristine draft is re-seeded on return and only a hand-edited one survives. It
 * is the difference between remembering what you typed and pinning a value that
 * was never yours.
 */
export interface EntryDraft {
  sessionId: number
  exerciseId: number
  weightKg: number | null
  reps: number | null
  durationS: number | null
  /** The set the bar is correcting, or null when it is entering a new one. */
  editingSetId: number | null
  /** Set once a number has been changed by hand. See above. */
  touched: boolean
}

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

  /** The entry bar's numbers, or null when nothing is being entered. */
  draft: EntryDraft | null
  /** Replace the draft outright. Used by the re-seed from the prefill chain. */
  setDraft: (draft: EntryDraft) => void
  /**
   * Change part of the draft. **Marks it touched**, because every caller is a
   * hand edit: a step button, a scrub, the keypad, or aiming at another set.
   */
  patchDraft: (patch: Partial<Omit<EntryDraft, 'sessionId' | 'exerciseId'>>) => void
  clearDraft: () => void
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

  draft: null,
  setDraft: (draft) => set({ draft }),
  patchDraft: (patch) =>
    set((s) => (s.draft ? { draft: { ...s.draft, ...patch, touched: true } } : s)),
  clearDraft: () => set({ draft: null }),
}))

/** The pager position for `sessionId`, or 0 for any other session. */
export const useExerciseIndex = (sessionId: number): number =>
  useWorkout((s) => (s.sessionId === sessionId ? s.index : 0))

/**
 * The draft, but only if it belongs to this exercise of this session.
 *
 * Same guard as `useExerciseIndex` and for the same reason: a draft left over
 * from another exercise would arrive as a weight that was never entered for the
 * one on screen, which is worse than an empty field. The check lives here so no
 * call site can forget it.
 */
export const useEntryDraft = (
  sessionId: number,
  exerciseId: number | undefined,
): EntryDraft | null =>
  useWorkout((s) =>
    s.draft && s.draft.sessionId === sessionId && s.draft.exerciseId === exerciseId
      ? s.draft
      : null,
  )
