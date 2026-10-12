/**
 * The mirror run and its undo (docs/2026-10-11-mirror-run-design.md §5–6).
 *
 * Everything that touches a service is injected — two readers and two
 * writers — and so is where the undo record goes, so the whole sequence
 * tests against fakes. Requests go one at a time, and Stop is honoured
 * between them.
 */

import { executeReorder, ReorderFailure } from './execute.js'
import { mirrorOrder, planFill, sameItems, settleFromBook } from './mirror.js'
import { buildRestoreOrder, startMirrorRecord } from './undo.js'

/** Spotify's limit per request. */
export const SPOTIFY_CHUNK = 100
/** Not published by YouTube; the probe measured 50 accepted and answered (§9). */
export const YOUTUBE_CHUNK = 50
/**
 * A read shows a move about 5s after it (§9). The check makes 5 reads with 4
 * waits of 2s between them: 8s of waiting, about 15s with the time the reads
 * themselves took (§9 measured them), so it outlasts the passing state.
 */
const CHECK_READS = 5
const CHECK_WAIT_MS = 2000
/** How many times a settled read tries for two equal reads in a row. */
const SETTLE_TRIES = 3
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const byUri = (track) => track.uri
const byItem = (track) => track.itemId

/** A run or an undo that stopped on an error. `report` says how far it got. */
export class MirrorFailure extends Error {
  constructor(message, { report, cause } = {}) {
    super(message, { cause })
    this.name = 'MirrorFailure'
    this.report = report
  }
}

/**
 * @param {object} args
 * @param {string} args.spotifyPlaylistId
 * @param {string} args.youtubePlaylistId
 * @param {boolean} args.spotifyEditable whether the owner may add to the Spotify playlist
 * @param {() => Promise<Array>} args.readSpotify the Spotify playlist's Tracks, as it is now
 * @param {() => Promise<Array>} args.readYoutube the YouTube playlist's Tracks, as it is now
 * @param {object} args.spotifyWriter
 * @param {object} args.youtubeWriter
 * @param {Array} args.book the match book
 * @param {{spotifyTracks: Array, youtubeTracks: Array}} args.previewed what the preview was built from
 * @param {boolean} [args.reorder] D51's toggle
 * @param {object|null} [args.priorRecord] the undo record held now, if any
 * @param {(record: object) => void} args.onRecord every new state of the undo record
 * @param {(phase: string, done?: number, total?: number) => void} [args.onPhase]
 * @param {AbortSignal} [args.signal]
 * @param {(ms: number) => Promise<void>} [args.sleep] the wait between the check's reads
 */
