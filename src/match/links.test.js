import { describe, expect, test } from 'vitest'
import { parseTrackLink } from './links.js'

// Real ids: Taal Se Taal (Remix) on Spotify, and AJA's official video on YouTube.
const SPOTIFY = { service: 'spotify', id: '7fnd0BMPbWuMsn6lBrshZL' }
const YOUTUBE = { service: 'youtube', id: 'q7e348rz27I' }

describe('parseTrackLink', () => {
  test.each([
    ['https://open.spotify.com/track/7fnd0BMPbWuMsn6lBrshZL', SPOTIFY],
    ['https://open.spotify.com/track/7fnd0BMPbWuMsn6lBrshZL?si=4f1c2d3e4b5a6978', SPOTIFY],
    ['https://open.spotify.com/intl-de/track/7fnd0BMPbWuMsn6lBrshZL', SPOTIFY],
    ['open.spotify.com/track/7fnd0BMPbWuMsn6lBrshZL', SPOTIFY],
    ['spotify:track:7fnd0BMPbWuMsn6lBrshZL', SPOTIFY],
    ['  https://open.spotify.com/track/7fnd0BMPbWuMsn6lBrshZL  ', SPOTIFY],
    ['https://music.youtube.com/watch?v=q7e348rz27I', YOUTUBE],
    ['https://music.youtube.com/watch?v=q7e348rz27I&list=RDAMVMq7e348rz27I', YOUTUBE],
    ['https://www.youtube.com/watch?v=q7e348rz27I&t=42s', YOUTUBE],
    ['https://m.youtube.com/watch?v=q7e348rz27I', YOUTUBE],
    ['https://youtu.be/q7e348rz27I?si=AbCdEf', YOUTUBE],
  ])('%s is one song', (text, expected) => {
    expect(parseTrackLink(text)).toEqual(expected)
  })

  test.each([
    ['an album', 'https://open.spotify.com/album/1ATL5GLyefJaxhQzSPVrLX'],
    ['a playlist', 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'],
    ['a YouTube playlist', 'https://music.youtube.com/playlist?list=PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i'],
    ['a watch page with no video', 'https://www.youtube.com/watch?list=PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i'],
    ['a search page', 'https://music.youtube.com/search?q=sheesha'],
    ['a short Spotify id', 'https://open.spotify.com/track/7fnd0BMP'],
    ['a short video id', 'https://youtu.be/q7e348'],
    ['another site', 'https://example.com/watch?v=q7e348rz27I'],
    ['plain text', 'Sheesha Karan Aujla'],
    ['nothing', ''],
  ])('%s is not one song', (_, text) => {
    expect(parseTrackLink(text)).toBeNull()
  })
})
