import { expect, test } from 'vitest'
import { formatDelta, openHref } from './format.js'

test.each([
  [7118, '+7s'],
  [-2106, '−2s'],
  [29750, '+30s'],
  [22, '0s'],
  [-400, '0s'],
])('a duration difference of %ims reads %s', (ms, expected) => {
  expect(formatDelta(ms)).toBe(expected)
})

test.each([
  [{ id: '7fnd0BMPbWuMsn6lBrshZL', source: 'spotify' }, 'https://open.spotify.com/track/7fnd0BMPbWuMsn6lBrshZL'],
  [{ id: 'q7e348rz27I', source: 'youtube' }, 'https://music.youtube.com/watch?v=q7e348rz27I'],
  [{ id: null, source: 'spotify', isLocal: true }, null],
])('%o opens at %s', (track, expected) => {
  expect(openHref(track)).toBe(expected)
})
