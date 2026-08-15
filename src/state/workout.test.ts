/**
 * The rules the entry draft exists to enforce.
 *
 * The pager index already had its rule proved on device rather than in a test -
 * `PROJECT.md` records returning from the summary landing on exercise 1 of 10.
 * The draft's rule is finer than that and would fail silently: a draft restored
 * for the wrong exercise is a plausible weight in the right-looking field, and
 * a draft overwritten on the way back is a number you typed and then lost. Both
 * are cheap to state here and expensive to notice on a phone.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkout, type EntryDraft } from './workout.ts'

const draftFor = (overrides: Partial<EntryDraft> = {}): EntryDraft => ({
  sessionId: 1,
  exerciseId: 10,
  weightKg: 100,
  reps: 8,
  durationS: null,
  editingSetId: null,
  touched: false,
  ...overrides,
})

beforeEach(() => {
  useWorkout.setState({ sessionId: null, index: 0, draft: null })
})

describe('pager index', () => {
  it('is scoped to the session it was set for', () => {
    useWorkout.getState().setIndex(1, 4)
    expect(useWorkout.getState().index).toBe(4)
    // Another session must not inherit it - it would open a different template
    // at whatever page this one ended on.
    expect(useWorkout.getState().sessionId).toBe(1)
  })
})

describe('entry draft', () => {
  it('marks itself touched on any patch', () => {
    useWorkout.getState().setDraft(draftFor())
    expect(useWorkout.getState().draft?.touched).toBe(false)

    useWorkout.getState().patchDraft({ weightKg: 105 })
    const draft = useWorkout.getState().draft
    expect(draft?.weightKg).toBe(105)
    // This is what makes the draft survive a screen push. Every caller of
    // patchDraft is a hand edit, so there is no path that changes a number
    // without also claiming it.
    expect(draft?.touched).toBe(true)
  })

  it('keeps the fields it was not given', () => {
    useWorkout.getState().setDraft(draftFor())
    useWorkout.getState().patchDraft({ reps: 6 })
    const draft = useWorkout.getState().draft
    expect(draft?.weightKg).toBe(100)
    expect(draft?.exerciseId).toBe(10)
  })

  it('ignores a patch when there is no draft', () => {
    useWorkout.getState().patchDraft({ weightKg: 105 })
    // Not an empty draft with a weight in it: a patch with no session or
    // exercise attached could only ever be restored against the wrong one.
    expect(useWorkout.getState().draft).toBeNull()
  })

  it('is cleared outright rather than blanked', () => {
    useWorkout.getState().setDraft(draftFor({ touched: true }))
    useWorkout.getState().clearDraft()
    // Null is what re-seeds from the prefill chain. A draft of nulls would
    // read as "the user typed nothing", which is a different thing and would
    // leave LOG SET disabled forever.
    expect(useWorkout.getState().draft).toBeNull()
  })
})
