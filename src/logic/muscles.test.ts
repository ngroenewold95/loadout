import { describe, it, expect } from 'vitest'
import { MUSCLES, MUSCLE_COLORS, UNKNOWN_COLOR, muscleMark } from './muscles.ts'

describe('muscleMark', () => {
  it('degrades to no group for an empty column', () => {
    // Four of the 87 are deliberately unclassified, and the column was null for
    // every row before `seedExerciseMuscles` first ran.
    for (const empty of [null, undefined, '']) {
      expect(muscleMark(empty)).toEqual({ muscle: null, color: UNKNOWN_COLOR })
    }
  })

  it('degrades rather than throwing on a value outside the list', () => {
    // `Suitcase Carry` is FOREARMS in the reference app's own table, which is
    // not one of our eight. A row like that must render, not crash.
    expect(muscleMark('forearms').muscle).toBeNull()
  })

  it('tolerates casing and stray whitespace, since the column is free text', () => {
    expect(muscleMark('  Back ')).toEqual(muscleMark('back'))
  })

  it('names the group rather than compressing it to a letter', () => {
    // The whole reason the lettered circle was dropped: Chest and Calves are
    // both `C`, Back and Biceps both `B`, so the letter said nothing and two
    // similar reds had to carry the identity by themselves.
    expect(muscleMark('chest').muscle).toBe('chest')
    expect(muscleMark('calves').muscle).toBe('calves')
  })

  it('covers every group with a distinct colour', () => {
    const colors = MUSCLES.map((m) => MUSCLE_COLORS[m])
    expect(new Set(colors).size).toBe(MUSCLES.length)
    expect(colors.every((c) => /^#[0-9A-F]{6}$/i.test(c))).toBe(true)
  })

  it('never gives a real group the unknown colour', () => {
    // Otherwise a classified exercise would be indistinguishable from one the
    // table says nothing about, which is the one thing the rail must not do.
    expect(MUSCLES.some((m) => MUSCLE_COLORS[m] === UNKNOWN_COLOR)).toBe(false)
  })
})
