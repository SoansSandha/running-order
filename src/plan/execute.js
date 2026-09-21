/**
 * Walks a move plan against the live playlist.
 *
 * See docs design §8 and §9. Writes are strictly sequential: each reorder
 * returns a snapshot id the next call must quote, so these cannot be
 * parallelised however slow that makes a large sort.
 */

import { reorderTrack } from '../services/spotify/mutations.js'
import { applyMoveOps, buildMoveOps } from './diff.js'

/**
 * Carries how far the reorder got. A partially sorted playlist is still a
 * valid playlist, and the caller needs the applied count and the live
 * snapshot id to offer undo.
 */
export class ReorderFailure extends Error {
  constructor(message, { applied, snapshotId, ops, cause }) {
    super(message, { cause })
    this.name = 'ReorderFailure'
    this.applied = applied
    this.snapshotId = snapshotId
    this.ops = ops
  }
}

/**
 * @param {object} args
 * @param {object} args.client        api client
 * @param {string} args.playlistId
 * @param {Array}  args.currentTracks normalized Tracks, current order
 * @param {Array}  args.targetTracks  the same Tracks, desired order
 * @param {string} args.snapshotId    the playlist's snapshot id right now
 * @param {(done: number, total: number) => void} [args.onProgress]
 * @param {AbortSignal} [args.signal]
 * @param {boolean} [args.dryRun]     compute the plan, send nothing
 */
export async function executeReorder({
  client,
  playlistId,
  currentTracks,
  targetTracks,
  snapshotId,
  onProgress,
  signal,
  dryRun = false,
}) {
  // originalIndex, never URI: a playlist may hold the same URI several times,
  // and positions must stay unambiguous.
  const currentKeys = currentTracks.map((track) => track.originalIndex)
  const targetKeys = targetTracks.map((track) => track.originalIndex)
  const ops = buildMoveOps(currentKeys, targetKeys)

  if (dryRun) {
    return {
      ops,
      applied: 0,
      snapshotId,
      cancelled: false,
      finalOrder: reorderByKeys(currentTracks, applyMoveOps(currentKeys, ops)),
    }
  }

  let mirror = [...currentKeys]
  let liveSnapshot = snapshotId
  let applied = 0

  for (const op of ops) {
    if (signal?.aborted) {
      return {
        ops,
        applied,
        snapshotId: liveSnapshot,
        cancelled: true,
        finalOrder: reorderByKeys(currentTracks, mirror),
      }
    }

    try {
      const next = await reorderTrack(client, playlistId, op, liveSnapshot)
      if (next) liveSnapshot = next
    } catch (cause) {
      throw new ReorderFailure(
        `Reorder stopped after ${applied} of ${ops.length} moves: ${cause.message}`,
        { applied, snapshotId: liveSnapshot, ops, cause },
      )
    }

    // Keep the local model in lockstep with the server, so every subsequent
    // op is computed against what the playlist actually looks like now.
    mirror = applyMoveOps(mirror, [op])
    applied += 1
    onProgress?.(applied, ops.length)
  }

  return {
    ops,
    applied,
    snapshotId: liveSnapshot,
    cancelled: false,
    finalOrder: reorderByKeys(currentTracks, mirror),
  }
}

function reorderByKeys(tracks, keys) {
  const byKey = new Map(tracks.map((track) => [track.originalIndex, track]))
  return keys.map((key) => byKey.get(key))
}
