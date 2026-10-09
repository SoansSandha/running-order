/**
 * The match review: one Spotify playlist against a YouTube playlist the user
 * picks, with every decision kept in the match book.
 *
 * Read-only towards both services. Scoring is the slow half and runs once per
 * chosen playlist; settling reruns after every decision. See
 * docs/2026-10-05-match-review-design.md.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  forgetDecision,
  loadMatchBook,
  recordDecision,
  saveMatchBook,
  spotifyKeyOf,
  verdictLookup,
} from '../match/matchBook.js'
import { scoreCandidates, settlePairs } from '../match/pairTracks.js'
import { toAppPlaylists } from '../services/youtube/playlists.js'
import { normalizeYouTubeTracks } from '../services/youtube/track.js'

export function useMatchReview({ youtube, spotifyTracks, storage = globalThis.localStorage }) {
  const [youtubePlaylists, setYoutubePlaylists] = useState([])
  const [chosenId, setChosenId] = useState(null)
  const [youtubeTracks, setYoutubeTracks] = useState([])
  const [scored, setScored] = useState(null)
  const [unavailable, setUnavailable] = useState(0)
  const [book, setBook] = useState(() => loadMatchBook(storage))
  const [remembered, setRemembered] = useState(true)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const latest = useRef(0)
  const lastDecisionAt = useRef(0)

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

  const choose = useCallback(
    async (playlistId) => {
      // Only the latest choice may land: a slow first playlist resolving after
      // a second was chosen must never overwrite the second.
      const ticket = ++latest.current
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

  const result = useMemo(
    () => (scored ? settlePairs(spotifyTracks, youtubeTracks, scored, { verdictFor: verdictLookup(book) }) : null),
    [spotifyTracks, youtubeTracks, scored, book],
  )

  const commit = useCallback(
    (next) => {
      setBook(next)
      setRemembered(saveMatchBook(next, storage))
    },
    [storage],
  )

  const decide = useCallback(
    (spotifyTrack, youtubeTrack, verdict) => {
      if (recentlyDecided()) return
      const spotifyKey = spotifyKeyOf(spotifyTrack)
      // M-3: a track Spotify or YouTube no longer serves has no key to file
      // the decision under.
      if (spotifyKey == null || youtubeTrack?.id == null) return
      commit(recordDecision(book, { spotifyKey, youtubeVideoId: youtubeTrack.id, verdict }))
    },
    [book, commit, recentlyDecided],
  )

  // One save for the whole group, not one per pair.
  const confirmAll = useCallback(
    (pairs) => {
      if (recentlyDecided()) return
      commit(
        pairs.reduce((next, pair) => {
          const spotifyKey = spotifyKeyOf(pair.spotify)
          if (spotifyKey == null || pair.youtube?.id == null) return next // M-3
          return recordDecision(next, { spotifyKey, youtubeVideoId: pair.youtube.id, verdict: 'same' })
        }, book),
      )
    },
    [book, commit, recentlyDecided],
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
  }
}
