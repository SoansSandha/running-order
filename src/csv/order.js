/**
 * Turns a CSV and a playlist into a target track order.
 *
 * Pure module: no network, no browser APIs. See docs design §7.3.
 *
 * The CSV is an ordering instruction, never a membership change (design D3).
 * Tracks it does not mention keep their relative order and move as a block;
 * rows that match nothing are reported and otherwise ignored. The result is
 * always a permutation of the input.
 */

import { matchCsvToTracks } from './match.js'

/**
 * @param {Array} tracks   normalized Tracks in current playlist order
 * @param {string[][]} rows parsed CSV grid
 * @param {object} options `{ columns, hasHeader, unmatchedPosition, acceptedSuggestions }`
 * @param {{withReport?: boolean}} [output]
 */
export function buildCsvOrder(tracks, rows, options = {}, { withReport = false } = {}) {
  const { unmatchedPosition = 'bottom', acceptedSuggestions = [], ...mapping } = options

  const report = matchCsvToTracks(rows, tracks, mapping)
  const accepted = new Set(acceptedSuggestions)

  // Both confirmed matches and accepted suggestions are placed, in CSV order.
  const placements = [
    ...report.matches,
    ...report.suggestions.filter((suggestion) => accepted.has(suggestion.rowIndex)),
  ].sort((a, b) => a.rowIndex - b.rowIndex)

  const matched = []
  const placedIndices = new Set()
  for (const { track } of placements) {
    // Two rows can point at one track once suggestions enter the mix. The
    // first placement wins; a second would duplicate it out of the playlist.
    if (placedIndices.has(track.originalIndex)) continue
    placedIndices.add(track.originalIndex)
    matched.push(track)
  }

  const untouched = tracks.filter((track) => !placedIndices.has(track.originalIndex))

  const order =
    unmatchedPosition === 'top' ? [...untouched, ...matched] : [...matched, ...untouched]

  return withReport ? { order, report } : order
}
