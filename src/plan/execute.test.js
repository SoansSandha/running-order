import { describe, expect, test, vi } from 'vitest'
import { makeTracks } from '../test/factory.js'
import { executeReorder } from './execute.js'

function fakeWriter({ failAt = -1 } = {}) {
  const calls = []
  return {
    calls,
    reorder: vi.fn(async (playlistId, op, revision) => {
      calls.push({ playlistId, op, revision })
      if (calls.length === failAt) throw new Error('Spotify said no')
      return `snap-${calls.length}`
    }),
  }
}

const playlist = (n) => makeTracks(Array.from({ length: n }, (_, i) => ({ name: `t${i}` })))

describe('executeReorder', () => {
  test('sends nothing when the playlist is already in target order', async () => {
    const writer = fakeWriter()
    const tracks = playlist(4)
    const result = await executeReorder({
      writer,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: tracks,
      snapshotId: 'snap-0',
    })
    expect(writer.calls).toHaveLength(0)
    expect(result.applied).toBe(0)
  })

  test('issues one request per move', async () => {
    const writer = fakeWriter()
    const tracks = playlist(4)
    const target = [tracks[3], tracks[0], tracks[1], tracks[2]]
    const result = await executeReorder({
      writer,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: target,
      snapshotId: 'snap-0',
    })
    expect(writer.calls).toHaveLength(1)
    expect(result.applied).toBe(1)
  })

  test('threads each returned snapshot id into the following call', async () => {
    // Spotify rejects a reorder quoting a stale snapshot, so this chain is
    // not optional.
    const writer = fakeWriter()
    const tracks = playlist(5)
    const target = [tracks[4], tracks[3], tracks[0], tracks[1], tracks[2]]
    await executeReorder({
      writer,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: target,
      snapshotId: 'snap-0',
    })
    expect(writer.calls[0].revision).toBe('snap-0')
    expect(writer.calls[1].revision).toBe('snap-1')
  })

  test('returns the final snapshot id for the caller to keep', async () => {
    const writer = fakeWriter()
    const tracks = playlist(3)
    const result = await executeReorder({
      writer,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: [tracks[2], tracks[0], tracks[1]],
      snapshotId: 'snap-0',
    })
    expect(result.snapshotId).toBe(`snap-${writer.calls.length}`)
  })

  test('reports progress after each move', async () => {
    const writer = fakeWriter()
    const tracks = playlist(5)
    const target = [tracks[4], tracks[3], tracks[0], tracks[1], tracks[2]]
    const seen = []
    await executeReorder({
      writer,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: target,
      snapshotId: 'snap-0',
      onProgress: (done, total) => seen.push([done, total]),
    })
    expect(seen).toEqual([[1, 2], [2, 2]])
  })

  test('ends with the playlist actually in target order', async () => {
    const writer = fakeWriter()
    const tracks = playlist(9)
    const target = [...tracks].reverse()
    const result = await executeReorder({
      writer,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: target,
      snapshotId: 'snap-0',
    })
    expect(result.finalOrder.map((t) => t.name)).toEqual(target.map((t) => t.name))
  })
})

describe('dry run', () => {
  test('sends no requests at all', async () => {
    const writer = fakeWriter()
    const tracks = playlist(6)
    await executeReorder({
      writer,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: [...tracks].reverse(),
      snapshotId: 'snap-0',
      dryRun: true,
    })
    expect(writer.reorder).not.toHaveBeenCalled()
  })

  test('still returns the operations it would have sent', async () => {
    const writer = fakeWriter()
    const tracks = playlist(6)
    const result = await executeReorder({
      writer,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: [...tracks].reverse(),
      snapshotId: 'snap-0',
      dryRun: true,
    })
    expect(result.ops.length).toBeGreaterThan(0)
    expect(result.applied).toBe(0)
  })
})

describe('cancellation', () => {
  test('stops after the in-flight move and reports how many were applied', async () => {
    const writer = fakeWriter()
    const controller = new AbortController()
    const tracks = playlist(10)
    const target = [...tracks].reverse()

    const result = await executeReorder({
      writer,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: target,
      snapshotId: 'snap-0',
      signal: controller.signal,
      onProgress: (done) => { if (done === 2) controller.abort() },
    })

    expect(result.cancelled).toBe(true)
    expect(result.applied).toBe(2)
    expect(writer.calls).toHaveLength(2)
  })

  test('leaves a usable snapshot id behind, since a half-sorted playlist is still valid', async () => {
    const writer = fakeWriter()
    const controller = new AbortController()
    const tracks = playlist(10)
    const result = await executeReorder({
      writer,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: [...tracks].reverse(),
      snapshotId: 'snap-0',
      signal: controller.signal,
      onProgress: (done) => { if (done === 1) controller.abort() },
    })
    expect(result.snapshotId).toBe('snap-1')
  })
})

describe('failure', () => {
  test('reports how many moves landed before the error, so undo is possible', async () => {
    const writer = fakeWriter({ failAt: 3 })
    const tracks = playlist(10)
    await expect(
      executeReorder({
        writer,
        playlistId: 'p1',
        currentTracks: tracks,
        targetTracks: [...tracks].reverse(),
        snapshotId: 'snap-0',
      }),
    ).rejects.toMatchObject({ applied: 2, snapshotId: 'snap-2' })
  })
})

describe('keyOf', () => {
  test('defaults to originalIndex', async () => {
    const writer = fakeWriter()
    const tracks = playlist(4)
    await executeReorder({
      writer,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: [tracks[3], tracks[0], tracks[1], tracks[2]],
      snapshotId: 'snap-0',
    })
    expect(writer.calls[0].op.key).toBe(3)
  })

  test('uses the supplied key when one is given', async () => {
    const writer = fakeWriter()
    const tracks = playlist(4).map((track, i) => ({ ...track, itemId: `sv-${i}` }))
    await executeReorder({
      writer,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: [tracks[3], tracks[0], tracks[1], tracks[2]],
      snapshotId: 'snap-0',
      keyOf: (track) => track.itemId,
    })
    expect(writer.calls[0].op.key).toBe('sv-3')
    expect(writer.calls[0].op.beforeKey).toBe('sv-0')
  })

  test('refuses a key function that yields duplicates', async () => {
    const writer = fakeWriter()
    const tracks = playlist(3)
    await expect(
      executeReorder({
        writer,
        playlistId: 'p1',
        currentTracks: tracks,
        targetTracks: [tracks[2], tracks[0], tracks[1]],
        snapshotId: 'snap-0',
        keyOf: () => 'same',
      }),
    ).rejects.toThrow(/unique/)
  })
})
