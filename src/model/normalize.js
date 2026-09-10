/**
 * Shared normalization helpers for building comparable sort keys.
 *
 * Pure module: no network, no browser APIs. See docs design §5.2.
 */

const LEADING_ARTICLE = /^the\s+/

/**
 * Fold a display name into a stable key for alphabetical ordering.
 *
 * Lowercases, strips diacritics, collapses whitespace, and drops a leading
 * definite article so "The Beatles" files under B.
 */
export function sortKey(value) {
  if (!value) return ''
  const folded = String(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  return folded.replace(LEADING_ARTICLE, '')
}

/**
 * Pad Spotify's variable-precision release_date to YYYY-MM-DD.
 *
 * release_date may be "1972", "1972-03", or "1972-03-01" depending on
 * release_date_precision. Padding makes plain string comparison valid across
 * mixed precision. A missing date becomes '' so it sorts before real dates
 * rather than producing NaN.
 */
export function padReleaseDate(date, precision) {
  if (!date) return ''
  const text = String(date)
  const resolved = precision ?? inferPrecision(text)
  if (resolved === 'year') return `${text}-01-01`
  if (resolved === 'month') return `${text}-01`
  return text
}

function inferPrecision(text) {
  const segments = text.split('-').length
  if (segments === 1) return 'year'
  if (segments === 2) return 'month'
  return 'day'
}
