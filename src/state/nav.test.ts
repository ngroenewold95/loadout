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
  useNav.setState({ stack: [], dismiss: null })
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

  it('pushes Home over a live workout and pops back to it', () => {
    // While a session is live the ROOT is the workout overview, so Home is a
    // pushed screen rather than the thing underneath. What matters is that one
    // back returns to the workout rather than leaving the app: the root is not
    // on the stack, so a stack of one is exactly "Home over the workout".
    nav().push({ kind: 'home' })
    nav().push({ kind: 'settings' })
    expect(nav().stack).toEqual([{ kind: 'home' }, { kind: 'settings' }])
    expect(nav().back()).toBe(true)
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

describe('an overlay takes back before the stack does', () => {
  it('closes the overlay and leaves the stack alone', () => {
    nav().push(spikes)
    let closed = false
    nav().setDismiss(() => {
      closed = true
    })

    expect(nav().back()).toBe(true)
    expect(closed).toBe(true)
    // The screen under the menu is still there. Closing a menu is not leaving
    // the screen it was opened from.
    expect(nav().stack).toEqual([spikes])
    expect(nav().dismiss).toBeNull()
  })

  it('handles back AT THE ROOT, so a menu cannot exit the app', () => {
    // The case this exists for: the workout overview IS the root, so without
    // this `back()` would report false and the listener would call exitApp -
    // losing the workout screen to a menu opened by mistake.
    nav().setDismiss(() => {})
    expect(nav().back()).toBe(true)
  })

  it('stops swallowing the gesture once the overlay is gone', () => {
    nav().setDismiss(() => {})
    nav().back()
    expect(nav().back()).toBe(false)
  })

  it('is cleared by reset, so a stale closer cannot outlive its screen', () => {
    nav().push(spikes)
    nav().setDismiss(() => {})
    nav().reset()
    expect(nav().dismiss).toBeNull()
    expect(nav().back()).toBe(false)
  })
})
