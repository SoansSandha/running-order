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

  useEffect(() => {
    let live = true
    youtube
      .listPlaylists()
      .then((raw) => live && setYoutubePlaylists(toAppPlaylists(raw)))
      .catch((failure) => live && setError(failure.message))
    return () => {
      live = false
    }
  }, [youtube])

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
      if (!playlistId) return
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
        if (ticket === latest.current) setError(failure.message)
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
    (spotifyTrack, youtubeTrack, verdict) =>
      commit(
        recordDecision(book, { spotifyKey: spotifyKeyOf(spotifyTrack), youtubeVideoId: youtubeTrack.id, verdict }),
      ),
    [book, commit],
  )

  // One save for the whole group, not one per pair.
  const confirmAll = useCallback(
    (pairs) =>
      commit(
        pairs.reduce(
          (next, pair) =>
            recordDecision(next, {
              spotifyKey: spotifyKeyOf(pair.spotify),
              youtubeVideoId: pair.youtube.id,
              verdict: 'same',
            }),
          book,
        ),
      ),
    [book, commit],
  )

  const undo = useCallback(
    (pair) => commit(forgetDecision(book, spotifyKeyOf(pair.spotify), pair.youtube.id)),
    [book, commit],
  )

  return { youtubePlaylists, chosenId, choose, result, unavailable, busy, error, remembered, decide, confirmAll, undo }
}
