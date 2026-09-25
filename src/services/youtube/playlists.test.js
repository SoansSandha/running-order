import { describe, expect, test } from 'vitest'
import { toAppPlaylists } from './playlists.js'

const RAW = [
  { id: 'LM', title: 'Liked Music', count: null },
  { id: 'PL123', title: 'punjabi songs', count: 386 },
  { id: 'SE', title: 'Episodes for Later', count: null },
]

describe('toAppPlaylists', () => {
  test('maps a real playlist onto the shape the UI renders', () => {
    const [pl] = toAppPlaylists([RAW[1]])
    expect(pl.id).toBe('PL123')
    expect(pl.name).toBe('punjabi songs')
    expect(pl.trackCount).toBe(386)
    expect(pl.editable).toBe(true)
    expect(pl.source).toBe('youtube')
  })

  test('carries an owner so the UI does not read undefined', () => {
    // Playlists.jsx renders item.owner.displayName unguarded.
    const [pl] = toAppPlaylists([RAW[1]])
    expect(pl.owner).toEqual({ id: null, displayName: 'YouTube Music' })
  })

  test('drops the system pseudo-playlists', () => {
    // LM and SE are YouTube's own lists. They cannot be reordered, and
    // showing them as "Clone only" would promise a clone we cannot perform.
    expect(toAppPlaylists(RAW).map((p) => p.id)).toEqual(['PL123'])
  })

  test('has no snapshot id, because YouTube has no such concept', () => {
    expect(toAppPlaylists([RAW[1]])[0].snapshotId).toBeNull()
  })

  test('survives a null count on a non-system playlist', () => {
    const [pl] = toAppPlaylists([{ id: 'PL9', title: 'x', count: null }])
    expect(pl.trackCount).toBe(0)
  })

  test('returns an empty array for no input', () => {
    expect(toAppPlaylists(null)).toEqual([])
  })
})
