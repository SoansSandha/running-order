import { describe, expect, test } from 'vitest'
import { parseCsv } from './parse.js'

describe('parseCsv', () => {
  test('reads a plain comma-separated file into rows', () => {
    expect(parseCsv('a,b\n1,2').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  test('keeps commas that live inside quoted fields', () => {
    expect(parseCsv('title,artist\n"Hello, Goodbye",The Beatles').rows[1])
      .toEqual(['Hello, Goodbye', 'The Beatles'])
  })

  test('handles escaped quotes inside a quoted field', () => {
    expect(parseCsv('title\n"She said ""yes"""').rows[1]).toEqual(['She said "yes"'])
  })

  test('reads Windows line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  test('strips a UTF-8 byte order mark, which Excel loves to add', () => {
    // Left in place, the BOM corrupts the first header and column detection
    // silently fails on an otherwise valid file.
    expect(parseCsv('﻿Track Name,Artist\nSong,Band').rows[0])
      .toEqual(['Track Name', 'Artist'])
  })

  test('skips blank lines rather than emitting empty rows', () => {
    expect(parseCsv('a\n\nb\n').rows).toEqual([['a'], ['b']])
  })

  test('accepts semicolon-delimited files, common from European exports', () => {
    expect(parseCsv('title;artist\nSong;Band').rows[1]).toEqual(['Song', 'Band'])
  })

  test('trims surrounding whitespace from every field', () => {
    expect(parseCsv('a, b ,c').rows[0]).toEqual(['a', 'b', 'c'])
  })

  test('reports an empty file rather than throwing', () => {
    expect(parseCsv('').rows).toEqual([])
  })

  test('pads short rows so column indexing never reads undefined', () => {
    const { rows } = parseCsv('a,b,c\n1,2')
    expect(rows[1]).toEqual(['1', '2', ''])
  })
})
