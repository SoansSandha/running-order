/**
 * Settling what catalogue search found (Plan B), after the two playlists have
 * been paired.
 *
 * Pure. It runs on settlePairs' leftovers only, so playlist pairing never
 * changes: each unmatched song takes its best found twin that the user has
 * not rejected, and a confirmed find — rebuilt from its match-book snapshot,
 * with no search — is certain. See docs/2026-10-08-catalogue-search-design.md §5.
 */

import { spotifyKeyOf, trackFromSnapshot, verdictLookup } from './matchBook.js'
import { TIER_RANK } from './pairTracks.js'

/**
 * @param {{pairs: Array, unmatchedSpotify: Array, unmatchedYoutube: Array}} settled what settlePairs returned
 * @param {object} context
 * @param {Array} context.spotifyTracks the Spotify playlist
 * @param {Array} context.youtubeTracks the YouTube playlist
 * @param {Array} context.book the match book
 * @param {Map<string, {candidates: Array}>} [context.foundForSpotify] YouTube twins, by spotifyKeyOf
 * @param {Map<string, {candidates: Array}>} [context.foundForYoutube] Spotify twins, by video id
 * @returns the shape settlePairs returns; a pair with a found track also carries
 *   `missingFrom: 'youtube' | 'spotify'`, the playlist that lacks it
 */
export function settleFound(
  settled,
  { spotifyTracks, youtubeTracks, book, foundForSpotify = new Map(), foundForYoutube = new Map() },
) {
  const verdictFor = verdictLookup(book)
  const inSpotify = new Set(spotifyTracks.map(spotifyKeyOf))
  const inYoutube = new Set(youtubeTracks.map((track) => track.id))
  const confirmedFinds = book.filter((entry) => entry.verdict === 'same' && entry.found)

  const claims = []
  for (const song of settled.unmatchedSpotify) {
    const key = spotifyKeyOf(song)
    for (const entry of confirmedFinds) {
      // Once the found track is in the YouTube playlist, settlePairs owns the pair.
      if (entry.found.side !== 'youtube' || entry.spotifyKey !== key || inYoutube.has(entry.youtubeVideoId)) continue
      claims.push(certain(song, trackFromSnapshot(entry), 'youtube'))
    }
    for (const candidate of foundForSpotify.get(key)?.candidates ?? []) {
      // 'same' is already a certain claim above; 'different' is rejected for good.
      if (verdictFor(key, candidate.youtube.id) !== null) continue
      claims.push({ ...candidate, spotify: song, missingFrom: 'youtube' })
    }
  }
  for (const song of settled.unmatchedYoutube) {
    for (const entry of confirmedFinds) {
      if (entry.found.side !== 'spotify' || entry.youtubeVideoId !== song.id || inSpotify.has(entry.spotifyKey)) continue
      claims.push(certain(trackFromSnapshot(entry), song, 'spotify'))
    }
    for (const candidate of foundForYoutube.get(song.id)?.candidates ?? []) {
      if (verdictFor(spotifyKeyOf(candidate.spotify), song.id) !== null) continue
      claims.push({ ...candidate, youtube: song, missingFrom: 'spotify' })
    }
  }

  // The surest claim first, as settlePairs orders them. Stable, so ties keep
  // search order.
  claims.sort(
    (a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || Math.abs(a.durationDeltaMs) - Math.abs(b.durationDeltaMs),
  )

  const found = []
  const claimedSongs = new Set()
  const claimedFinds = new Set()
  for (const claim of claims) {
    const song = claim.missingFrom === 'youtube' ? claim.spotify : claim.youtube
    // Two searches can return the same track as different objects, so a find
    // is claimed by id, not identity.
    const find = claim.missingFrom === 'youtube' ? `y:${claim.youtube.id}` : `s:${spotifyKeyOf(claim.spotify)}`
    if (claimedSongs.has(song) || claimedFinds.has(find)) continue
    claimedSongs.add(song)
    claimedFinds.add(find)
    found.push(claim)
  }

  const pairs = [...settled.pairs, ...found]
  const unmatchedSpotify = settled.unmatchedSpotify.filter((track) => !claimedSongs.has(track))
  const unmatchedYoutube = settled.unmatchedYoutube.filter((track) => !claimedSongs.has(track))
  return {
    pairs,
    unmatchedSpotify,
    unmatchedYoutube,
    counts: {
      certain: pairs.filter((pair) => pair.tier === 'certain').length,
      strong: pairs.filter((pair) => pair.tier === 'strong').length,
      likely: pairs.filter((pair) => pair.tier === 'likely').length,
      unmatchedSpotify: unmatchedSpotify.length,
      unmatchedYoutube: unmatchedYoutube.length,
    },
  }
}

function certain(spotify, youtube, missingFrom) {
  return {
    spotify,
    youtube,
    missingFrom,
    tier: 'certain',
    durationDeltaMs: (youtube?.durationMs ?? 0) - (spotify?.durationMs ?? 0),
    reason: 'You confirmed this find before',
  }
}
