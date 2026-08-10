import { describe, it, expect } from 'vitest'
import { MUSCLES, MUSCLE_COLORS, muscleBadge } from './muscles.ts'

describe('muscleBadge', () => {
  it('degrades to a neutral circle for the unpopulated column', () => {
    // primary_muscle is null for all 86 imported rows today.
    expect(muscleBadge(null)).toEqual({ initial: '?', color: '#424655' })
    expect(muscleBadge(undefined)).toEqual({ initial: '?', color: '#424655' })
    expect(muscleBadge('')).toEqual({ initial: '?', color: '#424655' })
  })

  it('degrades rather than throwing on a value outside the list', () => {
    expect(muscleBadge('forearms').initial).toBe('?')
  })

  it('tolerates casing and stray whitespace, since the column is free text', () => {
    expect(muscleBadge('  Back ')).toEqual(muscleBadge('back'))
  })

  it('gives chest and calves the same initial but different colours', () => {
    // The shared initial is deliberate; the colour is what disambiguates.
    expect(muscleBadge('chest').initial).toBe('C')
    expect(muscleBadge('calves').initial).toBe('C')
    expect(muscleBadge('chest').color).not.toBe(muscleBadge('calves').color)
  })

  it('covers every group with a distinct colour', () => {
    const colors = MUSCLES.map((m) => MUSCLE_COLORS[m])
    expect(new Set(colors).size).toBe(MUSCLES.length)
    expect(colors.every((c) => /^#[0-9A-F]{6}$/i.test(c))).toBe(true)
  })
})
