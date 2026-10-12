/**
 * The mirror run's plan (docs/2026-10-11-mirror-run-design.md §4): what to
 * add to each playlist, and the order that makes YouTube follow Spotify.
 *
 * Pure module: no network, no storage. It is built from the matcher's own
 * steps, and only a human's `same` verdict pairs here, so every pair it acts
 * on is certain (D15). Because a run needs every row settled (D50), the
 * whole plan follows from the two playlists and the match book.
 */

import { spotifyKeyOf, verdictLookup } from '../match/matchBook.js'
import { settlePairs } from '../match/pairTracks.js'
import { setAsideMarked, settleFound } from '../match/settleFound.js'
import { buildMoveOps } from './diff.js'

/**
 * The two playlists settled from the match book alone. Nothing is scored, so
 * the only pairs are ones the owner confirmed. A song the owner has not
 * decided is left unmatched, where planFill counts it as blocking.
 */
export function settleFromBook(spotifyTracks, youtubeTracks, book) {
  const settled = settlePairs(spotifyTracks, youtubeTracks, [], { verdictFor: verdictLookup(book) })
  const aside = setAsideMarked(settled, book)
  return {
    ...settleFound(aside, { spotifyTracks, youtubeTracks, book }),
    markedSpotify: aside.markedSpotify,
    markedYoutube: aside.markedYoutube,
  }
}

/**
 * What a run adds, and how many rows still wait for the owner (§4, D50).
 *
 * @param {{pairs: Array, unmatchedSpotify: Array, unmatchedYoutube: Array}} result a settled result
 * @returns {{blocked: number, addToYoutube: Array, addToSpotify: Array}}
 */
export function planFill(result) {
  const certain = result.pairs.filter((pair) => pair.tier === 'certain')
  // A row with no key (a track Spotify no longer serves) can be neither
  // decided nor marked (M-3), so it waits on nothing; counting it would
  // block every run of that playlist.
  const blocked =
    result.pairs.length -
    certain.length +
    result.unmatchedSpotify.filter((track) => spotifyKeyOf(track) != null).length +
    result.unmatchedYoutube.filter((track) => track.id != null).length
  return {
    blocked,
    addToYoutube: certain
      .filter((pair) => pair.missingFrom === 'youtube')
      .sort(byPosition('spotify'))
      .map((pair) => pair.youtube),
    addToSpotify: certain
      .filter((pair) => pair.missingFrom === 'spotify')
      .sort(byPosition('youtube'))
      .map((pair) => pair.spotify),
  }
}

/**
 * The YouTube playlist in its target order (§4): down the Spotify playlist,
 * each song's paired YouTube item; then every YouTube item in no pair, in its
 * current relative order. Always a permutation of `youtubeTracks`. Pairs join
 * playlist items, not song ids, so a song listed twice on either side needs
 * no special case.
 */
export function mirrorOrder(spotifyTracks, youtubeTracks, pairs) {
  const twinOf = new Map(pairs.map((pair) => [pair.spotify, pair.youtube]))
  const inPlaylist = new Set(youtubeTracks)
  const placed = new Set()
  const order = []
  for (const track of spotifyTracks) {
    const twin = twinOf.get(track)
    if (!twin || !inPlaylist.has(twin) || placed.has(twin)) continue
    placed.add(twin)
    order.push(twin)
  }
  return [...order, ...youtubeTracks.filter((track) => !placed.has(track))]
}

/**
 * The preview's move count (§4). The songs to add stand in at the end of
 * YouTube, wherever YouTube will really put them, so the count is exact only
 * when nothing is added. A stand-in is keyed by its videoId, which no
 * playlist item id can equal.
 */
export function estimateMoves(spotifyTracks, youtubeTracks, result) {
  const { addToYoutube, addToSpotify } = planFill(result)
  const pairs = result.pairs.filter((pair) => pair.tier === 'certain')
  const youtubeAfter = [...youtubeTracks, ...addToYoutube]
  const keyOf = (track) => track.itemId ?? `new:${track.id}`
  const target = mirrorOrder([...spotifyTracks, ...addToSpotify], youtubeAfter, pairs)
  return buildMoveOps(youtubeAfter.map(keyOf), target.map(keyOf)).length
}

/** Whether two reads of a playlist hold the same items in the same order (§5, step 1). */
export function sameItems(before, after, keyOf) {
  return before.length === after.length && before.every((track, index) => keyOf(track) === keyOf(after[index]))
}

const byPosition = (side) => (a, b) => a[side].originalIndex - b[side].originalIndex
