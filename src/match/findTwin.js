/**
 * Finding a song's twin in the other service's catalogue (Plan B).
 *
 * Pure apart from the search function it is handed, so it is tested with
 * recorded results and no network. Every result is judged by scorePair, the
 * audited matcher, and nothing here confirms anything: an accepted result is
 * a proposal, a refused one a near miss for Pair with… (D28). See
 * docs/2026-10-08-catalogue-search-design.md §4.
 */

import { TIER_RANK } from './pairTracks.js'
import { queryTitle, scorePair } from './scorePair.js'

/**
 * A Spotify song's twin on YouTube Music: its ISRC first (D30), then title
 * and artist among songs, then among videos. Stops at the first step that
 * finds a strong match.
 *
 * @param {object} spotifyTrack
 * @param {(query: string, filter: 'songs'|'videos', limit: number) => Promise<Array>} search
 *   resolves to normalized YouTube Tracks
 * @param {{skipIds?: Set<string>}} [options] video ids already in the YouTube playlist
 * @returns {Promise<{candidates: Array, nearMisses: Array}>}
 */
export function findOnYouTube(spotifyTrack, search, { skipIds } = {}) {
  const text = `${spotifyTrack?.name ?? ''} ${spotifyTrack?.primaryArtist?.name ?? ''}`.trim()
  const steps = [
    spotifyTrack?.isrc ? () => search(spotifyTrack.isrc, 'songs', 3) : null,
    () => search(text, 'songs', 5),
    () => search(text, 'videos', 3),
  ].filter(Boolean)
  return runCascade(steps, skipIds, (youtube) => {
    const scored = scorePair(spotifyTrack, youtube)
    return scored && { spotify: spotifyTrack, youtube, ...scored }
  })
}

/**
 * A YouTube song's twin on Spotify: field search on its title and primary
 * artist, then a plain search. YouTube has no ISRC. The title is read past
 * YouTube's decoration first (queryTitle).
 *
 * @param {object} youtubeTrack
 * @param {(query: string, limit: number) => Promise<Array>} search resolves to normalized Spotify Tracks
 * @param {{skipIds?: Set<string>}} [options] Spotify ids already in the Spotify playlist
 * @returns {Promise<{candidates: Array, nearMisses: Array}>}
 */
export function findOnSpotify(youtubeTrack, search, { skipIds } = {}) {
  const title = unquote(queryTitle(youtubeTrack))
  const artist = unquote(youtubeTrack?.primaryArtist?.name ?? '')
  const fielded = artist ? `track:"${title}" artist:"${artist}"` : `track:"${title}"`
  const steps = [() => search(fielded, 10), () => search(`${title} ${artist}`.trim(), 10)]
  return runCascade(steps, skipIds, (spotify) => {
    const scored = scorePair(spotify, youtubeTrack)
    return scored && { spotify, youtube: youtubeTrack, ...scored }
  })
}

async function runCascade(steps, skipIds = new Set(), judge) {
  const seen = new Set()
  const candidates = []
  const nearMisses = []
  for (const step of steps) {
    for (const track of await step()) {
      // The playlist pairing has already judged a track in the playlist.
      if (!track?.id || seen.has(track.id) || skipIds.has(track.id)) continue
      seen.add(track.id)
      const pair = judge(track)
      if (pair) candidates.push(pair)
      else nearMisses.push(track)
    }
    if (candidates.some((pair) => pair.tier === 'strong')) break
  }
  // Stable, so an equal tier and drift keeps search order: an ISRC hit stays first.
  candidates.sort(
    (a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || Math.abs(a.durationDeltaMs) - Math.abs(b.durationDeltaMs),
  )
  return { candidates, nearMisses }
}

/** Spotify's field syntax quotes a value, so a stray double quote would end it early. */
function unquote(text) {
  return String(text).replaceAll('"', ' ').replace(/\s+/g, ' ').trim()
}
