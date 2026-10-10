/**
 * One half of a catalogue search sweep: each song in turn, until the songs
 * run out, the sweep is stopped, or a failure ends the half. A dead proxy or
 * an expired session would fail every song after it too, so it ends the half;
 * any other failure skips that one song.
 *
 * Kept out of the hook so it is tested without React. See
 * docs/2026-10-08-catalogue-search-design.md §4 and §8.
 *
 * @param {Array} songs
 * @param {object} handlers
 * @param {(song) => Promise<object>} handlers.find
 * @param {() => boolean} handlers.live false once the sweep is stopped or superseded
 * @param {(song, twins) => void} handlers.onFound
 * @param {(song, failure) => void} handlers.onFailed
 * @param {(failure) => void} handlers.onStopped
 * @param {(failure) => boolean} handlers.isFatal
 */
export async function sweepHalf(songs, { find, live, onFound, onFailed, onStopped, isFatal }) {
  for (const song of songs) {
    if (!live()) return
    try {
      const twins = await find(song)
      // A result that lands after Stop is dropped.
      if (live()) onFound(song, twins)
    } catch (failure) {
      if (!live()) return
      if (isFatal(failure)) {
        onStopped(failure)
        return
      }
      onFailed(song, failure)
    }
  }
}
