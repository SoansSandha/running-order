/**
 * Read operations: the current user, their playlists, and a playlist's tracks.
 *
 * See docs design §5.4.
 */

import { normalizePlaylistItem } from '../model/track.js'
import { playlistItemsPath, playlistTrackCount } from './endpoints.js'

const PLAYLIST_PAGE_SIZE = 50
const TRACK_PAGE_SIZE = 100

/**
 * Only the fields the Track model actually reads. Spotify returns a very large
 * object per track otherwise, and playlists run to thousands of them.
 */
const TRACK_FIELDS = [
  'total',
  'next',
  'items(added_at,is_local,track(id,uri,name,type,duration_ms,popularity,explicit,' +
    'track_number,disc_number,external_ids(isrc),artists(id,name),show(id,name),' +
    'album(id,name,release_date,release_date_precision)))',
].join(',')

/** Walk a paginated Spotify collection to the end. */
export async function fetchAllPages(client, path, { query, onProgress } = {}) {
  const items = []
  let nextPath = path
  let nextQuery = query

  while (nextPath) {
    const page = await client.get(nextPath, nextQuery ? { query: nextQuery } : undefined)
    items.push(...(page?.items ?? []))
    onProgress?.(items.length, page?.total ?? items.length)
    // `next` is an absolute URL that already carries its own paging params.
    nextPath = page?.next ?? null
    nextQuery = undefined
  }

  return items
}

export async function getCurrentUser(client) {
  const me = await client.get('/me')
  return {
    id: me.id,
    displayName: me.display_name || me.id,
    imageUrl: me.images?.[0]?.url ?? null,
  }
}

/**
 * Every playlist on the user's shelf, flagged with whether we may write to it.
 * Read-only ones stay in the list so they can still be cloned.
 */
export async function listEditablePlaylists(client, currentUserId, { onProgress } = {}) {
  const raw = await fetchAllPages(client, '/me/playlists', {
    query: { limit: PLAYLIST_PAGE_SIZE },
    onProgress,
  })

  return raw.filter(Boolean).map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description ?? '',
    imageUrl: item.images?.[0]?.url ?? null,
    trackCount: playlistTrackCount(item),
    owner: { id: item.owner?.id ?? null, displayName: item.owner?.display_name || item.owner?.id || '' },
    collaborative: item.collaborative === true,
    isPublic: item.public === true,
    snapshotId: item.snapshot_id ?? null,
    editable: item.owner?.id === currentUserId || item.collaborative === true,
  }))
}

/** The playlist's current snapshot id, re-read immediately before any write. */
export async function getPlaylistSnapshot(client, playlistId) {
  const playlist = await client.get(`/playlists/${playlistId}`, { query: { fields: 'snapshot_id' } })
  return playlist?.snapshot_id ?? null
}

export async function fetchPlaylistTracks(client, playlistId, { onProgress } = {}) {
  const items = await fetchAllPages(client, playlistItemsPath(playlistId), {
    query: { limit: TRACK_PAGE_SIZE, fields: TRACK_FIELDS },
    onProgress,
  })
  return items.map((item, index) => normalizePlaylistItem(item, index))
}
