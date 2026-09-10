import { describe, expect, test } from 'vitest'
import { padReleaseDate, sortKey } from './normalize.js'

describe('sortKey', () => {
  test('lowercases so casing does not split otherwise-equal keys', () => {
    expect(sortKey('Radiohead')).toBe(sortKey('RADIOHEAD'))
  })

  test('strips diacritics so Beyoncé and Beyonce collapse together', () => {
    expect(sortKey('Beyoncé')).toBe('beyonce')
  })

  test('drops a leading definite article so The Beatles files under B', () => {
    expect(sortKey('The Beatles')).toBe('beatles')
  })

  test('keeps "the" when it is not a leading article', () => {
    expect(sortKey('The The')).toBe('the')
    expect(sortKey('Theory of a Deadman')).toBe('theory of a deadman')
  })

  test('collapses runs of whitespace and trims', () => {
    expect(sortKey('  Arctic   Monkeys ')).toBe('arctic monkeys')
  })

  test('returns empty string for nullish input rather than throwing', () => {
    expect(sortKey(null)).toBe('')
    expect(sortKey(undefined)).toBe('')
  })
})

describe('padReleaseDate', () => {
  test('pads a year-only date to a comparable full date', () => {
    expect(padReleaseDate('1972', 'year')).toBe('1972-01-01')
  })

  test('pads a year-month date to a comparable full date', () => {
    expect(padReleaseDate('1972-03', 'month')).toBe('1972-03-01')
  })

  test('leaves a full date untouched', () => {
    expect(padReleaseDate('1972-03-24', 'day')).toBe('1972-03-24')
  })

  test('sorts correctly as plain strings across mixed precision', () => {
    const dates = [
      padReleaseDate('1972-03-24', 'day'),
      padReleaseDate('1969', 'year'),
      padReleaseDate('1972-01', 'month'),
    ].sort()
    expect(dates).toEqual(['1969-01-01', '1972-01-01', '1972-03-24'])
  })

  test('returns empty string for a missing date so it sorts last, not as NaN', () => {
    expect(padReleaseDate(null, null)).toBe('')
  })

  test('infers precision from the string when precision is not supplied', () => {
    expect(padReleaseDate('1985')).toBe('1985-01-01')
    expect(padReleaseDate('1985-06')).toBe('1985-06-01')
  })
})
