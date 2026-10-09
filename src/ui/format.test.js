import { expect, test } from 'vitest'
import { formatDelta } from './format.js'

test.each([
  [7118, '+7s'],
  [-2106, '−2s'],
  [29750, '+30s'],
  [22, '0s'],
  [-400, '0s'],
])('a duration difference of %ims reads %s', (ms, expected) => {
  expect(formatDelta(ms)).toBe(expected)
})
