/**
 * The match review: one Spotify playlist against a YouTube playlist the user
 * picks, with every decision kept in the match book, and a search of both
 * catalogues for the songs the two playlists do not pair.
 *
 * Read-only towards both services. Scoring is the slow half and runs once per
 * chosen playlist; settling reruns after every decision and every find. See
 * docs/2026-10-05-match-review-design.md and
 * docs/2026-10-08-catalogue-search-design.md.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { findOnSpotify, findOnYouTube } from '../match/findTwin.js'
import {
  forgetDecision,
  loadMatchBook,
  recordDecision,
  saveMatchBook,
  snapshotOf,
  spotifyKeyOf,
  verdictLookup,
} from '../match/matchBook.js'
import { scoreCandidates, settlePairs } from '../match/pairTracks.js'
import { settleFound } from '../match/settleFound.js'
import { AuthError } from '../services/spotify/client.js'
import { searchTracks } from '../services/spotify/search.js'
import { ProxyUnavailableError, YouTubeSessionExpiredError } from '../services/youtube/client.js'
import { toAppPlaylists } from '../services/youtube/playlists.js'
import { normalizeYouTubeSearchResults, normalizeYouTubeTracks } from '../services/youtube/track.js'
import { sweepHalf } from './sweep.js'

const NOTHING_FOUND = { forSpotify: new Map(), forYoutube: new Map() }

/** An episode or an unavailable row has no title to search for. */
const searchable = (track) => !track.isEpisode && !track.isUnavailable

