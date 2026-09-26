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

import { STRATEGIES } from '../sort/index.js'

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
 * Strategy ids that own an `innerOrder` option, derived from the strategy
 * registry rather than hardcoded — so a second strategy that grows its own
 * `innerOrder` option is picked up here automatically, and one that merely
 * has an option that happens to be named `innerOrder`'s neighbour is not
 * mistaken for it.
 */
const STRATEGIES_WITH_INNER_ORDER = new Set(
  STRATEGIES.filter((strategy) => strategy.options.some((option) => option.id === 'innerOrder')).map(
    (strategy) => strategy.id,
  ),
)

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
 * label says. Only strategies that actually own an `innerOrder` option are
 * touched, so a strategy whose unrelated option happens to hold the same
 * value as an unsupported inner order is left alone.
 */
export function defaultStrategyOptionsFor(source, strategyId, baseOptions) {
  const options = { ...baseOptions }
  if (
    STRATEGIES_WITH_INNER_ORDER.has(strategyId) &&
    UNSUPPORTED_INNER_ORDERS[source]?.has(options.innerOrder)
  ) {
    options.innerOrder = FALLBACK_INNER_ORDER
  }
  return options
}
