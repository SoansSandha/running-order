import { describe, expect, test, vi } from 'vitest'
import { executeReorder } from '../../plan/execute.js'
import { makeYouTubeTracks } from '../../test/factory.js'
import { createYouTubeWriter } from './writer.js'

/** A proxy client over an in-memory playlist, moving items as edit_playlist does. */
function fakeClient(items = []) {
  const state = { items: [...items] }
  return {
    state,
    moveItem: vi.fn(async (playlistId, setVideoId, beforeSetVideoId) => {
      const moving = state.items.find((item) => item.setVideoId === setVideoId)
      const rest = state.items.filter((item) => item !== moving)
      const at = beforeSetVideoId === null ? rest.length : rest.findIndex((item) => item.setVideoId === beforeSetVideoId)
      state.items = [...rest.slice(0, at), moving, ...rest.slice(at)]
    }),
    addItems: vi.fn(async (playlistId, videoIds) => videoIds.map((videoId) => ({ videoId, setVideoId: `new-${videoId}` }))),
    removeItems: vi.fn(async () => {}),
  }
}

describe('createYouTubeWriter', () => {
  test('a move sends the neutral form: this item, before that one', async () => {
    const client = fakeClient()
    await createYouTubeWriter(client).reorder(
      'PL1',
      { rangeStart: 3, insertBefore: 0, rangeLength: 1, key: 's3', beforeKey: 's0' },
      null,
    )
    expect(client.moveItem).toHaveBeenCalledWith('PL1', 's3', 's0')
  })

  test('executeReorder keyed by item id puts the playlist in the target order', async () => {
    const tracks = makeYouTubeTracks([{ videoId: 'a' }, { videoId: 'b' }, { videoId: 'c' }, { videoId: 'd' }])
    const client = fakeClient(tracks.map((track) => ({ videoId: track.id, setVideoId: track.itemId })))
    await executeReorder({
      writer: createYouTubeWriter(client),
      playlistId: 'PL1',
      currentTracks: tracks,
      targetTracks: [tracks[2], tracks[0], tracks[3], tracks[1]],
      snapshotId: null,
      keyOf: (track) => track.itemId,
    })
    expect(client.state.items.map((item) => item.videoId)).toEqual(['c', 'a', 'd', 'b'])
  })

  test('an add sends the tracks’ video ids and answers the ids they were given', async () => {
    const client = fakeClient()
    const added = await createYouTubeWriter(client).addTracks('PL1', makeYouTubeTracks([{ videoId: 'a' }, { videoId: 'b' }]))
    expect(added).toEqual([
      { videoId: 'a', setVideoId: 'new-a' },
      { videoId: 'b', setVideoId: 'new-b' },
    ])
    expect(client.addItems).toHaveBeenCalledWith('PL1', ['a', 'b'])
  })

  test('a removal sends only the two ids of each item', async () => {
    const client = fakeClient()
    await createYouTubeWriter(client).removeTracks('PL1', [{ videoId: 'a', setVideoId: 'sa', extra: 'x' }])
    expect(client.removeItems).toHaveBeenCalledWith('PL1', [{ videoId: 'a', setVideoId: 'sa' }])
  })
})