export function useMatchReview({ youtube, spotify, spotifyTracks, storage = globalThis.localStorage }) {
  const [youtubePlaylists, setYoutubePlaylists] = useState([])
  const [chosenId, setChosenId] = useState(null)
  const [youtubeTracks, setYoutubeTracks] = useState([])
  const [scored, setScored] = useState(null)
  const [unavailable, setUnavailable] = useState(0)
  const [book, setBook] = useState(() => loadMatchBook(storage))
  const [remembered, setRemembered] = useState(true)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [found, setFound] = useState(NOTHING_FOUND)
  const [sweep, setSweep] = useState(null)
  const latest = useRef(0)
  const lastDecisionAt = useRef(0)
  const sweepTicket = useRef(0)

  // I-2: Confirm/Reject/Undo remove a row, the next one slides under the
  // pointer, and the second click of a double-click decides it too.
  // ponytail: a deliberate second click inside 400ms is dropped along with
  // the accidental one.
  const recentlyDecided = useCallback(() => {
    const now = Date.now()
    if (now - lastDecisionAt.current < 400) return true
    lastDecisionAt.current = now
    return false
  }, [])

  // I-1: lifted out of the effect so the red Notice's "Try again" can re-run
  // the same load without the user leaving the screen.
  const loadPlaylists = useCallback(() => {
    let live = true
    youtube
      .listPlaylists()
      .then((raw) => {
        if (!live) return
        setYoutubePlaylists(toAppPlaylists(raw))
        setError(null)
      })
      .catch((failure) => live && setError(failure.message))
    return () => {
      live = false
    }
  }, [youtube])

  useEffect(() => loadPlaylists(), [loadPlaylists])

  // Leaving the screen stops a sweep: its results would land on nothing.
  useEffect(
    () => () => {
      sweepTicket.current += 1
    },
    [],
  )

  const choose = useCallback(
    async (playlistId) => {
      // Only the latest choice may land: a slow first playlist resolving after
      // a second was chosen must never overwrite the second.
      const ticket = ++latest.current
      // Finds are about this playlist's leftovers; a new playlist starts clean.
      sweepTicket.current += 1
      setFound(NOTHING_FOUND)
      setSweep(null)
      setChosenId(playlistId || null)
      setScored(null)
      setYoutubeTracks([])
      setUnavailable(0)
      setError(null)
      if (!playlistId) {
        // I-3: picking the placeholder takes a new ticket, so the load it
        // superseded skips its own `finally` and never clears the meter.
        setBusy(null)
        return
      }
      try {
        setBusy('Reading the YouTube playlist')
        const fetched = await youtube.fetchPlaylist(playlistId)
        if (ticket !== latest.current) return
        const tracks = normalizeYouTubeTracks(fetched.tracks)
        setBusy('Matching')
        // Let the meter paint before ~0.35s of synchronous scoring.
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (ticket !== latest.current) return
        const candidates = scoreCandidates(spotifyTracks, tracks)
        setYoutubeTracks(tracks)
        setUnavailable(Math.max(0, (fetched.counted ?? 0) - (fetched.readable ?? 0)))
        setScored(candidates)
      } catch (failure) {
        if (ticket === latest.current) {
          setError(failure.message)
          // I-1: back to the placeholder, so picking the same playlist again
          // fires a change event and retries the fetch.
          setChosenId(null)
        }
      } finally {
        if (ticket === latest.current) setBusy(null)
      }
    },
    [youtube, spotifyTracks],
  )

  const youtubeIds = useMemo(() => new Set(youtubeTracks.map((track) => track.id)), [youtubeTracks])
  const spotifyKeys = useMemo(() => new Set(spotifyTracks.map(spotifyKeyOf)), [spotifyTracks])

  // Pairing the playlists does not depend on finds, so a find does not rerun it.
  const settled = useMemo(
    () => (scored ? settlePairs(spotifyTracks, youtubeTracks, scored, { verdictFor: verdictLookup(book) }) : null),
    [spotifyTracks, youtubeTracks, scored, book],
  )

  const result = useMemo(
    () =>
      settled &&
      settleFound(settled, {
        spotifyTracks,
        youtubeTracks,
        book,
        foundForSpotify: found.forSpotify,
        foundForYoutube: found.forYoutube,
      }),
    [settled, spotifyTracks, youtubeTracks, book, found],
  )

  // What a sweep would search: unmatched songs with a title, not searched
  // yet. One search serves a song listed twice.
  const unsearched = useMemo(() => {
    if (!result) return { spotify: [], youtube: [] }
    const spotifySongs = new Map()
    for (const track of result.unmatchedSpotify.filter(searchable)) {
      const key = spotifyKeyOf(track)
      if (key != null && !found.forSpotify.has(key) && !spotifySongs.has(key)) spotifySongs.set(key, track)
    }
    const youtubeSongs = result.unmatchedYoutube.filter(
      (track) => searchable(track) && track.id != null && !found.forYoutube.has(track.id),
    )
    return { spotify: [...spotifySongs.values()], youtube: youtubeSongs }
  }, [result, found])

  const searchAll = useCallback(async () => {
    const total = unsearched.spotify.length + unsearched.youtube.length
    if (total === 0) return
    const ticket = ++sweepTicket.current
    const live = () => ticket === sweepTicket.current
    setSweep({ done: 0, total, failed: 0, running: true, errors: [] })
    const advance = (failed) =>
      setSweep((prev) => prev && { ...prev, done: prev.done + 1, failed: prev.failed + failed })
    const stopHalf = (label) => (failure) =>
      setSweep((prev) => prev && { ...prev, errors: [...prev.errors, { label, message: failure.message }] })
    const searchYouTube = async (query, filter, limit) =>
      normalizeYouTubeSearchResults(await youtube.search(query, filter, limit))
    const searchSpotify = (query, limit) => searchTracks(spotify, query, limit)

    // The two services search side by side, each one song at a time.
    await Promise.all([
      sweepHalf(unsearched.spotify, {
        find: (song) => findOnYouTube(song, searchYouTube, { skipIds: youtubeIds }),
        live,
        onFound: (song, twins) => {
          setFound((prev) => ({ ...prev, forSpotify: new Map(prev.forSpotify).set(spotifyKeyOf(song), twins) }))
          advance(0)
        },
        onFailed: () => advance(1),
        onStopped: stopHalf('YouTube Music'),
        isFatal: (failure) => failure instanceof ProxyUnavailableError || failure instanceof YouTubeSessionExpiredError,
      }),
      sweepHalf(unsearched.youtube, {
        find: (song) => findOnSpotify(song, searchSpotify, { skipIds: spotifyKeys }),
        live,
        onFound: (song, twins) => {
          setFound((prev) => ({ ...prev, forYoutube: new Map(prev.forYoutube).set(song.id, twins) }))
          advance(0)
        },
        onFailed: () => advance(1),
        onStopped: stopHalf('Spotify'),
        isFatal: (failure) => failure instanceof AuthError,
      }),
    ])
    if (live()) setSweep((prev) => prev && { ...prev, running: false })
  }, [unsearched, youtube, spotify, youtubeIds, spotifyKeys])

  const stopSearch = useCallback(() => {
    sweepTicket.current += 1
    setSweep((prev) => prev && { ...prev, running: false })
  }, [])

  const commit = useCallback(
    (next) => {
      setBook(next)
      setRemembered(saveMatchBook(next, storage))
    },
    [storage],
  )

  // D29: a pair with a track in neither playlist is a find, and a confirmed
  // find keeps a snapshot of that track.
  const findOf = useCallback(
    (spotifyTrack, youtubeTrack) => {
      if (!youtubeIds.has(youtubeTrack.id)) return snapshotOf(youtubeTrack, 'youtube')
      if (!spotifyKeys.has(spotifyKeyOf(spotifyTrack))) return snapshotOf(spotifyTrack, 'spotify')
      return undefined
    },
    [youtubeIds, spotifyKeys],
  )

  const decide = useCallback(
    (spotifyTrack, youtubeTrack, verdict) => {
      if (recentlyDecided()) return
      const spotifyKey = spotifyKeyOf(spotifyTrack)
      // M-3: a track Spotify or YouTube no longer serves has no key to file
      // the decision under.
      if (spotifyKey == null || youtubeTrack?.id == null) return
      const find = verdict === 'same' ? findOf(spotifyTrack, youtubeTrack) : undefined
      commit(recordDecision(book, { spotifyKey, youtubeVideoId: youtubeTrack.id, verdict, found: find }))
    },
    [book, commit, recentlyDecided, findOf],
  )

  // One save for the whole group, not one per pair.
  const confirmAll = useCallback(
    (pairs) => {
      if (recentlyDecided()) return
      commit(
        pairs.reduce((next, pair) => {
          const spotifyKey = spotifyKeyOf(pair.spotify)
          if (spotifyKey == null || pair.youtube?.id == null) return next // M-3
          return recordDecision(next, {
            spotifyKey,
            youtubeVideoId: pair.youtube.id,
            verdict: 'same',
            found: findOf(pair.spotify, pair.youtube),
          })
        }, book),
      )
    },
    [book, commit, recentlyDecided, findOf],
  )

  const undo = useCallback(
    (pair) => {
      if (recentlyDecided()) return
      const spotifyKey = spotifyKeyOf(pair.spotify)
      if (spotifyKey == null || pair.youtube?.id == null) return // M-3
      commit(forgetDecision(book, spotifyKey, pair.youtube.id))
    },
    [book, commit, recentlyDecided],
  )

  return {
    youtubePlaylists,
    chosenId,
    choose,
    retryPlaylists: loadPlaylists,
    result,
    unavailable,
    busy,
    error,
    remembered,
    decide,
    confirmAll,
    undo,
    found,
    sweep,
    unsearchedCount: unsearched.spotify.length + unsearched.youtube.length,
    searchAll,
    stopSearch,
  }
}
