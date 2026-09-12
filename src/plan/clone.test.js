import { describe, expect, test, vi } from 'vitest'
import { makeTracks, makeUnavailable } from '../test/factory.js'
import { executeClone } from './clone.js'

function fakeClient() {
  const calls = []
  return {
    calls,
    post: vi.fn(async (path, options) => {
      calls.push({ path, body: options.body })
      return path.endsWith('/playlists') ? { id: 'new1', name: options.body.name } : {}
    }),
  }
}

const source = { id: 'p1', name: 'Road Trip' }

describe('executeClone', () => {
  test('creates a playlist named after the source and the strategy', async () => {
    const client = fakeClient()
    await executeClone({
      client,
      userId: 'u1',
      sourcePlaylist: source,
      targetTracks: makeTracks([{ name: 'a' }]),
      strategyLabel: 'Artist',
    })
    // Which endpoint serves the create is mutations' business, not the
    // clone flow's — asserted in mutations.test.js.
    expect(client.calls[0].body.name).toBe('Road Trip (sorted by Artist)')
  })

  test('records the source and strategy in the description', async () => {
    const client = fakeClient()
    await executeClone({
      client,
      userId: 'u1',
      sourcePlaylist: source,
      targetTracks: makeTracks([{ name: 'a' }]),
      strategyLabel: 'Artist',
    })
    expect(client.calls[0].body.description).toContain('Road Trip')
    expect(client.calls[0].body.description).toContain('Artist')
  })

  test('creates the clone private by default', async () => {
    const client = fakeClient()
    await executeClone({
      client,
      userId: 'u1',
      sourcePlaylist: source,
      targetTracks: makeTracks([{ name: 'a' }]),
      strategyLabel: 'Artist',
    })
    expect(client.calls[0].body.public).toBe(false)
  })

  test('adds tracks in the target order', async () => {
    const client = fakeClient()
    const tracks = makeTracks([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
    const result = await executeClone({
      client,
      userId: 'u1',
      sourcePlaylist: source,
      targetTracks: [tracks[2], tracks[0], tracks[1]],
      strategyLabel: 'Title',
    })
    expect(client.calls[1].body.uris).toEqual([tracks[2].uri, tracks[0].uri, tracks[1].uri])
    expect(result.added).toBe(3)
  })

  test('reports progress while adding', async () => {
    const client = fakeClient()
    const tracks = makeTracks(Array.from({ length: 150 }, (_, i) => ({ name: `t${i}` })))
    const seen = []
    await executeClone({
      client,
      userId: 'u1',
      sourcePlaylist: source,
      targetTracks: tracks,
      strategyLabel: 'Title',
      onProgress: (done, total) => seen.push([done, total]),
    })
    expect(seen).toEqual([[100, 150], [150, 150]])
  })
})

describe('tracks that cannot be cloned', () => {
  test('leaves out unavailable tracks and names them in the report', async () => {
    // A clone can legitimately be shorter than its source. That has to be
    // stated before the clone, not discovered afterwards.
    const client = fakeClient()
    const tracks = makeTracks([{ name: 'ok' }])
    const result = await executeClone({
      client,
      userId: 'u1',
      sourcePlaylist: source,
      targetTracks: [tracks[0], makeUnavailable(1)],
      strategyLabel: 'Title',
    })
    expect(client.calls[1].body.uris).toEqual([tracks[0].uri])
    expect(result.skipped.unavailable).toBe(1)
  })

  test('leaves out local files and names them in the report', async () => {
    const client = fakeClient()
    const tracks = makeTracks([
      { name: 'ok' },
      { name: 'local one', isLocal: true },
    ])
    const result = await executeClone({
      client,
      userId: 'u1',
      sourcePlaylist: source,
      targetTracks: tracks,
      strategyLabel: 'Title',
    })
    expect(result.skipped.localFiles).toBe(1)
    expect(result.skipped.names).toContain('local one')
  })

  test('reports the shortfall between source and clone', async () => {
    const client = fakeClient()
    const tracks = makeTracks([{ name: 'ok' }])
    const result = await executeClone({
      client,
      userId: 'u1',
      sourcePlaylist: source,
      targetTracks: [tracks[0], makeUnavailable(1), makeUnavailable(2)],
      strategyLabel: 'Title',
    })
    expect(result.requested).toBe(3)
    expect(result.added).toBe(1)
  })
})

describe('dry run', () => {
  test('creates nothing and sends nothing', async () => {
    const client = fakeClient()
    await executeClone({
      client,
      userId: 'u1',
      sourcePlaylist: source,
      targetTracks: makeTracks([{ name: 'a' }]),
      strategyLabel: 'Title',
      dryRun: true,
    })
    expect(client.post).not.toHaveBeenCalled()
  })

  test('still reports what would be added and skipped', async () => {
    const client = fakeClient()
    const tracks = makeTracks([{ name: 'a' }])
    const result = await executeClone({
      client,
      userId: 'u1',
      sourcePlaylist: source,
      targetTracks: [tracks[0], makeUnavailable(1)],
      strategyLabel: 'Title',
      dryRun: true,
    })
    expect(result.added).toBe(0)
    expect(result.wouldAdd).toBe(1)
    expect(result.skipped.unavailable).toBe(1)
  })
})
