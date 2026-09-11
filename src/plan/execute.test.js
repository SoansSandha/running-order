import { describe, expect, test, vi } from 'vitest'
import { makeTracks } from '../test/factory.js'
import { executeReorder } from './execute.js'

function fakeClient({ failAt = -1 } = {}) {
  const calls = []
  return {
    calls,
    put: vi.fn(async (path, options) => {
      calls.push({ path, body: options.body })
      if (calls.length === failAt) throw new Error('Spotify said no')
      return { snapshot_id: `snap-${calls.length}` }
    }),
  }
}

const playlist = (n) => makeTracks(Array.from({ length: n }, (_, i) => ({ name: `t${i}` })))

describe('executeReorder', () => {
  test('sends nothing when the playlist is already in target order', async () => {
    const client = fakeClient()
    const tracks = playlist(4)
    const result = await executeReorder({
      client,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: tracks,
      snapshotId: 'snap-0',
    })
    expect(client.calls).toHaveLength(0)
    expect(result.applied).toBe(0)
  })

  test('issues one request per move', async () => {
    const client = fakeClient()
    const tracks = playlist(4)
    const target = [tracks[3], tracks[0], tracks[1], tracks[2]]
    const result = await executeReorder({
      client,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: target,
      snapshotId: 'snap-0',
    })
    expect(client.calls).toHaveLength(1)
    expect(result.applied).toBe(1)
  })

  test('threads each returned snapshot id into the following call', async () => {
    // Spotify rejects a reorder quoting a stale snapshot, so this chain is
    // not optional.
    const client = fakeClient()
    const tracks = playlist(5)
    const target = [tracks[4], tracks[3], tracks[0], tracks[1], tracks[2]]
    await executeReorder({
      client,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: target,
      snapshotId: 'snap-0',
    })
    expect(client.calls[0].body.snapshot_id).toBe('snap-0')
    expect(client.calls[1].body.snapshot_id).toBe('snap-1')
  })

  test('returns the final snapshot id for the caller to keep', async () => {
    const client = fakeClient()
    const tracks = playlist(3)
    const result = await executeReorder({
      client,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: [tracks[2], tracks[0], tracks[1]],
      snapshotId: 'snap-0',
    })
    expect(result.snapshotId).toBe(`snap-${client.calls.length}`)
  })

  test('reports progress after each move', async () => {
    const client = fakeClient()
    const tracks = playlist(5)
    const target = [tracks[4], tracks[3], tracks[0], tracks[1], tracks[2]]
    const seen = []
    await executeReorder({
      client,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: target,
      snapshotId: 'snap-0',
      onProgress: (done, total) => seen.push([done, total]),
    })
    expect(seen).toEqual([[1, 2], [2, 2]])
  })

  test('ends with the playlist actually in target order', async () => {
    const client = fakeClient()
    const tracks = playlist(9)
    const target = [...tracks].reverse()
    const result = await executeReorder({
      client,
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
    const client = fakeClient()
    const tracks = playlist(6)
    await executeReorder({
      client,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: [...tracks].reverse(),
      snapshotId: 'snap-0',
      dryRun: true,
    })
    expect(client.put).not.toHaveBeenCalled()
  })

  test('still returns the operations it would have sent', async () => {
    const client = fakeClient()
    const tracks = playlist(6)
    const result = await executeReorder({
      client,
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
    const client = fakeClient()
    const controller = new AbortController()
    const tracks = playlist(10)
    const target = [...tracks].reverse()

    const result = await executeReorder({
      client,
      playlistId: 'p1',
      currentTracks: tracks,
      targetTracks: target,
      snapshotId: 'snap-0',
      signal: controller.signal,
      onProgress: (done) => { if (done === 2) controller.abort() },
    })

    expect(result.cancelled).toBe(true)
    expect(result.applied).toBe(2)
    expect(client.calls).toHaveLength(2)
  })

  test('leaves a usable snapshot id behind, since a half-sorted playlist is still valid', async () => {
    const client = fakeClient()
    const controller = new AbortController()
    const tracks = playlist(10)
    const result = await executeReorder({
      client,
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
    const client = fakeClient({ failAt: 3 })
    const tracks = playlist(10)
    await expect(
      executeReorder({
        client,
        playlistId: 'p1',
        currentTracks: tracks,
        targetTracks: [...tracks].reverse(),
        snapshotId: 'snap-0',
      }),
    ).rejects.toMatchObject({ applied: 2, snapshotId: 'snap-2' })
  })
})
