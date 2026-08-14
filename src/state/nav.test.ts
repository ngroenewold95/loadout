/**
 * The store, not the hook. `useNav.getState()` is the same object React reads,
 * so this covers the real thing without a DOM.
 *
 * The case that earns its place is `back()` at the root returning false: that
 * boolean is the only thing standing between the Android back button and
 * either exiting the app when it should not, or trapping the user in it.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useNav, type Screen } from './nav.ts'

const spikes: Screen = { kind: 'spikes' }

const nav = () => useNav.getState()

beforeEach(() => {
  useNav.setState({ stack: [] })
})

describe('nav stack', () => {
  it('starts at the root, with the root NOT on the stack', () => {
    expect(nav().stack).toEqual([])
  })

  it('pushes and pops', () => {
    nav().push(spikes)
    expect(nav().stack).toEqual([spikes])
    expect(nav().back()).toBe(true)
    expect(nav().stack).toEqual([])
  })

  it('reports false when there is nothing to pop', () => {
    // This is what tells the caller to leave the app rather than swallow the
    // gesture. A void back() could not.
    expect(nav().back()).toBe(false)
    expect(nav().stack).toEqual([])
  })

  it('replaces the top without deepening the stack', () => {
    nav().push(spikes)
    nav().push(spikes)
    nav().replace(spikes)
    expect(nav().stack).toHaveLength(2)
  })

  it('replace at the root is a no-op rather than an insert', () => {
    nav().replace(spikes)
    expect(nav().stack).toEqual([])
  })

  it('resets to the root from any depth', () => {
    nav().push(spikes)
    nav().push(spikes)
    nav().reset()
    expect(nav().stack).toEqual([])
    expect(nav().back()).toBe(false)
  })

  it('never mutates the previous stack, so subscribers see a new reference', () => {
    nav().push(spikes)
    const before = nav().stack
    nav().push(spikes)
    expect(nav().stack).not.toBe(before)
    expect(before).toHaveLength(1)
  })
})
