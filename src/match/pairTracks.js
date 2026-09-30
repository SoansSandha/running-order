/**
 * Pairs a Spotify playlist against a YouTube playlist.
 *
 * Pure module: no network, no storage, no React. The match book is injected
 * as `verdictFor` so this never learns where a verdict is kept (M4).
 *
 * Every pair this returns is a PROPOSAL. Only a verdict of 'same' — a human
 * having already confirmed that exact pair — comes back as certain (D15).
 */

import { scorePair, videoTypeRank } from './scorePair.js'

const TIER_RANK = { certain: 3, strong: 2, likely: 1 }

/**
 * @param {Array} spotifyTracks
 * @param {Array} youtubeTracks
 * @param {{verdictFor?: (spotifyId: string, youtubeVideoId: string) => string|null}} [options]
 */
export function pairTracks(spotifyTracks, youtubeTracks, { verdictFor } = {}) {
  const spotify = spotifyTracks ?? []
  const youtube = youtubeTracks ?? []

  // Every candidate, scored once, then sorted so the best claim is settled
  // first. Doing it in input order would let a weak early pair take a track
  // a strong later pair needed.
  const candidates = []
  for (const left of spotify) {
    for (const right of youtube) {
      const verdict = verdictFor?.(left?.id, right?.id) ?? null
      // A dismissed pair is gone for good, not re-proposed every sync (D16).
      if (verdict === 'different') continue

      if (verdict === 'same') {
        candidates.push({
          spotify: left,
          youtube: right,
          tier: 'certain',
          durationDeltaMs: (right?.durationMs ?? 0) - (left?.durationMs ?? 0),
          reason: 'You confirmed this pair before',
        })
        continue
      }

      const scored = scorePair(left, right)
      if (scored) candidates.push({ spotify: left, youtube: right, ...scored })
    }
  }

  candidates.sort((a, b) => {
    const byTier = TIER_RANK[b.tier] - TIER_RANK[a.tier]
    if (byTier !== 0) return byTier
    const byDrift = Math.abs(a.durationDeltaMs) - Math.abs(b.durationDeltaMs)
    if (byDrift !== 0) return byDrift
    // M3: only ever a tie-break, never a reason to promote or reject.
    const byVideoType = videoTypeRank(b.youtube) - videoTypeRank(a.youtube)
    if (byVideoType !== 0) return byVideoType
    // C-1: tier, drift and videoTypeRank can ALL tie — two Spotify tracks
    // sitting equally close to the same YouTube track, say. Array.prototype.sort
    // is stable, so without a further tie-break the outcome silently falls back
    // to insertion order, i.e. input order. That is not a total order: reversing
    // one of the input arrays could then pick a different winner for a
    // contested track and drop a real match. Break the remaining tie on the
    // ids themselves so the ordering never depends on array position.
    const bySpotifyId = String(a.spotify?.id ?? '').localeCompare(String(b.spotify?.id ?? ''))
    if (bySpotifyId !== 0) return bySpotifyId
    return String(a.youtube?.id ?? '').localeCompare(String(b.youtube?.id ?? ''))
  })

  const pairs = []
  const claimedSpotify = new Set()
  const claimedYoutube = new Set()
  // I-1: this pass is greedy by confidence, not a cardinality-optimal
  // assignment. With s1=188000ms, s2=191000ms against y1=188000ms, y2=185000ms,
  // s1 ties strong with y1 (0s drift) while s1-y2 and s2-y1 are only likely
  // (3s drift each). The optimal ASSIGNMENT pairs s1-y2 and s2-y1 (2 matches),
  // but greedy claims the strongest candidate first (s1-y1) and starves s2, so
  // this returns only 1 pair. That is a deliberate trade-off, not a bug: a
  // wrong pair puts a wrong track in a real playlist, while an unmatched track
  // merely falls through to a later search — so confidence wins over count.
  for (const candidate of candidates) {
    if (claimedSpotify.has(candidate.spotify) || claimedYoutube.has(candidate.youtube)) continue
    claimedSpotify.add(candidate.spotify)
    claimedYoutube.add(candidate.youtube)
    pairs.push(candidate)
  }

  const unmatchedSpotify = spotify.filter((track) => !claimedSpotify.has(track))
  const unmatchedYoutube = youtube.filter((track) => !claimedYoutube.has(track))

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