export async function executeMirror({
  spotifyPlaylistId,
  youtubePlaylistId,
  spotifyEditable,
  readSpotify,
  readYoutube,
  spotifyWriter,
  youtubeWriter,
  book,
  previewed,
  reorder = true,
  priorRecord = null,
  onRecord,
  onPhase,
  signal,
  sleep = defaultSleep,
}) {
  const report = { addedToSpotify: 0, addedToYoutube: 0, applied: 0, total: 0 }
  const stopped = () => signal?.aborted === true
  const halt = () => ({ kind: 'stopped', ...report, matches: null, unpaired: [] })

  // 1. Guard: write nothing into a playlist that moved since the preview.
  onPhase?.('guard')
  const [spotifyNow, youtubeNow] = await Promise.all([readSpotify(), readYoutube()])
  if (
    !sameItems(previewed.spotifyTracks, spotifyNow, byUri) ||
    !sameItems(previewed.youtubeTracks, youtubeNow, byItem)
  ) {
    return { kind: 'stale' }
  }
  const fill = planFill(settleFromBook(spotifyNow, youtubeNow, book))
  // The panel refuses both of these first, but no write path may assume it
  // was only ever reached from a lit lever.
  if (fill.blocked > 0) throw new MirrorFailure(`Settle ${fill.blocked} more songs first.`, { report })
  if (fill.addToSpotify.length > 0 && !spotifyEditable) {
    throw new MirrorFailure('This Spotify playlist isn’t yours to add to.', { report })
  }

  // 2. The undo record, saved before the first write (§6, D54).
  let record = startMirrorRecord(priorRecord, { youtubePlaylistId, spotifyPlaylistId, youtubeTracks: youtubeNow })
  onRecord(record)

  try {
    // 3. Spotify's additions go to its end (D49). Each chunk is recorded
    // before its request, so one that lands but loses its answer is still
    // undone; removing a URI Spotify does not hold does nothing.
    for (const chunk of chunksOf(fill.addToSpotify, SPOTIFY_CHUNK)) {
      if (stopped()) return halt()
      onPhase?.('addingSpotify', report.addedToSpotify, fill.addToSpotify.length)
      record = { ...record, addedToSpotify: [...record.addedToSpotify, ...chunk.map(byUri)] }
      onRecord(record)
      await spotifyWriter.addTracks(spotifyPlaylistId, chunk)
      report.addedToSpotify += chunk.length
    }

    // 4. YouTube's land wherever YouTube puts them; step 6 orders them. Each
    // chunk is recorded ahead as placeholders, which Undo resolves by videoId,
    // and the answer replaces them with the item ids YouTube gave.
    const landedIds = new Set()
    const landedItems = new Set()
    for (const chunk of chunksOf(fill.addToYoutube, YOUTUBE_CHUNK)) {
      if (stopped()) return halt()
      onPhase?.('addingYoutube', report.addedToYoutube, fill.addToYoutube.length)
      const ahead = chunk.map((track) => ({ videoId: track.id, setVideoId: null }))
      // This chunk's placeholders are known by identity, not by videoId.
      const settle = (entries) => {
        const others = record.addedToYoutube.filter((entry) => !ahead.includes(entry))
        record = { ...record, addedToYoutube: [...others, ...entries] }
        onRecord(record)
      }
      settle(ahead)
      let landed
      try {
        landed = await youtubeWriter.addTracks(youtubePlaylistId, chunk)
      } catch (cause) {
        // A refusal added nothing, and may mean one video was already there:
        // a placeholder for it would let Undo take the owner's copy.
        if (cause?.nothingAdded === true) settle([])
        throw cause
      }
      const answered = new Set(landed.map(({ videoId }) => videoId))
      for (const videoId of answered) landedIds.add(videoId)
      for (const { setVideoId } of landed) landedItems.add(setVideoId)
      settle([
        ...landed.map(({ videoId, setVideoId }) => ({ videoId, setVideoId })),
        ...ahead.filter((entry) => !answered.has(entry.videoId)),
      ])
      report.addedToYoutube += chunk.length
    }
    if (stopped()) return halt()

    // 5. Re-read both and pair again. Every move below names an item id read
    // after the adds, never one from before them (mirror design §10).
    onPhase?.('reading')
    // A bulk add can show late (§9): wait for every item the adds answered.
    // Spotify reads are consistent, so it is read once.
    const spotifyAfter = await readSpotify()
    const youtubeAfter = await readUntil(readYoutube, sleep, (tracks) => {
      const shown = new Set(tracks.map(byItem))
      return [...landedItems].every((id) => shown.has(id))
    })
    const settled = settleFromBook(spotifyAfter, youtubeAfter, book)
    const target = mirrorOrder(spotifyAfter, youtubeAfter, settled.pairs)
    const addedUris = new Set(fill.addToSpotify.map(byUri))
    const unpaired = [
      ...settled.unmatchedSpotify.filter((track) => addedUris.has(track.uri)),
      ...settled.unmatchedYoutube.filter((track) => landedIds.has(track.id)),
    ]

    // 6. Reorder (D51's toggle), one move per request; then 7, check (D53).
    let matches = null
    if (reorder) {
      // Undo restores the order only after a run that changed it (F3).
      record = { ...record, reordered: true }
      onRecord(record)
      onPhase?.('moving', 0, 0)
      const moved = await executeReorder({
        writer: youtubeWriter,
        playlistId: youtubePlaylistId,
        currentTracks: youtubeAfter,
        targetTracks: target,
        snapshotId: null,
        keyOf: byItem,
        signal,
        onProgress: (done, total) => {
          report.applied = done
          report.total = total
          onPhase?.('moving', done, total)
        },
      })
      report.applied = moved.applied
      report.total = moved.ops.length
      if (moved.cancelled) return halt()

      // A read just after a move can show a passing state (§9), so the order
      // is called different only once no read in about 10s matches.
      onPhase?.('verifying')
      // Stop ends the check, and so does a read that throws: every write has
      // landed, so neither fails the run. The order is then simply not known.
      matches = false
      for (let read = 0; read < CHECK_READS && !matches; read += 1) {
        if (stopped()) {
          matches = null
          break
        }
        if (read > 0) await sleep(CHECK_WAIT_MS)
        if (stopped()) {
          matches = null
          break
        }
        try {
          matches = sameItems(target, await readYoutube(), byItem)
        } catch {
          matches = null
          break
        }
      }
    }

    record = { ...record, finished: true }
    onRecord(record)
    return { kind: 'done', ...report, matches, unpaired }
  } catch (cause) {
    throw failure(`Added ${report.addedToYoutube} to YouTube and ${report.addedToSpotify} to Spotify.`, report, cause)
  }
}

