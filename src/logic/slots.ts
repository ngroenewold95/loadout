/**
 * Set slots: the row per set an exercise shows, whether or not it has been
 * performed yet.
 *
 * The reference app opens an exercise with `Set 1` / `Set 2` / `Set 3` already
 * listed and rewrites a row **in place** when it is completed (see
 * `docs/PROGRESSION.md`). loadout used to append a chip per set, which meant an
 * exercise showed nothing at all until the first set landed, and the only way
 * to remove one was `Undo` taking the tail.
 *
 * This is a module of its own, and tested, because `PROJECT.md` records a
 * correction worth not repeating: three helpers were written down as "pure and
 * tested" while having no tests at all, and the first test written for them
 * found a real bug. Slot arithmetic is exactly the shape that goes wrong
 * quietly - off by one, or right until `targetSets` is null.
 */

/**
 * What a slot is doing.
 *
 * - `done`    a set was performed here
 * - `editing` that set is selected, and the entry bar is pointed at it
 * - `active`  empty, and where the next LOG SET will land
 * - `pending` empty, and nothing has claimed it
 */
export type SlotState = 'done' | 'editing' | 'active' | 'pending'

export interface SetSlot<T> {
  /** Position within the exercise, 0-based, matching `sets.set_index`. */
  index: number
  set: T | null
  state: SlotState
  /**
   * Past `targetSets`: a set nobody asked for. Rendered as a dashed outline,
   * following the plate solver's remainder chip.
   *
   * **Deliberately not a member of `SlotState`.** The first draft had `extra`
   * in that enum and the tests caught it immediately: once the target is met,
   * the trailing slot is both where the next set lands AND beyond the target,
   * and whichever value won, the other fact was lost. Two orthogonal questions,
   * two fields. It also lets a *filled* slot say it was an extra set, which the
   * single enum could never express.
   *
   * Always false when `targetSets` is null, since no target was set and so
   * nothing can be beyond it.
   */
  beyondTarget: boolean
}

/** The least a set has to be for slots to place it. */
interface Placeable {
  id: number
  setIndex: number
}

/**
 * Lay out the slots for one exercise.
 *
 * Generic over `{ id, setIndex }` rather than taking `PerformedSet`, so `logic/`
 * keeps its rule of not importing from `db/repo.ts` and the tests need nothing
 * but plain objects.
 *
 * @param done         sets already performed for this exercise, any order
 * @param targetSets   from the template. **Nullable**, and null is not zero.
 * @param editingSetId the set currently loaded into the entry bar, if any
 */
export function setSlots<T extends Placeable>(
  done: readonly T[],
  targetSets: number | null,
  editingSetId: number | null = null,
): SetSlot<T>[] {
  // By `setIndex`, not by array position: `deleteSet` renumbers the survivors
  // after a middle delete, so the caller's order is not authoritative.
  const performed = [...done].sort((a, b) => a.setIndex - b.setIndex)

  // Null and zero are different: null is "no target was set", which nothing can
  // be beyond, while zero is a target of none.
  const target = targetSets == null ? null : Math.max(0, targetSets)

  // The `+ 1` keeps one empty slot on screen at all times, which is where the
  // next LOG SET lands. It is why there is no `Add set` row: LOG SET already is
  // one. Note this uses the COUNT, not the highest index - if the two ever
  // disagree the data has holes in it, and the count is the honest answer.
  const count = Math.max(target ?? 0, performed.length + 1)

  // While a set is being corrected the entry bar belongs to it, so nothing else
  // may claim to be where the next set lands. Exactly one slot owns the bar.
  const editing = editingSetId != null && performed.some((s) => s.id === editingSetId)
  const activeIndex = editing ? -1 : performed.length

  return Array.from({ length: count }, (_, index) => {
    const set = performed[index] ?? null
    return {
      index,
      set,
      state: stateOf(set, index === activeIndex, editingSetId),
      beyondTarget: target != null && index >= target,
    }
  })
}

function stateOf<T extends Placeable>(
  set: T | null,
  isActive: boolean,
  editingSetId: number | null,
): SlotState {
  if (set) return set.id === editingSetId ? 'editing' : 'done'
  return isActive ? 'active' : 'pending'
}
