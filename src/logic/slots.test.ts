import { describe, expect, it } from 'vitest'
import { setSlots, type SetSlot } from './slots.ts'

/** Sets, reduced to what slots actually place. */
const sets = (...indices: number[]) =>
  indices.map((setIndex) => ({ id: 100 + setIndex, setIndex }))

const states = (slots: SetSlot<unknown>[]) => slots.map((s) => s.state)
const beyond = (slots: SetSlot<unknown>[]) => slots.map((s) => s.beyondTarget)

describe('setSlots', () => {
  it('lists the whole target before anything is performed', () => {
    // The point of the stage: an exercise used to show nothing at all until the
    // first set landed.
    expect(states(setSlots([], 3, null))).toEqual(['active', 'pending', 'pending'])
  })

  it('fills a slot in place rather than appending', () => {
    const slots = setSlots(sets(0), 2, null)
    expect(states(slots)).toEqual(['done', 'active'])
    expect(slots[0].set?.id).toBe(100)
    expect(slots[1].set).toBeNull()
  })

  it('always keeps one empty slot, so LOG SET has somewhere to land', () => {
    // There is no `Add set` row. This is what stands in for one.
    expect(states(setSlots(sets(0, 1), 2, null))).toEqual(['done', 'done', 'active'])
  })

  it('lets the trailing slot be active AND beyond the target at once', () => {
    // The two are orthogonal, which is why `beyondTarget` is its own field.
    // Folding it into the state enum lost one fact or the other.
    const slots = setSlots(sets(0, 1), 2, null)
    expect(states(slots)).toEqual(['done', 'done', 'active'])
    expect(beyond(slots)).toEqual([false, false, true])
  })

  it('marks a filled slot as beyond the target too', () => {
    // Three sets performed against a target of two: the third was an extra, and
    // it stays an extra after it is filled.
    const slots = setSlots(sets(0, 1, 2), 2, null)
    expect(states(slots)).toEqual(['done', 'done', 'done', 'active'])
    expect(beyond(slots)).toEqual([false, false, true, true])
  })

  it('treats a null targetSets as unset, NOT as zero', () => {
    // `template_exercises.target_sets` is nullable. Zero slots would mean an
    // exercise with no target could never be logged at all.
    expect(states(setSlots([], null, null))).toEqual(['active'])
    expect(states(setSlots(sets(0), null, null))).toEqual(['done', 'active'])
  })

  it('marks nothing as beyond target when there is no target', () => {
    // Nothing can be beyond a target that was never set, and dashing every slot
    // would be noise.
    expect(beyond(setSlots(sets(0, 1), null, null))).toEqual([false, false, false])
  })

  it('has NO active slot while a set is being edited', () => {
    // Two slots claiming the entry bar is the ambiguity this rules out.
    const slots = setSlots(sets(0, 1), 2, 100)
    expect(states(slots)).toEqual(['editing', 'done', 'pending'])
    expect(states(slots)).not.toContain('active')
  })

  it('ignores an editingSetId that is not among the performed sets', () => {
    // A stale edit target from another exercise must not swallow the active
    // slot and leave nowhere for the next set to go.
    expect(states(setSlots(sets(0), 2, 999))).toEqual(['done', 'active'])
  })

  it('orders by setIndex, not by the order the caller passed', () => {
    // `deleteSet` renumbers the survivors, so the caller's order is not
    // authoritative.
    const slots = setSlots(sets(1, 0), 2, null)
    expect(slots.map((s) => s.set?.id)).toEqual([100, 101, undefined])
  })

  it('survives a zero or negative target without producing nothing', () => {
    expect(states(setSlots([], 0, null))).toEqual(['active'])
    expect(states(setSlots([], -3, null))).toEqual(['active'])
  })

  it('numbers every slot by its position', () => {
    expect(setSlots(sets(0), 3, null).map((s) => s.index)).toEqual([0, 1, 2])
  })
})
