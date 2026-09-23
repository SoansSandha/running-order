/**
 * Walks a move plan against the live playlist.
 *
 * See docs design §8 and §9. Writes are strictly sequential: each reorder
 * returns a snapshot id the next call must quote, so these cannot be
 * parallelised however slow that makes a large sort.
 */

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
 * @param {object} args.writer        service writer (see the Spotify writer module)
 * @param {string} args.playlistId
 * @param {Array}  args.currentTracks normalized Tracks, current order
 * @param {Array}  args.targetTracks  the same Tracks, desired order
 * @param {string} args.snapshotId    the playlist's snapshot id right now
 * @param {(track: object) => any} [args.keyOf] per-item identity; must be unique
 * @param {(done: number, total: number) => void} [args.onProgress]
 * @param {AbortSignal} [args.signal]
 * @param {boolean} [args.dryRun]     compute the plan, send nothing
 */
export async function executeReorder({
  writer,
  playlistId,
  currentTracks,
  targetTracks,
  snapshotId,
  keyOf = (track) => track.originalIndex,
  onProgress,
  signal,
  dryRun = false,
}) {
  // originalIndex by default, never URI: a playlist may hold the same URI
  // several times, and positions must stay unambiguous. A service whose items
  // carry their own stable per-item id passes `keyOf` to use that instead —
  // YouTube's setVideoId, measured unique across a real 379-track playlist.
  const currentKeys = currentTracks.map(keyOf)
  const targetKeys = targetTracks.map(keyOf)
  const ops = buildMoveOps(currentKeys, targetKeys)

  if (dryRun) {
    return {
      ops,
      applied: 0,
      snapshotId,
      cancelled: false,
      finalOrder: reorderByKeys(currentTracks, applyMoveOps(currentKeys, ops), keyOf),
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
        finalOrder: reorderByKeys(currentTracks, mirror, keyOf),
      }
    }

    try {
      const next = await writer.reorder(playlistId, op, liveSnapshot)
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
    finalOrder: reorderByKeys(currentTracks, mirror, keyOf),
  }
}

function reorderByKeys(tracks, keys, keyOf) {
  const byKey = new Map(tracks.map((track) => [keyOf(track), track]))
  return keys.map((key) => byKey.get(key))
}
