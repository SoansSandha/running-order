/**
 * The mirror run's panel state (docs/2026-10-11-mirror-run-design.md §7):
 * the preview, the run, Stop and Undo. The run and its undo are
 * src/plan/executeMirror.js; this hook feeds them what the review screen and
 * the app already hold, and keeps the undo record in memory as well as in
 * storage (§6).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { executeMirror, undoMirror } from '../plan/executeMirror.js'
import { estimateMoves, planFill } from '../plan/mirror.js'
import { clearMirrorRecord, loadMirrorRecord, saveMirrorRecord } from '../plan/undo.js'
import { fetchPlaylistTracks } from '../services/spotify/playlists.js'
import { createSpotifyWriter } from '../services/spotify/writer.js'
import { normalizeYouTubeTracks } from '../services/youtube/track.js'
import { createYouTubeWriter } from '../services/youtube/writer.js'

const PROBE_KEY = 'playlist-sorter:probe'

/** Whether this browser keeps site data, asked before a run rather than after. */
function keepsSiteData(storage) {
  try {
    storage.setItem(PROBE_KEY, '1')
    storage.removeItem(PROBE_KEY)
    return true
  } catch {
    return false
  }
}

export function useMirrorRun({ app, review, storage = globalThis.localStorage }) {
  const { playlist, tracks: spotifyTracks, client, youtube, refreshPlaylist, setMirrorBusy } = app
  const { chosenId, result, youtubeTracks, book } = review
  const spotifyId = playlist?.id ?? null
  const editable = playlist?.editable === true
  const [reorder, setReorder] = useState(true)
  const [phase, setPhase] = useState(null)
  const [outcome, setOutcome] = useState(null)
  const [record, setRecord] = useState(null)
  const abort = useRef(null)
  const memory = useRef(new Map())
  const [rereadFailed, setRereadFailed] = useState(false)

  // §6: each YouTube playlist's record is held in memory as well as in
  // storage, so a blocked store keeps Undo while the screen is open however
  // often the dropdown changes, and an outcome belongs to its playlist. A
  // failed re-read empties the choice for a moment; the panel hides then, and
  // keeps both for when the playlist reads again.
  useEffect(() => {
    if (!chosenId) return
    // oxlint-disable-next-line react/set-state-in-effect -- storage is the outside system this follows
    setRecord(memory.current.has(chosenId) ? memory.current.get(chosenId) : loadMirrorRecord(chosenId, storage))
    // oxlint-disable-next-line react/set-state-in-effect -- see above
    setOutcome((prev) => (prev?.playlistId === chosenId ? prev : null))
  }, [chosenId, storage])

  const writers = useMemo(
    () => ({ spotify: createSpotifyWriter(client), youtube: createYouTubeWriter(youtube) }),
    [client, youtube],
  )
  const keepsData = useMemo(() => keepsSiteData(storage), [storage])

  const preview = useMemo(() => {
    if (!result || !chosenId) return null
    const fill = planFill(result)
    const moves = fill.blocked > 0 ? 0 : estimateMoves(spotifyTracks, youtubeTracks, result)
    const adds = fill.addToYoutube.length + fill.addToSpotify.length
    return {
      ...fill,
      moves,
      // Once settled, the only YouTube songs in no pair are the marked ones.
      bottom: result.markedYoutube,
      spotifyLocked: fill.addToSpotify.length > 0 && !editable,
      nothingToDo: fill.blocked === 0 && adds === 0 && (moves === 0 || !reorder),
    }
  }, [result, chosenId, spotifyTracks, youtubeTracks, editable, reorder])

  // Every state of the record is kept in memory, and in storage when the
  // browser allows; null means it is spent (§6).
  const keep = useCallback(
    (next) => {
      memory.current.set(chosenId, next)
      setRecord(next)
      if (next) saveMirrorRecord(next, storage)
      else clearMirrorRecord(chosenId, storage)
    },
    [storage, chosenId],
  )

  // Nothing at all is left, so the attempt is complete. Left unfinished, the
  // record would carry forward into some later run, and that run's Undo
  // would reach back to this attempt (D54). The "Also reorder" toggle is not
  // consulted: unticking it leaves moves still to make, and a record finished
  // then would drop this attempt's additions from the next run's Undo.
  useEffect(() => {
    const nothingLeft =
      preview !== null &&
      preview.blocked === 0 &&
      preview.addToYoutube.length === 0 &&
      preview.addToSpotify.length === 0 &&
      preview.moves === 0
    if (nothingLeft && record && !record.finished && record.spotifyPlaylistId === spotifyId && phase === null) {
      // oxlint-disable-next-line react/set-state-in-effect -- the record is storage, the outside system this follows
      keep({ ...record, finished: true })
    }
  }, [preview, record, spotifyId, phase, keep])

  const readSpotify = useCallback(() => fetchPlaylistTracks(client, spotifyId), [client, spotifyId])
  const readYoutube = useCallback(
    async () => normalizeYouTubeTracks((await youtube.fetchPlaylist(chosenId)).tracks),
    [youtube, chosenId],
  )
  const onPhase = useCallback((name, done = 0, total = 0) => setPhase({ name, done, total }), [])

  /** The run and its undo alike: hold the screen, then follow both playlists as they now are. */
  const hold = useCallback(
    async (of, work) => {
      const playlistId = chosenId
      const controller = new AbortController()
      abort.current = controller
      setOutcome(null)
      setRereadFailed(false)
      setMirrorBusy(true)
      try {
        setOutcome({ ...(await work(controller.signal)), playlistId })
      } catch (failure) {
        setOutcome({ kind: 'failed', of, message: failure.message, playlistId })
      } finally {
        // §5: the board and Sort follow both playlists as they now are. The
        // screen stays held until the Spotify side is read, so nothing starts
        // against the old board, and a failed re-read is said, not hidden.
        setPhase({ name: 'reading', done: 0, total: 0 })
        try {
          await refreshPlaylist()
        } catch {
          setRereadFailed(true)
        }
        setPhase(null)
        setMirrorBusy(false)
      }
    },
    [chosenId, setMirrorBusy, refreshPlaylist],
  )

  const canRun =
    preview !== null && preview.blocked === 0 && !preview.spotifyLocked && !preview.nothingToDo && phase === null

  const run = useCallback(() => {
    if (!canRun) return
    setPhase({ name: 'guard', done: 0, total: 0 })
    hold('run', (signal) =>
      executeMirror({
        spotifyPlaylistId: spotifyId,
        youtubePlaylistId: chosenId,
        spotifyEditable: editable,
        readSpotify,
        readYoutube,
        spotifyWriter: writers.spotify,
        youtubeWriter: writers.youtube,
        book,
        previewed: { spotifyTracks, youtubeTracks },
        reorder,
        priorRecord: record,
        onRecord: keep,
        onPhase,
        signal,
      }),
    )
  }, [canRun, hold, spotifyId, chosenId, editable, readSpotify, readYoutube, writers, book, spotifyTracks, youtubeTracks, reorder, record, keep, onPhase])

  const undo = useCallback(() => {
    if (!record || phase !== null) return
    setPhase({ name: 'removingYoutube', done: 0, total: 0 })
    hold('undo', (signal) =>
      undoMirror({
        record,
        readYoutube,
        spotifyWriter: writers.spotify,
        youtubeWriter: writers.youtube,
        onRecord: keep,
        onPhase,
        signal,
      }),
    )
  }, [record, phase, hold, readYoutube, writers, keep, onPhase])

  const stop = useCallback(() => abort.current?.abort(), [])

  return {
    preview,
    reorder,
    setReorder,
    phase,
    running: phase !== null,
    canRun,
    outcome,
    rereadFailed,
    record,
    keepsData,
    run,
    undo,
    stop,
  }
}
