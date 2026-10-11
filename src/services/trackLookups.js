/**
 * The match tray's two lookups (docs/2026-10-10-match-tray-design.md §4, §5):
 * the owner's own search of the other catalogue, and the one track a pasted
 * link names. The clients are handed in, so both test without a network.
 */

import { parseTrackLink } from '../match/links.js'
import { getTrack, SEARCH_LIMIT, searchTracks } from './spotify/search.js'
import { normalizeYouTubeSearchResults } from './youtube/track.js'

const NAMES = { youtube: 'YouTube Music', spotify: 'Spotify' }
const NOT_FOUND = 'That track could not be found.'

/**
 * The owner's own search of one catalogue. On YouTube Music it runs songs and
 * videos together and drops a video already listed as a song.
 *
 * @param {'youtube'|'spotify'} side the catalogue to search
 */
export async function searchCatalogue(text, side, { youtube, spotify }) {
  if (side === 'spotify') return searchTracks(spotify, text, SEARCH_LIMIT)
  const [songs, videos] = await Promise.all([youtube.search(text, 'songs', 10), youtube.search(text, 'videos', 5)])
  const seen = new Set()
  return normalizeYouTubeSearchResults([...songs, ...videos]).filter((track) => {
    if (seen.has(track.id)) return false
    seen.add(track.id)
    return true
  })
}

/**
 * The track a pasted link names, or the one line that says why it cannot be
 * paired: not one song, the other service's link, or no such track.
 *
 * @param {'youtube'|'spotify'} side the service the link must be from
 * @returns {Promise<{track: object}|{error: string}>}
 */
export async function lookupLink(text, side, { youtube, spotify }) {
  const link = parseTrackLink(text)
  if (!link) return { error: `That isn't a link to one song on ${NAMES[side]}.` }
  if (link.service !== side) {
    const pasted = link.service === 'spotify' ? 'Spotify' : 'YouTube'
    return { error: `That's a ${pasted} link. This song needs a ${NAMES[side]} one.` }
  }
  try {
    const track =
      side === 'youtube'
        ? normalizeYouTubeSearchResults([await youtube.track(link.id)].filter(Boolean))[0]
        : await getTrack(spotify, link.id)
    return track ? { track } : { error: NOT_FOUND }
  } catch (failure) {
    // Spotify answers an unknown or malformed id with 404 or 400.
    return { error: failure?.status === 404 || failure?.status === 400 ? NOT_FOUND : failure.message }
  }
}