/**
 * Undo the last run (§6): remove what it added, then put YouTube's order
 * back. Each removal leaves the record once it is done (on YouTube, once a
 * read shows it), so a stopped or failed undo can be pressed again and
 * reaches only what is left.
 */
export async function undoMirror({
  record,
  readYoutube,
  spotifyWriter,
  youtubeWriter,
  onRecord,
  onPhase,
  signal,
  sleep = defaultSleep,
}) {
  const report = { removedFromYoutube: 0, removedFromSpotify: 0, applied: 0, total: 0 }
  const stopped = () => signal?.aborted === true
  const halt = () => ({ kind: 'undoStopped', ...report })
  let current = record
  const keep = (next) => {
    current = next
    onRecord(next)
  }

  try {
    // 1. YouTube: only what the run recorded adding, so nothing of the
    // owner's is touched (D17). The read after each removal checks that its
    // items are gone (F2), and only then do they leave the record: a failed
    // check, or a read that throws, leaves the chunk to undo again.
    onPhase?.('removingYoutube', 0, current.addedToYoutube.length)
    // A read just after a move can leave the moved item out (§9), and an Undo
    // can start right after a stopped or failed reorder: read only settled
    // reads, or that item would be called gone and dropped from the record.
    let youtubeNow = await settledRead(readYoutube, sleep)
    for (;;) {
      const { found, gone } = resolveAdditions(youtubeNow, current.addedToYoutube)
      if (gone.length > 0) {
        keep({ ...current, addedToYoutube: current.addedToYoutube.filter((entry) => !gone.includes(entry)) })
      }
      if (found.length === 0) break
      if (stopped()) return halt()
      const total = report.removedFromYoutube + found.length
      const chunk = found.slice(0, YOUTUBE_CHUNK)
      await youtubeWriter.removeTracks(current.youtubePlaylistId, chunk.map(({ item }) => item))
      // A bulk removal can show late (§9): read until none of the chunk is left.
      let kept = 0
      youtubeNow = await readUntil(readYoutube, sleep, (tracks) => {
        const left = new Set(tracks.map(byItem))
        kept = chunk.filter(({ item }) => left.has(item.setVideoId)).length
        return kept === 0
      })
      if (kept > 0) {
        throw new MirrorFailure(`YouTube Music kept ${kept} of the songs Undo removed. Undo again to retry.`)
      }
      const removed = chunk.map(({ entry }) => entry)
      keep({ ...current, addedToYoutube: current.addedToYoutube.filter((entry) => !removed.includes(entry)) })
      report.removedFromYoutube += chunk.length
      onPhase?.('removingYoutube', report.removedFromYoutube, total)
    }

    // 2. Spotify.
    // ponytail: Spotify removes every copy of a URI, so a copy the owner added
    // by hand after the run goes too. Exact removal needs Spotify positions.
    // Write-ahead can list a URI twice: recorded for a request that failed,
    // then again when a rerun adds it.
    const uris = [...new Set(current.addedToSpotify)]
    const spotifyTotal = uris.length
    for (const chunk of chunksOf(uris, SPOTIFY_CHUNK)) {
      if (stopped()) return halt()
      onPhase?.('removingSpotify', report.removedFromSpotify, spotifyTotal)
      await spotifyWriter.removeTracks(current.spotifyPlaylistId, chunk.map((uri) => ({ uri })))
      const removed = new Set(chunk)
      keep({ ...current, addedToSpotify: current.addedToSpotify.filter((uri) => !removed.has(uri)) })
      report.removedFromSpotify += chunk.length
    }
    if (stopped()) return halt()

    // 3. YouTube's order as it was; anything added since goes to the bottom.
    // A run that never reordered changed no order, so a hand reordering since
    // is kept. A record from before `reordered` existed restores (F3).
    const restoring = current.reordered !== false
    if (restoring) {
      onPhase?.('restoring', 0, 0)
      youtubeNow = await settledRead(readYoutube, sleep)
      const restored = buildRestoreOrder(youtubeNow, { uris: current.orderBefore }, (track) => track.id)
      const moved = await executeReorder({
        writer: youtubeWriter,
        playlistId: current.youtubePlaylistId,
        currentTracks: youtubeNow,
        targetTracks: restored,
        snapshotId: null,
        keyOf: byItem,
        signal,
        onProgress: (done, total) => {
          report.applied = done
          report.total = total
          onPhase?.('restoring', done, total)
        },
      })
      report.applied = moved.applied
      report.total = moved.ops.length
      if (moved.cancelled) return halt()
    }

    // 4. The record is spent.
    onRecord(null)
    return { kind: 'undone', ...report, restored: restoring }
  } catch (cause) {
    throw failure(
      `Removed ${report.removedFromYoutube} from YouTube and ${report.removedFromSpotify} from Spotify.`,
      report,
      cause,
    )
  }
}

