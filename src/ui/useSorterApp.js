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
} from '../api/playlists.js'
import { buildCsvOrder } from '../csv/order.js'
import { detectColumns } from '../csv/detectColumns.js'
import { matchCsvToTracks } from '../csv/match.js'
import { parseCsv } from '../csv/parse.js'
import { executeClone } from '../plan/clone.js'
import { applyMoveOps, buildMoveOps } from '../plan/diff.js'
import { executeReorder } from '../plan/execute.js'
import { buildRestoreOrder, createSnapshot, loadSnapshot, saveSnapshot } from '../plan/undo.js'
import { defaultOptionsFor, sortTracks, strategyById } from '../sort/index.js'

export const CSV_STRATEGY = 'csv'

export function useSorterApp(auth, demo = null) {
  const { client } = auth

  const [screen, setScreen] = useState(demo?.screen ?? 'playlists')
  const [me, setMe] = useState(demo?.me ?? null)
  const [playlists, setPlaylists] = useState(demo?.playlists ?? [])
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const [playlist, setPlaylist] = useState(demo?.playlist ?? null)
  const [tracks, setTracks] = useState(demo?.tracks ?? [])
  const demoRef = useRef(demo)

  const [strategyId, setStrategyId] = useState('artist')
  const [options, setOptions] = useState(() => defaultOptionsFor('artist'))
  const [csv, setCsv] = useState(null)

  const [run, setRun] = useState(demo?.run ?? null)
  const [outcome, setOutcome] = useState(demo?.outcome ?? null)
  const abort = useRef(null)

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
  }, [client])

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
    [client],
  )

  const chooseStrategy = useCallback((id) => {
    setStrategyId(id)
    setOptions(id === CSV_STRATEGY ? {} : defaultOptionsFor(id))
  }, [])

  const setOption = useCallback((key, value) => {
    setOptions((current) => ({ ...current, [key]: value }))
  }, [])

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

  const setCsvOption = useCallback((key, value) => {
    setCsv((current) => (current ? { ...current, [key]: value } : current))
  }, [])

  /* ---- Writing ---------------------------------------------------------- */

  const strategyLabel =
    strategyId === CSV_STRATEGY ? 'CSV' : (strategyById(strategyId)?.label ?? strategyId)

  const applyInPlace = useCallback(
    async ({ dryRun = false } = {}) => {
      if (!playlist) return
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
          client,
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
    [client, playlist, tracks, targetTracks, ops, movedKeys],
  )

  const applyClone = useCallback(
    async ({ dryRun = false } = {}) => {
      if (!playlist || !me) return
      setError(null)
      setOutcome(null)
      setScreen('progress')
      setRun({ phase: 'cloning', done: 0, total: targetTracks.length, turning: null })

      try {
        const result = await executeClone({
          client,
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
    [client, playlist, me, targetTracks, strategyLabel],
  )

  const cancelRun = useCallback(() => abort.current?.abort(), [])

  const undoLast = useCallback(async () => {
    if (!playlist) return
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
        client,
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
  }, [client, playlist])

  return {
    screen,
    setScreen,
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
    targetTracks,
    previewRows,
    movingCount,
    writtenKeys,
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
