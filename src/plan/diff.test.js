import { describe, expect, test } from 'vitest'
import { applyMoveOps, buildMoveOps } from './diff.js'

/** Deterministic PRNG so a failing property test is reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled(items, rng) {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const range = (n) => Array.from({ length: n }, (_, i) => i)

describe('applyMoveOps — models Spotify reorder semantics', () => {
  // insert_before is expressed in PRE-removal indexing. These cases pin that
  // contract down; buildMoveOps is then verified against it.
  test('moving an item backwards inserts before the given index', () => {
    expect(applyMoveOps(['a', 'b', 'c', 'd'], [{ rangeStart: 2, insertBefore: 0, rangeLength: 1 }]))
      .toEqual(['c', 'a', 'b', 'd'])
  })

  test('moving an item forwards accounts for the gap the removal leaves', () => {
    expect(applyMoveOps(['a', 'b', 'c', 'd'], [{ rangeStart: 0, insertBefore: 3, rangeLength: 1 }]))
      .toEqual(['b', 'c', 'a', 'd'])
  })

  test('insert_before equal to the length moves an item to the very end', () => {
    expect(applyMoveOps(['a', 'b', 'c'], [{ rangeStart: 0, insertBefore: 3, rangeLength: 1 }]))
      .toEqual(['b', 'c', 'a'])
  })

  test('moves a whole run when rangeLength exceeds one', () => {
    expect(applyMoveOps(['a', 'b', 'c', 'd'], [{ rangeStart: 0, insertBefore: 4, rangeLength: 2 }]))
      .toEqual(['c', 'd', 'a', 'b'])
  })
})

describe('buildMoveOps', () => {
  test('emits nothing when the playlist is already in target order', () => {
    expect(buildMoveOps(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([])
  })

  test('emits nothing for an empty playlist', () => {
    expect(buildMoveOps([], [])).toEqual([])
  })

  test('swapping two adjacent tracks costs one move, not two', () => {
    const ops = buildMoveOps(['a', 'b'], ['b', 'a'])
    expect(ops).toHaveLength(1)
    expect(applyMoveOps(['a', 'b'], ops)).toEqual(['b', 'a'])
  })

  test('reaches the target when the first track moves to the end', () => {
    const ops = buildMoveOps(['a', 'b', 'c', 'd'], ['b', 'c', 'd', 'a'])
    expect(applyMoveOps(['a', 'b', 'c', 'd'], ops)).toEqual(['b', 'c', 'd', 'a'])
  })

  test('reaches the target when the last track moves to the front', () => {
    const ops = buildMoveOps(['a', 'b', 'c', 'd'], ['d', 'a', 'b', 'c'])
    expect(ops).toHaveLength(1)
    expect(applyMoveOps(['a', 'b', 'c', 'd'], ops)).toEqual(['d', 'a', 'b', 'c'])
  })

  test('a full reversal still reaches the target', () => {
    const current = range(12)
    const target = [...current].reverse()
    expect(applyMoveOps(current, buildMoveOps(current, target))).toEqual(target)
  })

  test('rejects a target that is not a permutation of the playlist', () => {
    expect(() => buildMoveOps(['a', 'b'], ['a', 'b', 'c'])).toThrow(/permutation/i)
    expect(() => buildMoveOps(['a', 'b'], ['a', 'z'])).toThrow(/permutation/i)
  })

  test('rejects duplicate keys, which would make positions ambiguous', () => {
    expect(() => buildMoveOps(['a', 'a'], ['a', 'a'])).toThrow(/unique/i)
  })
})

describe('buildMoveOps — minimality', () => {
  // The whole reason for the LIS step: re-sorting a nearly-sorted playlist
  // must cost a handful of calls, not one per track.
  test('moving five tracks to the front of a hundred costs five moves', () => {
    const current = range(100)
    const target = [...range(100).slice(95), ...range(95)]
    const ops = buildMoveOps(current, target)
    expect(ops).toHaveLength(5)
    expect(applyMoveOps(current, ops)).toEqual(target)
  })

  test('a single displaced track in a large playlist costs one move', () => {
    const current = range(500)
    const target = [...range(500).filter((n) => n !== 400), 400]
    const ops = buildMoveOps(current, target)
    expect(ops).toHaveLength(1)
    expect(applyMoveOps(current, ops)).toEqual(target)
  })

  test('never emits more moves than there are tracks', () => {
    const rng = mulberry32(99)
    const current = range(60)
    const target = shuffled(current, rng)
    expect(buildMoveOps(current, target).length).toBeLessThan(current.length)
  })
})

describe('buildMoveOps — property: ops always reproduce the target', () => {
  // The strongest test in the codebase. Getting index arithmetic subtly wrong
  // scrambles a real playlist, and only randomized replay catches that.
  test('holds for 300 random permutations across a range of sizes', () => {
    const rng = mulberry32(20260909)
    for (let trial = 0; trial < 300; trial++) {
      const size = 1 + Math.floor(rng() * 40)
      const current = shuffled(range(size), rng)
      const target = shuffled(current, rng)
      const ops = buildMoveOps(current, target)
      const result = applyMoveOps(current, ops)
      expect({ trial, size, result }).toEqual({ trial, size, result: target })
    }
  })

  test('holds for a large playlist', () => {
    const rng = mulberry32(7)
    const current = range(1000)
    const target = shuffled(current, rng)
    expect(applyMoveOps(current, buildMoveOps(current, target))).toEqual(target)
  })

  test('leaves the input arrays untouched', () => {
    const current = ['a', 'b', 'c']
    const target = ['c', 'b', 'a']
    buildMoveOps(current, target)
    expect(current).toEqual(['a', 'b', 'c'])
    expect(target).toEqual(['c', 'b', 'a'])
  })
})

describe('neutral move ops', () => {
  test('names the key being moved and the key it lands in front of', () => {
    const ops = buildMoveOps(['A', 'B', 'C'], ['C', 'A', 'B'])
    expect(ops).toHaveLength(1)
    expect(ops[0].key).toBe('C')
    expect(ops[0].beforeKey).toBe('A')
  })

  test('beforeKey is null when a track moves to the end', () => {
    const ops = buildMoveOps(['A', 'B', 'C'], ['B', 'C', 'A'])
    expect(ops).toHaveLength(1)
    expect(ops[0].key).toBe('A')
    expect(ops[0].beforeKey).toBeNull()
  })

  // The index ops are already verified by randomised replay. This asserts the
  // neutral fields describe the SAME move, over the same random permutations,
  // by replaying them independently with splice-before-key semantics.
  test('replaying neutral ops reproduces the target, over 300 permutations', () => {
    const applyNeutral = (items, ops) => {
      const model = [...items]
      for (const { key, beforeKey } of ops) {
        model.splice(model.indexOf(key), 1)
        const at = beforeKey === null ? model.length : model.indexOf(beforeKey)
        model.splice(at, 0, key)
      }
      return model
    }

    const rng = mulberry32(7)
    for (let round = 0; round < 300; round++) {
      const size = 2 + Math.floor(rng() * 30)
      const current = range(size).map((i) => `k${i}`)
      const target = shuffled(current, rng)
      expect(applyNeutral(current, buildMoveOps(current, target))).toEqual(target)
    }
  })
})
