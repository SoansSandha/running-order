/**
 * What each service can actually sort by.
 *
 * YouTube Music returns no date added, no release year and no popularity —
 * measured against a real library, not inferred. A control that quietly does
 * nothing is worse than one that is visibly unavailable, so these are stated
 * rather than hidden (Product Principle 4, spec D20).
 *
 * Pure module: tables and lookups.
 */

import { ALBUM_ORDERS } from '../sort/albumGrouped.js'
import { STRATEGIES } from '../sort/index.js'

const YOUTUBE_MISSING = 'YouTube Music does not provide this'

const NO_DATE_ADDED = `${YOUTUBE_MISSING} — it returns no date added`
const NO_RELEASE_DATE = `${YOUTUBE_MISSING} — it returns no release year`

/** Whole strategies a source cannot run: `{ source: { strategyId: reason } }`. */
export const UNSUPPORTED_BY_SOURCE = {
  youtube: {
    addedAt: NO_DATE_ADDED,
    releaseDate: NO_RELEASE_DATE,
    popularity: `${YOUTUBE_MISSING} — it has no popularity score`,
  },
}

/**
 * Option VALUES a source cannot honour:
 * `{ source: { strategyId: { optionId: { value: reason } } } }`.
 *
 * A strategy can be perfectly runnable while one of the fields it can be
 * ordered *by* is missing. The artist sort works on YouTube; ordering within
 * an artist by date added does not. The album sort works on YouTube; putting
 * the albums in release order does not, because every album ties at null and
 * the sort falls through to album name while the panel still reads "Release
 * date". Neither is visible to a table that can only speak about strategy
 * ids, which is why this one is keyed a level deeper.
 *
 * Keying by strategy AND option id is also what keeps it honest: a value is
 * only ruled out on the strategy that actually owns that option, so a
 * different strategy holding the same value under the same key is untouched.
 */
export const UNSUPPORTED_OPTION_VALUES = {
  youtube: {
    artist: {
      innerOrder: { addedAt: NO_DATE_ADDED, releaseDate: NO_RELEASE_DATE },
    },
    album: {
      albumOrder: { [ALBUM_ORDERS.releaseDate]: NO_RELEASE_DATE },
    },
  },
}

/**
 * What to put in place of a value the source cannot honour, keyed
 * `{ strategyId: { optionId: value } }`.
 *
 * This is the replacement, not a second statement of what is unavailable —
 * that is said once, above. Every entry is asserted by the tests to be a
 * real choice of that option and one no source rules out.
 */
const FALLBACK_OPTION_VALUES = {
  artist: { innerOrder: 'title' },
  album: { albumOrder: ALBUM_ORDERS.name },
}

/**
 * @returns {string|null} why this strategy is unavailable, or null if it works
 */
export function unsupportedReason(source, strategyId) {
  return UNSUPPORTED_BY_SOURCE[source]?.[strategyId] ?? null
}

/**
 * The same question, one level down: why a source cannot honour one VALUE of
 * one option of one strategy.
 *
 * @returns {string|null} the reason, or null if the value works
 */
export function unsupportedOptionReason(source, strategyId, optionId, value) {
  const byValue = UNSUPPORTED_OPTION_VALUES[source]?.[strategyId]?.[optionId]
  // hasOwn, not a truthiness check: an option value of 'constructor' would
  // otherwise find something on Object's prototype and read as unavailable.
  if (!byValue || !Object.hasOwn(byValue, value)) return null
  return byValue[value]
}

/**
 * A strategy this source can honour, keeping the chosen one where possible.
 *
 * Switching source must not leave a disabled strategy selected: the row
 * renders both pressed and disabled, the preview is still ordered by it, and
 * the user cannot even re-select it to clear the state. Falls back to the
 * first strategy the source supports — read off the registry, so a strategy
 * added later needs no second list updating.
 *
 * @returns {string} `strategyId` if it is honoured, otherwise a substitute
 */
export function supportedStrategyFor(source, strategyId) {
  if (!unsupportedReason(source, strategyId)) return strategyId
  return STRATEGIES.find((strategy) => !unsupportedReason(source, strategy.id))?.id ?? strategyId
}

/**
 * Replace every option value the source cannot honour.
 *
 * Both sorts that group tracks default to ordering their groups by a date
 * YouTube does not return, so left alone the two most-used sorts would each
 * quietly do something other than their label says. Driven entirely by
 * UNSUPPORTED_OPTION_VALUES, so an option that grows a source-specific gap
 * later is covered by adding it there and nowhere else.
 *
 * @param {string} source
 * @param {string} strategyId
 * @param {object} baseOptions
 * @returns {object} a copy, with any unhonourable value replaced
 */
export function defaultStrategyOptionsFor(source, strategyId, baseOptions) {
  const options = { ...baseOptions }
  for (const optionId of Object.keys(options)) {
    if (!unsupportedOptionReason(source, strategyId, optionId, options[optionId])) continue
    const fallback = FALLBACK_OPTION_VALUES[strategyId]?.[optionId]
    if (fallback !== undefined) options[optionId] = fallback
  }
  return options
}
