/**
 * Turns a desired track order into the minimum sequence of Spotify reorder
 * operations that produces it.
 *
 * Pure module: no network, no browser APIs. See docs design §8.
 *
 * Keys are opaque and must be unique — `originalIndex` is the natural choice,
 * because a playlist may hold the same URI at several positions.
 */

/**
 * Replay reorder operations against an array.
 *
 * This function *is* the specification of Spotify's reorder semantics: the
 * range is removed first, and `insert_before` is expressed in the indexing
 * that applied BEFORE that removal. The executor keeps a mirror in lockstep
 * using this same function, and the property tests verify buildMoveOps
 * against it.
 */
export function applyMoveOps(items, ops) {
  const model = [...items]
  for (const { rangeStart, insertBefore, rangeLength = 1 } of ops) {
    const removed = model.splice(rangeStart, rangeLength)
    const insertAt = insertBefore > rangeStart ? insertBefore - rangeLength : insertBefore
    model.splice(insertAt, 0, ...removed)
  }
  return model
}

/**
 * @param {Array} current unique keys in their present playlist order
 * @param {Array} target  the same keys in the desired order
 * @returns {Array<{rangeStart: number, insertBefore: number, rangeLength: number, key: *, beforeKey: *}>}
 *   `rangeStart`/`insertBefore`/`rangeLength` are Spotify's form, with
 *   `insertBefore` in PRE-removal indexing. `key`/`beforeKey` are the same
 *   move stated without indices, for services that move by item identity.
 *   `beforeKey === null` means "to the end".
 */
export function buildMoveOps(current, target) {
  const size = current.length
  if (size !== target.length) {
    throw new Error('target must be a permutation of current: lengths differ')
  }
  if (size === 0) return []

  const positions = new Map()
  for (let i = 0; i < size; i++) {
    if (positions.has(current[i])) {
      throw new Error('track keys must be unique; use originalIndex, not URI')
    }
    positions.set(current[i], i)
  }

  // Each target track's present position, read in target order. An increasing
  // run in this sequence is a set of tracks already in correct relative order.
  const presentPositions = new Array(size)
  const seen = new Set()
  for (let i = 0; i < size; i++) {
    const key = target[i]
    if (!positions.has(key) || seen.has(key)) {
      throw new Error('target must be a permutation of current: contents differ')
    }
    seen.add(key)
    presentPositions[i] = positions.get(key)
  }

  // The spine never moves. Everything else moves exactly once, giving
  // size - |LIS| operations, the minimum under single-item moves.
  const spine = new Set(longestIncreasingSubsequence(presentPositions).map((i) => target[i]))

  const model = [...current]
  const ops = []

  for (let i = 0; i < size; i++) {
    const key = target[i]
    if (spine.has(key)) continue

    const from = model.indexOf(key)
    // Anchor to the track that precedes this one in the target. It is already
    // correctly placed — either it is spine, or it was moved on an earlier
    // pass — so landing immediately after it puts this track in correct
    // relative order against everything placed so far.
    const anchor = i === 0 ? -1 : model.indexOf(target[i - 1])

    let to
    if (anchor === -1) to = 0
    else if (anchor < from) to = anchor + 1
    else to = anchor // removing `from` first shifts the anchor left by one

    if (to === from) continue

    const [moved] = model.splice(from, 1)
    model.splice(to, 0, moved)

    ops.push({
      rangeStart: from,
      insertBefore: to > from ? to + 1 : to,
      rangeLength: 1,
      // The same move, stated without indices: YouTube's edit_playlist takes
      // "move this item before that item" natively, and index arithmetic is
      // the thing most likely to be subtly wrong across two services.
      key,
      beforeKey: to + 1 < model.length ? model[to + 1] : null,
    })
  }

  return ops
}

/**
 * Indices of a longest strictly-increasing subsequence, via patience sorting
 * with parent pointers. O(n log n).
 */
function longestIncreasingSubsequence(sequence) {
  const size = sequence.length
  if (size === 0) return []

  const tails = [] // tails[l] = index of the smallest tail of a length-(l+1) run
  const previous = new Array(size).fill(-1)

  for (let i = 0; i < size; i++) {
    let low = 0
    let high = tails.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (sequence[tails[mid]] < sequence[i]) low = mid + 1
      else high = mid
    }
    if (low > 0) previous[i] = tails[low - 1]
    if (low === tails.length) tails.push(i)
    else tails[low] = i
  }

  const indices = []
  for (let k = tails[tails.length - 1]; k !== -1; k = previous[k]) {
    indices.push(k)
  }
  return indices.reverse()
}
