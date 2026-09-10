/**
 * Primitive track comparators and the combinators that build strategies from
 * them.
 *
 * Pure module: no network, no browser APIs. See docs design §6.
 *
 * Every comparator sorts ascending. Direction is applied by the strategy via
 * `withDirection`, so no comparator needs a descending twin.
 */

// numeric:true gives "Part 2" before "Part 10"; sensitivity:'base' makes the
// comparison blind to case and diacritics.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function compareText(a, b) {
  return collator.compare(a ?? '', b ?? '')
}

function compareNumbers(a, b) {
  return (a ?? 0) - (b ?? 0)
}

/**
 * Track titles keep their leading article — a song called "The Wall" files
 * under T. Artist names do not, which is why they use `artistSortKey`.
 */
export const byTitle = (a, b) => compareText(a.name, b.name)

export const byArtistName = (a, b) => compareText(a.artistSortKey, b.artistSortKey)

export const byAlbumName = (a, b) => compareText(a.album?.name, b.album?.name)

export const byDuration = (a, b) => compareNumbers(a.durationMs, b.durationMs)

export const byPopularity = (a, b) => compareNumbers(a.popularity, b.popularity)

export const byTrackNumber = (a, b) =>
  compareNumbers(a.discNumber, b.discNumber) || compareNumbers(a.trackNumber, b.trackNumber)

// releaseDateSortable is padded to YYYY-MM-DD, so plain string order is valid.
export const byReleaseDate = (a, b) => compareText(a.releaseDateSortable, b.releaseDateSortable)

export const byAddedAt = (a, b) => compareText(a.addedAt, b.addedAt)

export const byOriginalIndex = (a, b) => compareNumbers(a.originalIndex, b.originalIndex)

/** Read an album in the order it was meant to be heard. */
export const byAlbumThenTrack = chain(byAlbumName, byTrackNumber)

/** Try each comparator in turn, falling through only on a tie. */
export function chain(...comparators) {
  return (a, b) => {
    for (const comparator of comparators) {
      const result = comparator(a, b)
      if (result !== 0) return result
    }
    return 0
  }
}

export function withDirection(comparator, direction) {
  return direction === 'desc' ? (a, b) => -comparator(a, b) : comparator
}
