/**
 * What each service can actually sort by.
 *
 * YouTube Music returns no date added, no release year and no popularity —
 * measured against a real library, not inferred. A control that quietly does
 * nothing is worse than one that is visibly unavailable, so these are stated
 * rather than hidden (Product Principle 4, spec D20).
 *
 * Pure module: a table and two lookups.
 */

const YOUTUBE_MISSING = 'YouTube Music does not provide this'

export const UNSUPPORTED_BY_SOURCE = {
  youtube: {
    addedAt: `${YOUTUBE_MISSING} — it returns no date added`,
    releaseDate: `${YOUTUBE_MISSING} — it returns no release year`,
    popularity: `${YOUTUBE_MISSING} — it has no popularity score`,
  },
}

/** Inner orders of the artist sort, in the same terms. */
const UNSUPPORTED_INNER_ORDERS = {
  youtube: new Set(['addedAt', 'releaseDate']),
}

/** Used when a source cannot honour the configured inner order. */
const FALLBACK_INNER_ORDER = 'title'

/**
 * @returns {string|null} why this strategy is unavailable, or null if it works
 */
export function unsupportedReason(source, strategyId) {
  return UNSUPPORTED_BY_SOURCE[source]?.[strategyId] ?? null
}

/**
 * Replace any option value the source cannot honour.
 *
 * The artist sort defaults to ordering by date added, which YouTube lacks —
 * left alone, the most-used sort would silently do something other than its
 * label says.
 */
export function defaultStrategyOptionsFor(source, strategyId, baseOptions) {
  const options = { ...baseOptions }
  if (UNSUPPORTED_INNER_ORDERS[source]?.has(options.innerOrder)) {
    options.innerOrder = FALLBACK_INNER_ORDER
  }
  return options
}