/**
 * Each recorded addition, matched to the playlist item it is now (§6), one
 * item per addition. An addition recorded with its setVideoId is matched by
 * that id only: YouTube never reissues ids (§9), so if the item is gone the
 * addition is gone, and a copy the owner added by hand is never taken in its
 * place (D17). Only one recorded without an id falls back to its videoId.
 */
export function resolveAdditions(tracks, entries) {
  const taken = new Set()
  const found = []
  const gone = []
  const take = (track, entry) => {
    taken.add(track)
    found.push({ entry, item: { videoId: track.id, setVideoId: track.itemId } })
  }
  const unanswered = []
  for (const entry of entries) {
    if (entry.setVideoId === null) {
      unanswered.push(entry)
      continue
    }
    const track = tracks.find((candidate) => candidate.itemId === entry.setVideoId)
    if (track && !taken.has(track)) take(track, entry)
    else gone.push(entry)
  }
  for (const entry of unanswered) {
    // A write-ahead entry: an add whose answer was lost, or a requested id
    // missing from an answer (F1).
    // ponytail: by videoId the first untaken copy is taken. A copy from
    // before the run cannot be: a run adds only songs the playlist did not
    // hold. A copy the owner added by hand later can be, but only if the
    // run's own copy is gone too.
    const track = tracks.find((candidate) => candidate.id === entry.videoId && !taken.has(candidate))
    if (track) take(track, entry)
    else gone.push(entry)
  }
  return { found, gone }
}

/**
 * Read until two reads in a row list the same items in the same order, and
 * answer the second. After SETTLE_TRIES rounds, answer the last read: a
 * passing state will have settled by then (§9).
 */
async function settledRead(read, sleep) {
  let before = await read()
  for (let round = 0; ; round += 1) {
    await sleep(CHECK_WAIT_MS)
    const after = await read()
    if (round + 1 >= SETTLE_TRIES || sameItems(before, after, byItem)) return after
    before = after
  }
}

/**
 * Read up to CHECK_READS times, waiting CHECK_WAIT_MS between reads, until
 * `ready` accepts a read. Answers the last read either way.
 */
async function readUntil(read, sleep, ready) {
  let tracks
  for (let n = 0; n < CHECK_READS; n += 1) {
    if (n > 0) await sleep(CHECK_WAIT_MS)
    tracks = await read()
    if (ready(tracks)) break
  }
  return tracks
}

/** How far a run or an undo got, then what stopped it (§5). */
function failure(done, report, cause) {
  const reorder = cause instanceof ReorderFailure
  const moves = reorder ? { applied: cause.applied, total: cause.ops.length } : report
  const reason = reorder ? (cause.cause?.message ?? cause.message) : cause.message
  const moved = moves.total > 0 ? ` Moved ${moves.applied} of ${moves.total}.` : ''
  return new MirrorFailure(`${done}${moved} Then: ${reason}`, {
    report: { ...report, applied: moves.applied, total: moves.total },
    cause,
  })
}

function chunksOf(list, size) {
  const chunks = []
  for (let start = 0; start < list.length; start += size) chunks.push(list.slice(start, start + size))
  return chunks
}
