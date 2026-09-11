/**
 * Pairs CSV rows against playlist tracks, and reports everything it could not
 * pair.
 *
 * Pure module: no network, no browser APIs. See docs design §7.2.
 *
 * Matching is tiered: the first tier that yields an unclaimed track wins.
 * Tiers 1-4 are applied automatically; tier 5 is fuzzy and only ever produces
 * a suggestion for a human to confirm. Tracks are claimed greedily from a
 * pool, so two CSV rows can pair with two playlist copies of one track, and a
 * third row correctly finds nothing left.
 */

import { sortKey } from '../model/normalize.js'

const FUZZY_THRESHOLD = 0.9

/**
 * Fold a title for comparison.
 *
 * Deliberately conservative. Over-normalizing invents wrong matches that get
 * applied silently; under-normalizing only drops a row to the fuzzy tier,
 * where a human confirms it. So "(feat. X)" and remaster annotations go —
 * those are the same recording labelled inconsistently — but "(Live)" and
 * "(Remix)" stay, because those are different recordings.
 */
export function matchText(value) {
  if (!value) return ''
  return String(value)
    .replace(/[([]\s*(feat|ft|featuring|with)\b[^)\]]*[)\]]/gi, ' ')
    .replace(/[([][^)\]]*remaster[^)\]]*[)\]]/gi, ' ')
    .replace(/\s[-–]\s[^-–]*remaster[^-–]*$/i, ' ')
    .replace(/\s[-–]\s(single|album)\s+version\s*$/i, ' ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    // Apostrophes are deleted, not spaced, so "Don't" folds onto "Dont".
    // Every other punctuation mark becomes a separator.
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Pull a Spotify track id out of a URI, a share link, or a bare id. */
export function extractTrackId(value) {
  const text = String(value ?? '').trim()
  if (!text) return null
  const uri = text.match(/spotify:track:([A-Za-z0-9]+)/i)
  if (uri) return uri[1]
  const link = text.match(/open\.spotify\.com\/track\/([A-Za-z0-9]+)/i)
  if (link) return link[1]
  return /^[A-Za-z0-9]+$/.test(text) ? text : null
}

/**
 * @param {string[][]} rows    parsed CSV grid, header included if present
 * @param {Array} tracks       normalized Tracks in playlist order
 * @param {{columns: object, hasHeader: boolean}} mapping
 */
export function matchCsvToTracks(rows, tracks, { columns, hasHeader = false } = {}) {
  const dataRows = (hasHeader ? rows.slice(1) : rows)
    .filter((cells) => cells.some((cell) => cell && cell.trim()))
    .map((cells, rowIndex) => ({ cells, rowIndex }))

  const pools = buildPools(tracks)
  const claimed = new Set()

  const matches = []
  const suggestions = []
  const unmatchedRows = []
  const duplicateRows = []
  const seenRowKeys = new Set()
  const byTier = { uri: 0, isrc: 0, titleArtist: 0, titleAnyArtist: 0 }

  for (const { cells, rowIndex } of dataRows) {
    const csv = readRow(cells, columns)

    const rowKey = csv.trackId ?? `${csv.title}|${csv.artistRaw}`
    if (seenRowKeys.has(rowKey)) duplicateRows.push({ rowIndex, title: csv.rawTitle, artist: csv.artistRaw })
    seenRowKeys.add(rowKey)

    const found = claimBestMatch(csv, pools, claimed)
    if (found) {
      claimed.add(found.trackIndex)
      byTier[found.tier] += 1
      matches.push({ rowIndex, track: tracks[found.trackIndex], tier: found.tier })
      continue
    }

    const suggestion = findSuggestion(csv, tracks, claimed)
    if (suggestion) {
      suggestions.push({ rowIndex, track: tracks[suggestion.trackIndex], tier: 'fuzzy', score: suggestion.score })
      continue
    }

    unmatchedRows.push({ rowIndex, title: csv.rawTitle, artist: csv.artistRaw })
  }

  const unmatchedTracks = tracks.filter((_, index) => !claimed.has(index))

  return {
    matches,
    suggestions,
    unmatchedRows,
    unmatchedTracks,
    duplicateRows,
    counts: {
      csvRows: dataRows.length,
      playlistTracks: tracks.length,
      matched: matches.length,
      byTier,
      needsReview: suggestions.length,
      unmatchedRows: unmatchedRows.length,
      unmatchedTracks: unmatchedTracks.length,
      duplicateRows: duplicateRows.length,
    },
  }
}

function readRow(cells, columns) {
  const at = (index) => (index === null || index === undefined ? '' : (cells[index] ?? ''))
  const rawTitle = at(columns.title)
  const artistRaw = at(columns.artist)
  return {
    trackId: columns.uri === null ? null : extractTrackId(at(columns.uri)),
    isrc: at(columns.isrc).trim().toUpperCase(),
    rawTitle,
    title: matchText(rawTitle),
    artistRaw,
    artistKeys: artistCandidates(artistRaw),
  }
}

/**
 * A CSV artist cell may hold one name or several: "Rihanna, Drake".
 * Every part is a candidate, and so is the whole cell.
 */
function artistCandidates(value) {
  const text = String(value ?? '').trim()
  if (!text) return []
  const parts = text.split(/[,;/]|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/i)
  return [...new Set([...parts, text].map(sortKey).filter(Boolean))]
}

function buildPools(tracks) {
  const byId = new Map()
  const byIsrc = new Map()
  const byTitleArtist = new Map()
  const byTitleAnyArtist = new Map()

  tracks.forEach((track, index) => {
    if (track.id) push(byId, track.id, index)
    if (track.isrc) push(byIsrc, track.isrc.toUpperCase(), index)

    const title = matchText(track.name)
    if (!title) return
    if (track.primaryArtist) push(byTitleArtist, `${title}|${sortKey(track.primaryArtist.name)}`, index)
    for (const credited of track.artists) push(byTitleAnyArtist, `${title}|${sortKey(credited.name)}`, index)
  })

  return { byId, byIsrc, byTitleArtist, byTitleAnyArtist }
}

function push(map, key, index) {
  const existing = map.get(key)
  if (existing) existing.push(index)
  else map.set(key, [index])
}

/** First unclaimed track under this key, or null. */
function claim(map, key, claimed) {
  const candidates = map.get(key)
  if (!candidates) return null
  for (const index of candidates) {
    if (!claimed.has(index)) return index
  }
  return null
}

function claimBestMatch(csv, pools, claimed) {
  if (csv.trackId) {
    const index = claim(pools.byId, csv.trackId, claimed)
    if (index !== null) return { trackIndex: index, tier: 'uri' }
  }

  if (csv.isrc) {
    const index = claim(pools.byIsrc, csv.isrc, claimed)
    if (index !== null) return { trackIndex: index, tier: 'isrc' }
  }

  if (!csv.title) return null

  for (const artistKey of csv.artistKeys) {
    const index = claim(pools.byTitleArtist, `${csv.title}|${artistKey}`, claimed)
    if (index !== null) return { trackIndex: index, tier: 'titleArtist' }
  }

  for (const artistKey of csv.artistKeys) {
    const index = claim(pools.byTitleAnyArtist, `${csv.title}|${artistKey}`, claimed)
    if (index !== null) return { trackIndex: index, tier: 'titleAnyArtist' }
  }

  return null
}

/**
 * A near-miss title, but only when an artist already agrees. Without the
 * artist gate this tier would propose every similarly-titled song in the
 * playlist.
 */
function findSuggestion(csv, tracks, claimed) {
  if (!csv.title || !csv.artistKeys.length) return null

  let best = null
  tracks.forEach((track, index) => {
    if (claimed.has(index)) return
    const artistAgrees = track.artists.some((credited) => csv.artistKeys.includes(sortKey(credited.name)))
    if (!artistAgrees) return

    const score = diceCoefficient(csv.title, matchText(track.name))
    if (score >= FUZZY_THRESHOLD && (!best || score > best.score)) {
      best = { trackIndex: index, score }
    }
  })

  return best
}

/** Sørensen-Dice similarity over character bigrams. */
export function diceCoefficient(a, b) {
  if (a === b) return a ? 1 : 0
  if (a.length < 2 || b.length < 2) return 0

  const counts = new Map()
  for (let i = 0; i < a.length - 1; i++) {
    const gram = a.slice(i, i + 2)
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }

  let shared = 0
  for (let i = 0; i < b.length - 1; i++) {
    const gram = b.slice(i, i + 2)
    const available = counts.get(gram) ?? 0
    if (available > 0) {
      counts.set(gram, available - 1)
      shared += 1
    }
  }

  return (2 * shared) / (a.length - 1 + b.length - 1)
}
