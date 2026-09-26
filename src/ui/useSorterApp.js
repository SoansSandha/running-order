/**
 * Application state: what board is showing, what it is showing about, and
 * what happens when the lever is pulled.
 *
 * All the hard thinking lives in the pure layers underneath. This hook only
 * sequences them and holds their results.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  fetchPlaylistTracks,
  getCurrentUser,
  getPlaylistSnapshot,
  listEditablePlaylists,
} from '../services/spotify/playlists.js'
import { buildCsvOrder } from '../csv/order.js'
import { detectColumns } from '../csv/detectColumns.js'
import { matchCsvToTracks } from '../csv/match.js'
import { parseCsv } from '../csv/parse.js'
import { executeClone } from '../plan/clone.js'
import { applyMoveOps, buildMoveOps } from '../plan/diff.js'
import { executeReorder } from '../plan/execute.js'
import { buildRestoreOrder, createSnapshot, loadSnapshot, saveSnapshot } from '../plan/undo.js'
import { createSpotifyWriter } from '../services/spotify/writer.js'
import {
  defaultStrategyOptionsFor,
  supportedStrategyFor,
  unsupportedOptionReason,
  writeUnsupportedReason,
} from '../services/capabilities.js'
import { createYouTubeClient } from '../services/youtube/client.js'
import { toAppPlaylists } from '../services/youtube/playlists.js'
import { normalizeYouTubeTracks } from '../services/youtube/track.js'
import { defaultOptionsFor, sortTracks, strategyById } from '../sort/index.js'

export const CSV_STRATEGY = 'csv'

export function useSorterApp(auth, demo = null) {
  const { client } = auth
  const writer = useMemo(() => createSpotifyWriter(client), [client])

  const [screen, setScreen] = useState(demo?.screen ?? 'playlists')
  const [me, setMe] = useState(demo?.me ?? null)
  const [playlists, setPlaylists] = useState(demo?.playlists ?? [])
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const [playlist, setPlaylist] = useState(demo?.playlist ?? null)
  const [tracks, setTracks] = useState(demo?.tracks ?? [])
  const demoRef = useRef(demo)

  const [strategyId, setStrategyId] = useState(demo?.strategyId ?? 'artist')
  const [options, setOptions] = useState(() =>
    demo?.strategyId === CSV_STRATEGY ? {} : defaultOptionsFor('artist'),
  )
  const [csv, setCsv] = useState(demo?.csv ?? null)

  const [run, setRun] = useState(demo?.run ?? null)
  const [outcome, setOutcome] = useState(demo?.outcome ?? null)
  const abort = useRef(null)

  const [source, setSource] = useState(demo?.source ?? 'spotify')
  const youtube = useMemo(() => createYouTubeClient({}), [])

  /**
   * The service any capability question is really about.
   *
   * An open playlist knows which service it came from; the toggle only says
   * which library is being browsed. The two agree right up until they do not
   * — the toggle is live, so an in-flight library read can land after the
   * open playlist was cleared — and the row's own service is the one that
   * decides what can be done to it. Asked once here so no screen can answer
   * it differently. A Spotify playlist carries no `source`, so it falls
   * through to the toggle and reads 'spotify' exactly as before.
   */
  const capabilitySource = playlist?.source ?? source

  /* ---- Derived order ---------------------------------------------------- */

  const targetTracks = useMemo(() => {
    if (tracks.length === 0) return []
    if (strategyId === CSV_STRATEGY) {
      if (!csv?.rows?.length) return tracks
      return buildCsvOrder(tracks, csv.rows, {
        columns: csv.columns,
        hasHeader: csv.hasHeader,
        unmatchedPosition: csv.unmatchedPosition ?? 'bottom',
        acceptedSuggestions: csv.accepted ?? [],
      })
    }
    return sortTracks(tracks, { strategy: strategyId, ...options })
  }, [tracks, strategyId, options, csv])

  const ops = useMemo(() => {
    if (tracks.length === 0 || targetTracks.length !== tracks.length) return []
    try {
      return buildMoveOps(
        tracks.map((track) => track.originalIndex),
        targetTracks.map((track) => track.originalIndex),
      )
    } catch {
      return []
    }
  }, [tracks, targetTracks])

  /** Which track each write moves, in order — drives the flap animation. */
  const movedKeys = useMemo(() => {
    let mirror = tracks.map((track) => track.originalIndex)
    const keys = []
    for (const op of ops) {
      keys.push(mirror[op.rangeStart])
      mirror = applyMoveOps(mirror, [op])
    }
    return keys
  }, [tracks, ops])

  const previewRows = useMemo(
    () =>
      targetTracks.map((track, index) => ({
        key: track.originalIndex,
        track,
        from: track.originalIndex + 1,
        to: index + 1,
        moves: track.originalIndex !== index,
        blocked: track.isUnavailable || track.isLocal,
      })),
    [targetTracks],
  )

  const movingCount = previewRows.filter((row) => row.moves).length

  /**
   * Rows whose write has already returned. Without this the board cannot
   * show a committed state, and mid-run a written row looks identical to a
   * pending one.
   */
  const writtenKeys = useMemo(() => {
    const count = run?.done ?? outcome?.applied ?? 0
    return new Set(movedKeys.slice(0, count))
  }, [movedKeys, run?.done, outcome?.applied])

  const csvReport = useMemo(() => {
    if (strategyId !== CSV_STRATEGY || !csv?.rows?.length || tracks.length === 0) return null
    return matchCsvToTracks(csv.rows, tracks, { columns: csv.columns, hasHeader: csv.hasHeader })
  }, [strategyId, csv, tracks])

  /* ---- Loading ---------------------------------------------------------- */

  const loadPlaylists = useCallback(async () => {
    if (demoRef.current) return
    setError(null)
    setBusy({ label: 'Reading your library', done: 0, total: 0 })
    try {
      if (source === 'youtube') {
        setBusy({ label: 'Reading your YouTube library', done: 0, total: 0 })
        setPlaylists(toAppPlaylists(await youtube.listPlaylists()))
        return
      }
      const profile = await getCurrentUser(client)
      setMe(profile)
      const found = await listEditablePlaylists(client, profile.id, {
        onProgress: (done, total) => setBusy({ label: 'Reading your library', done, total }),
      })
      setPlaylists(found)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(null)
    }
  }, [client, source, youtube])

  const openPlaylist = useCallback(
    async (chosen) => {
      setError(null)
      setPlaylist(chosen)
      setTracks([])
      setCsv(null)
      setOutcome(null)
      setScreen('sort')

      if (demoRef.current) {
        setTracks(demoRef.current.tracks.slice(0, chosen.trackCount))
        return
      }

      setBusy({ label: `Reading ${chosen.name}`, done: 0, total: chosen.trackCount })
      try {
        if (chosen.source === 'youtube') {
          const fetched = await youtube.fetchPlaylist(chosen.id)
          setTracks(normalizeYouTubeTracks(fetched.tracks))
          return
        }
        const loaded = await fetchPlaylistTracks(client, chosen.id, {
          onProgress: (done, total) =>
            setBusy({ label: `Reading ${chosen.name}`, done, total }),
        })
        setTracks(loaded)
      } catch (failure) {
        setError(failure.message)
      } finally {
        setBusy(null)
      }
    },
    [client, youtube],
  )

  const chooseStrategy = useCallback(
    (id) => {
      setStrategyId(id)
      setOptions(
        id === CSV_STRATEGY
          ? {}
          : defaultStrategyOptionsFor(capabilitySource, id, defaultOptionsFor(id)),
      )
    },
    [capabilitySource],
  )

  const setOption = useCallback(
    (key, value) => {
      // The panel seats an unhonourable choice unlit, so this is the second
      // line of defence rather than the first — but it is the one that
      // decides, and it keeps any other caller from reaching the same state.
      if (unsupportedOptionReason(capabilitySource, strategyId, key, value)) return
      setOptions((current) => ({ ...current, [key]: value }))
    },
    [capabilitySource, strategyId],
  )

  const loadCsv = useCallback(async (file) => {
    setError(null)
    try {
      const text = await file.text()
      const { rows } = parseCsv(text)
      const detected = detectColumns(rows)
      setCsv({
        fileName: file.name,
        rows,
        columns: detected.columns,
        hasHeader: detected.hasHeader,
        headers: detected.headers,
        unmatchedPosition: 'bottom',
        accepted: [],
      })
      setStrategyId(CSV_STRATEGY)
      setOptions({})
    } catch (failure) {
      setError(`Could not read that file: ${failure.message}`)
    }
  }, [])

  const setCsvColumn = useCallback((field, index) => {
    setCsv((current) =>
      current ? { ...current, columns: { ...current.columns, [field]: index } } : current,
    )
  }, [])

  /** Accept or reject one fuzzy suggestion. Nothing is applied until it is. */
  const toggleSuggestion = useCallback((rowIndex) => {
    setCsv((current) => {
      if (!current) return current
      const accepted = current.accepted ?? []
      return {
        ...current,
        accepted: accepted.includes(rowIndex)
          ? accepted.filter((index) => index !== rowIndex)
          : [...accepted, rowIndex],
      }
    })
  }, [])

  const setCsvOption = useCallback((key, value) => {
    setCsv((current) => (current ? { ...current, [key]: value } : current))
  }, [])

  /* ---- Writing ---------------------------------------------------------- */

  const strategyLabel =
    strategyId === CSV_STRATEGY ? 'CSV' : (strategyById(strategyId)?.label ?? strategyId)

  /**
   * Why nothing on this playlist can be written. Every lever below refuses
   * on it, and the preview screen prints it beside them — no write path may
   * assume it was only ever reached from a lit control.
   */
  const writeBlocked = writeUnsupportedReason(capabilitySource)

  const applyInPlace = useCallback(
    async ({ dryRun = false } = {}) => {
      if (!playlist) return
      // Both the real run and the dry run read the live snapshot first, and
      // that read goes to Spotify with whatever id it is handed. A YouTube
      // id there is a wrong-service request, not a no-op.
      if (writeBlocked) return
      setError(null)
      setOutcome(null)
      setScreen('progress')

      const controller = new AbortController()
      abort.current = controller
      setRun({ phase: dryRun ? 'dry' : 'running', done: 0, total: ops.length, turning: null })

      try {
        // Re-read the snapshot: writing into a playlist that moved under us
        // would scramble it.
        const live = await getPlaylistSnapshot(client, playlist.id)
        if (playlist.snapshotId && live && live !== playlist.snapshotId && !dryRun) {
          setRun(null)
          setOutcome({
            kind: 'stale',
            message: `${playlist.name} changed on Spotify since it was read. Reload it and preview again.`,
          })
          return
        }

        if (!dryRun) saveSnapshot(createSnapshot({ ...playlist, snapshotId: live }, tracks))

        const result = await executeReorder({
          writer,
          playlistId: playlist.id,
          currentTracks: tracks,
          targetTracks,
          snapshotId: live ?? playlist.snapshotId,
          signal: controller.signal,
          dryRun,
          onProgress: (done, total) =>
            setRun({ phase: 'running', done, total, turning: movedKeys[done - 1] ?? null }),
        })

        setRun(null)
        setOutcome({
          kind: dryRun ? 'dry' : result.cancelled ? 'cancelled' : 'reordered',
          applied: result.applied,
          total: result.ops.length,
          ops: result.ops,
          canUndo: !dryRun && result.applied > 0,
        })
        if (!dryRun && result.applied > 0) {
          setPlaylist((current) => ({ ...current, snapshotId: result.snapshotId }))
          setTracks(result.finalOrder.map((track, index) => ({ ...track, originalIndex: index })))
        }
      } catch (failure) {
        setRun(null)
        setOutcome({
          kind: 'failed',
          message: failure.message,
          applied: failure.applied ?? 0,
          canUndo: (failure.applied ?? 0) > 0,
        })
      }
    },
    [client, writer, playlist, tracks, targetTracks, ops, movedKeys, writeBlocked],
  )

  const applyClone = useCallback(
    async ({ dryRun = false } = {}) => {
      if (!playlist || !me) return
      // executeClone creates the destination playlist BEFORE it discovers
      // nothing is cloneable, so one unguarded click left a real empty
      // playlist in the user's Spotify account.
      if (writeBlocked) return
      setError(null)
      setOutcome(null)
      setScreen('progress')
      setRun({ phase: 'cloning', done: 0, total: targetTracks.length, turning: null })

      try {
        const result = await executeClone({
          writer,
          userId: me.id,
          sourcePlaylist: playlist,
          targetTracks,
          strategyLabel,
          dryRun,
          onProgress: (done, total) => setRun({ phase: 'cloning', done, total, turning: null }),
        })
        setRun(null)
        setOutcome({ kind: dryRun ? 'dryClone' : 'cloned', ...result })
      } catch (failure) {
        setRun(null)
        setOutcome({ kind: 'failed', message: failure.message, applied: 0, canUndo: false })
      }
    },
    [writer, playlist, me, targetTracks, strategyLabel, writeBlocked],
  )

  const cancelRun = useCallback(() => abort.current?.abort(), [])

  const changeSource = useCallback(
    (next) => {
      // A strategy the new source cannot honour must not stay selected: it
      // would render pressed and disabled at once, keep driving the preview,
      // and be impossible to clear, because the only control that could
      // clear it is the disabled row itself.
      const nextStrategy = supportedStrategyFor(next, strategyId)
      setSource(next)
      setStrategyId(nextStrategy)
      setOptions(
        defaultStrategyOptionsFor(
          next,
          nextStrategy,
          // Carrying the old strategy's option values onto a different
          // strategy would seed it with keys it does not own.
          nextStrategy === strategyId ? options : defaultOptionsFor(nextStrategy),
        ),
      )
      setPlaylists([])
      setPlaylist(null)
      setTracks([])
      setError(null)
      setScreen('playlists')
    },
    [strategyId, options],
  )

  const undoLast = useCallback(async () => {
    if (!playlist) return
    // Unreachable while no write can happen in the first place, but undo is
    // a write path to the same Spotify client and is gated with the rest.
    if (writeBlocked) return
    const snapshot = loadSnapshot(playlist.id)
    if (!snapshot) {
      setError('There is no saved snapshot for this playlist.')
      return
    }

    setOutcome(null)
    setRun({ phase: 'undoing', done: 0, total: 0, turning: null })
    try {
      const fresh = await fetchPlaylistTracks(client, playlist.id)
      const restored = buildRestoreOrder(fresh, snapshot)
      const live = await getPlaylistSnapshot(client, playlist.id)
      const result = await executeReorder({
        writer,
        playlistId: playlist.id,
        currentTracks: fresh,
        targetTracks: restored,
        snapshotId: live,
        onProgress: (done, total) => setRun({ phase: 'undoing', done, total, turning: null }),
      })
      setRun(null)
      setTracks(result.finalOrder.map((track, index) => ({ ...track, originalIndex: index })))
      setPlaylist((current) => ({ ...current, snapshotId: result.snapshotId }))
      setOutcome({ kind: 'undone', applied: result.applied, total: result.ops.length })
    } catch (failure) {
      setRun(null)
      setOutcome({ kind: 'failed', message: failure.message, applied: 0, canUndo: false })
    }
  }, [client, writer, playlist, writeBlocked])

  return {
    screen,
    setScreen,
    source,
    capabilitySource,
    writeBlocked,
    setSource: changeSource,
    me,
    playlists,
    busy,
    error,
    setError,
    playlist,
    tracks,
    strategyId,
    strategyLabel,
    chooseStrategy,
    options,
    setOption,
    csv,
    csvReport,
    loadCsv,
    setCsvColumn,
    setCsvOption,
    toggleSuggestion,
    targetTracks,
    previewRows,
    movingCount,
    writtenKeys,
    focusKey: demo?.focusKey ?? null,
    ops,
    run,
    outcome,
    setOutcome,
    loadPlaylists,
    openPlaylist,
    applyInPlace,
    applyClone,
    cancelRun,
    undoLast,
  }
}
