import { describe, it, expect } from 'vitest'
import { parseCsv, toRecords, parseClock, parseNumber, parseInteger } from './csv'

describe('parseCsv', () => {
  it('strips a UTF-8 BOM from the first header cell', () => {
    const { header } = parseCsv('﻿Date,Time\n2026-01-01,10:00:00\n')
    expect(header[0]).toBe('Date')
  })

  it('keeps newlines inside quoted fields as one row', () => {
    // The real shape: "Machine weight 100\n7x45 per side"
    const csv = 'a,b\n1,"Machine weight 100\n7x45 per side"\n2,plain\n'
    const { rows } = parseCsv(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0][1]).toBe('Machine weight 100\n7x45 per side')
    expect(rows[1][0]).toBe('2')
  })

  it('reports the source line where each row began, not where it ended', () => {
    const csv = 'a,b\n1,"two\nline"\n3,x\n'
    const { rowLines } = parseCsv(csv)
    expect(rowLines).toEqual([2, 4])
  })

  it('handles escaped double quotes', () => {
    const { rows } = parseCsv('a\n"he said ""hi"""\n')
    expect(rows[0][0]).toBe('he said "hi"')
  })

  it('preserves empty fields but drops blank lines', () => {
    const { rows } = parseCsv('a,b,c\n1,,3\n\n4,5,6\n')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual(['1', '', '3'])
  })

  it('handles a final row with no trailing newline', () => {
    const { rows } = parseCsv('a,b\n1,2')
    expect(rows).toEqual([['1', '2']])
  })

  it('tolerates CRLF', () => {
    const { header, rows } = parseCsv('a,b\r\n1,2\r\n')
    expect(header).toEqual(['a', 'b'])
    expect(rows).toEqual([['1', '2']])
  })
})

describe('toRecords', () => {
  it('throws with the source line when field count drifts', () => {
    const parsed = parseCsv('a,b\n1,2\n3\n')
    expect(() => toRecords(parsed)).toThrow(/line 3: expected 2 fields, got 1/)
  })
})

describe('parseClock', () => {
  it('accepts timestamps with and without milliseconds', () => {
    // Both forms are present in the export.
    expect(parseClock('07:33:32.395')).toBeCloseTo(27212.395, 3)
    expect(parseClock('17:53:49')).toBe(64429)
  })

  it('pads short millisecond fractions', () => {
    expect(parseClock('00:00:00.5')).toBe(0.5)
  })

  it('rejects malformed values rather than guessing', () => {
    expect(parseClock('')).toBeNull()
    expect(parseClock('7:33')).toBeNull()
  })
})

describe('numeric parsing', () => {
  it('treats blank as absent, not zero', () => {
    // 274 rows have a blank Weight; storing 0 would invent a lift.
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('   ')).toBeNull()
    expect(parseNumber('0')).toBe(0)
  })

  it('parses the export decimal form', () => {
    expect(parseNumber('130.00')).toBe(130)
    expect(parseNumber('37.25')).toBe(37.25)
  })

  it('accepts whole reps written as decimals', () => {
    // Repetitions are exported as "8.00".
    expect(parseInteger('8.00')).toBe(8)
  })

  it('refuses fractional values for integer columns', () => {
    expect(parseInteger('8.5')).toBeNull()
  })
})
