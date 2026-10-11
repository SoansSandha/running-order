import { describe, expect, test, vi } from 'vitest'
import { lookupLink, searchCatalogue } from './trackLookups.js'

// Shapes verbatim from ytmusicapi on 2026-10-08/10: a search result, and a
// watch-playlist track (a pasted link), which gives its length only as text.
const result = (videoId, title, seconds, videoType = 'MUSIC_VIDEO_TYPE_ATV') => ({
  videoId,
  title,
  artists: [{ name: 'Karan Aujla', id: null }],
  album: null,
  duration_seconds: seconds,
  videoType,
})
const AJA_WATCHED = {
  videoId: 'q7e348rz27I',
  title: 'AJA - Kaléra (Feat. Jaski)',
  artists: [{ name: 'Kaléra', id: 'UCuQZ7xv7in6zanA6QaZ0MGg' }],
  album: null,
  length: '2:16',
  videoType: 'MUSIC_VIDEO_TYPE_OMV',
}
const spotifyTrack = (id, name, durationMs) => ({
  id,
  uri: `spotify:track:${id}`,
  type: 'track',
  name,
  duration_ms: durationMs,
  artists: [{ id: 'a', name: 'Karan Aujla' }],
  album: { id: 'al', name: name, release_date: '2022-06-17', release_date_precision: 'day' },
})

describe('searchCatalogue', () => {
  test('on YouTube Music, runs songs and videos and lists each video once', async () => {
    const youtube = {
      search: vi.fn(async (_, filter) =>
        filter === 'songs'
          ? [result('s1', 'Sheesha', 161), result('v1', 'Sheesha (Official Video)', 176, 'MUSIC_VIDEO_TYPE_OMV')]
          : [result('v1', 'Sheesha (Official Video)', 176, 'MUSIC_VIDEO_TYPE_OMV'), result('v2', 'Sheesha Lyrics', 162, 'MUSIC_VIDEO_TYPE_UGC')],
      ),
    }
    const found = await searchCatalogue('sheesha Karan Aujla', 'youtube', { youtube })
    expect(found.map((track) => track.id)).toEqual(['s1', 'v1', 'v2'])
    expect(youtube.search.mock.calls).toEqual([
      ['sheesha Karan Aujla', 'songs', 10],
      ['sheesha Karan Aujla', 'videos', 5],
    ])
  })

  test('on Spotify, runs the text as typed with the 10-result limit', async () => {
    const spotify = { get: vi.fn(async () => ({ tracks: { items: [spotifyTrack('t1', 'Sheesha', 161000)] } })) }
    const found = await searchCatalogue('sheesha Karan Aujla', 'spotify', { spotify })
    expect(found.map((track) => track.id)).toEqual(['t1'])
    expect(spotify.get).toHaveBeenCalledWith('/search', { query: { q: 'sheesha Karan Aujla', type: 'track', limit: 10 } })
  })
})

describe('lookupLink', () => {
  test('a YouTube Music link reads as that video, with its length', async () => {
    const youtube = { track: vi.fn(async () => AJA_WATCHED) }
    const { track } = await lookupLink('https://music.youtube.com/watch?v=q7e348rz27I', 'youtube', { youtube })
    expect(youtube.track).toHaveBeenCalledWith('q7e348rz27I')
    expect(track).toMatchObject({ id: 'q7e348rz27I', name: 'AJA - Kaléra (Feat. Jaski)', durationMs: 136000 })
  })

  test('a Spotify link reads as that track', async () => {
    const spotify = { get: vi.fn(async () => spotifyTrack('7fnd0BMPbWuMsn6lBrshZL', 'Taal Se Taal - Remix', 164848)) }
    const { track } = await lookupLink('https://open.spotify.com/track/7fnd0BMPbWuMsn6lBrshZL', 'spotify', { spotify })
    expect(spotify.get).toHaveBeenCalledWith('/tracks/7fnd0BMPbWuMsn6lBrshZL')
    expect(track).toMatchObject({ id: '7fnd0BMPbWuMsn6lBrshZL', durationMs: 164848 })
  })

  test.each([
    ['https://open.spotify.com/track/7fnd0BMPbWuMsn6lBrshZL', 'youtube', "That's a Spotify link. This song needs a YouTube Music one."],
    ['https://youtu.be/q7e348rz27I', 'spotify', "That's a YouTube link. This song needs a Spotify one."],
    ['https://open.spotify.com/album/1ATL5GLyefJaxhQzSPVrLX', 'spotify', "That isn't a link to one song on Spotify."],
    ['Sheesha Karan Aujla', 'youtube', "That isn't a link to one song on YouTube Music."],
  ])('%s for %s is refused without a lookup', async (text, side, error) => {
    const youtube = { track: vi.fn() }
    const spotify = { get: vi.fn() }
    expect(await lookupLink(text, side, { youtube, spotify })).toEqual({ error })
    expect(youtube.track).not.toHaveBeenCalled()
    expect(spotify.get).not.toHaveBeenCalled()
  })

  test('a video YouTube does not have could not be found', async () => {
    const youtube = { track: vi.fn(async () => null) }
    expect(await lookupLink('https://youtu.be/aaaaaaaaaaa', 'youtube', { youtube })).toEqual({
      error: 'That track could not be found.',
    })
  })

  test.each([404, 400])('a Spotify %i could not be found', async (status) => {
    const spotify = { get: vi.fn(async () => Promise.reject(Object.assign(new Error('Not found'), { status }))) }
    expect(await lookupLink('spotify:track:7fnd0BMPbWuMsn6lBrshZL', 'spotify', { spotify })).toEqual({
      error: 'That track could not be found.',
    })
  })

  test('any other failure says what went wrong', async () => {
    const message = 'The YouTube proxy is not running. `npm start` runs it alongside the app, or `npm run dev:proxy` runs it alone.'
    const youtube = { track: vi.fn(async () => Promise.reject(new Error(message))) }
    expect(await lookupLink('https://youtu.be/q7e348rz27I', 'youtube', { youtube })).toEqual({ error: message })
  })
})
