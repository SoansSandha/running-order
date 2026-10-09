/**
 * Pairs a Spotify playlist against a YouTube playlist.
 *
 * Pure module: no network, no storage, no React. The match book is injected
 * as `verdictFor` so this never learns where a verdict is kept (M4).
 *
 * Every pair this returns is a PROPOSAL. Only a verdict of 'same' — a human
 * having already confirmed that exact pair — comes back as certain (D15).
 *
 * Split in two for the match review: scoring is the slow half and runs once
 * per review; settling applies decisions and claims pairs, and reruns after
 * every click. See docs/2026-10-05-match-review-design.md §5.
 */

import { diceCoefficient } from '../csv/match.js'
import { spotifyKeyOf } from './matchBook.js'
import { foldTitle, scorePair, videoTypeRank } from './scorePair.js'

const TIER_RANK = { certain: 3, strong: 2, likely: 1 }

/**
 * Every pair scorePair proposes, before any decision is applied. The slow
 * half: 160,930 scorePair calls, about 0.35s, for the live playlists.
 */
export function scoreCandidates(spotifyTracks, youtubeTracks) {
  const candidates = []
  for (const left of spotifyTracks ?? []) {
    for (const right of youtubeTracks ?? []) {
      const scored = scorePair(left, right)
      if (scored) candidates.push({ spotify: left, youtube: right, ...scored })
    }
  }
  return candidates
}

/**
 * Apply the user's decisions to scored candidates and claim pairs. Never
 * calls scorePair, so it is cheap enough to rerun after every decision.
 *
 * Decisions are looked up by spotifyKeyOf, not by id: a local file has none.
 *
 * @param {Array} spotifyTracks
 * @param {Array} youtubeTracks
 * @param {Array} scored what scoreCandidates returned for these two lists
 * @param {{verdictFor?: (spotifyKey: string, youtubeVideoId: string) => string|null}} [options]
 */
export function settlePairs(spotifyTracks, youtubeTracks, scored, { verdictFor } = {}) {
  const spotify = spotifyTracks ?? []
  const youtube = youtubeTracks ?? []
  const verdictOf = (left, right) => verdictFor?.(spotifyKeyOf(left), right?.id) ?? null

  const candidates = []
  // A confirmed pair is certain whether or not the matcher proposed it, which
  // is what makes pairing by hand work (D25). Looking every pair up is cheap;
  // scoring them is the part that is not.
  if (verdictFor) {
    for (const left of spotify) {
      for (const right of youtube) {
        if (verdictOf(left, right) !== 'same') continue
        candidates.push({
          spotify: left,
          youtube: right,
          tier: 'certain',
          durationDeltaMs: (right?.durationMs ?? 0) - (left?.durationMs ?? 0),
          reason: 'You confirmed this pair before',
        })
      }
    }
  }
  // A dismissed pair is gone for good, not re-proposed every sync (D16); a
  // confirmed one is already in the list above.
  for (const candidate of scored ?? []) {
    if (verdictOf(candidate.spotify, candidate.youtube) === null) candidates.push(candidate)
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
    // keys themselves so the ordering never depends on array position. The
    // Spotify key, not the id: two local files both have a null id.
    //
    // Plain `<` here, not `localeCompare`: localeCompare with no locale
    // argument is ICU- and host-locale-dependent BY SPECIFICATION, so it can
    // order the same two ids differently on different machines (e.g. mixed
    // case ids like real Spotify ids sort differently under ICU collation
    // than under code-unit order). That would reintroduce exactly the
    // environment-dependent outcome this tie-break exists to remove. Plain
    // relational comparison on strings is a UTF-16 code-unit comparison,
    // which is spec-guaranteed and has no locale or ICU dependency — do not
    // "simplify" this back to localeCompare.
    const aSpotifyKey = String(spotifyKeyOf(a.spotify) ?? '')
    const bSpotifyKey = String(spotifyKeyOf(b.spotify) ?? '')
    if (aSpotifyKey !== bSpotifyKey) return aSpotifyKey < bSpotifyKey ? -1 : 1
    const aYoutubeId = String(a.youtube?.id ?? '')
    const bYoutubeId = String(b.youtube?.id ?? '')
    if (aYoutubeId !== bYoutubeId) return aYoutubeId < bYoutubeId ? -1 : 1
    return 0
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

/**
 * @param {Array} spotifyTracks
 * @param {Array} youtubeTracks
 * @param {{verdictFor?: (spotifyKey: string, youtubeVideoId: string) => string|null}} [options]
 */
export function pairTracks(spotifyTracks, youtubeTracks, options) {
  return settlePairs(spotifyTracks, youtubeTracks, scoreCandidates(spotifyTracks, youtubeTracks), options)
}

/**
 * Candidates for pairing a track by hand, most similar title first (D25).
 * Ties keep their playlist order; the input array is not changed.
 *
 * M-1: plain Dice over the whole folded title ranks a label-channel upload
 * too low — its title is the real one plus a long run of credits, which
 * dilutes the bigram overlap. A candidate whose folded title CONTAINS the
 * target's (3+ characters, so this never fires on a near-empty title) gets a
 * point added ahead of Dice, which is enough to clear a merely similar but
 * unrelated title without ever beating an exact match (Dice tops out at 1).
 */
export function closestTitles(track, candidates) {
  const title = foldTitle(track?.name)
  const similarity = new Map(
    candidates.map((candidate) => {
      const folded = foldTitle(candidate?.name)
      const contains = title.length > 2 && folded.includes(title) ? 1 : 0
      return [candidate, contains + diceCoefficient(title, folded)]
    }),
  )
  return candidates.toSorted((a, b) => similarity.get(b) - similarity.get(a))
}
