/**
 * The match tray: where one song is matched, opened under its row on the
 * match review. See docs/2026-10-10-match-tray-design.md §3–§6.
 *
 * It holds a player for each side, the owner's own search, a field for a
 * pasted link, and the candidates — search results first, then the other
 * playlist's leftovers — each with Listen, Open and Pair. Read-only: Pair
 * hands the chosen track back to the review, which records the decision.
 */

import { useEffect, useRef, useState } from 'react'
import { rankResults } from '../../match/findTwin.js'
import { explainPair, queryTitle } from '../../match/scorePair.js'
import { lookupLink, searchCatalogue } from '../../services/trackLookups.js'
import { artistsOf, formatDuration, openHref, titleOf } from '../format.js'
import { QuietLever } from '../components/chrome.jsx'

const NAMES = { youtube: 'YouTube Music', spotify: 'Spotify' }

/**
 * @param {object} props
 * @param {object} props.song the playlist song the tray matches
 * @param {'youtube'|'spotify'} props.side the service its candidates come from
 * @param {object} [props.pair] the proposed or settled pair, when a pair row opened it
 * @param {boolean} [props.settled] a settled pair only listens: Undo, then Find a match, picks again
 * @param {Array} props.sweepResults what the sweep found for the song: Tracks from `side`
 * @param {Array} props.leftovers the other playlist's unmatched songs, closest title first
 * @param {(track: object) => boolean} props.inOtherPlaylist
 * @param {{youtube: object, spotify: object}} props.clients
 * @param {boolean} props.deciding true while a sweep runs, when no decision may be made
 * @param {(track: object) => void} props.onPair
 * @param {(verdict: 'same'|'different') => void} props.onDecide
 * @param {() => void} props.onUndo
 * @param {() => void} [props.onNoMatch] marks the song as not on `side`'s service (no-match D39); the lever shows only when given
 * @param {() => void} props.onClose
 */
export function MatchTray({
  song,
  side,
  pair = null,
  settled = false,
  sweepResults,
  leftovers,
  inOtherPlaylist,
  clients,
  deciding,
  onPair,
  onDecide,
  onUndo,
  onNoMatch,
  onClose,
}) {
  const other = NAMES[side]
  const [query, setQuery] = useState(() => startingQuery(song, side))
  const [manual, setManual] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  const [link, setLink] = useState('')
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState(null)
  const [linkWaits, setLinkWaits] = useState(false)
  // I-1: a link lookup outlives the render that started it, so it pairs with
  // the latest onPair, which builds on decisions made meanwhile, and only
  // while the tray is still open.
  const latest = useRef({ onPair, deciding })
  const open = useRef(true)
  useEffect(() => {
    latest.current = { onPair, deciding }
  })
  useEffect(() => {
    open.current = true
    return () => {
      open.current = false
    }
  }, [])
  // The song's own side plays it; the other side plays the pair's track, or
  // whichever result was last listened to. YouTube autoplays only after Listen.
  const [loaded, setLoaded] = useState(() => ({
    spotify: pair?.spotify ?? (side === 'youtube' ? song : null),
    youtube: pair?.youtube ?? (side === 'spotify' ? song : null),
    autoplay: false,
  }))

  const listen = (track) => setLoaded((prev) => ({ ...prev, [side]: track, autoplay: side === 'youtube' }))

  async function search(event) {
    event.preventDefault()
    const text = query.trim()
    if (!text) return
    setSearching(true)
    setSearchError(null)
    try {
      setManual(await searchCatalogue(text, side, clients))
    } catch (failure) {
      setSearchError(`Could not search ${other}: ${failure.message}`)
    } finally {
      setSearching(false)
    }
  }

  async function pairLink(event) {
    event.preventDefault()
    setLinking(true)
    setLinkError(null)
    setLinkWaits(false)
    const { track, error } = await lookupLink(link, side, clients)
    if (!open.current) return
    setLinking(false)
    if (error) setLinkError(error)
    else if (latest.current.deciding) setLinkWaits(true)
    else if (track) latest.current.onPair(track)
  }

  const results = rankResults(song, manual ?? sweepResults, { side, inOtherPlaylist })
  const leftoverRows = leftovers.map((track) => ({
    track,
    verdict: side === 'youtube' ? explainPair(song, track) : explainPair(track, song),
    already: false,
  }))
  // A candidate's Pair waits for a link being looked up, so the two never race.
  const list = { playingId: loaded[side]?.id, onListen: listen, onPair, deciding: deciding || linking, other }

  return (
    <div className="tray" role="region" aria-label={`Match ${titleOf(song)}`}>
      <div className="tray-players">
        <span className="col-label">Spotify</span>
        <SpotifyPlayer track={loaded.spotify} />
        <span className="col-label">YouTube Music</span>
        <YouTubePlayer track={loaded.youtube} autoplay={loaded.autoplay} />
      </div>

      <div className="tray-work">
        {/* At the top, so marking needs no scroll past the candidates. */}
        {onNoMatch ? (
          <div className="tray-head">
            <QuietLever className="lever-quiet is-compact" onClick={onNoMatch} disabled={deciding}>
              Not on {other}
            </QuietLever>
          </div>
        ) : null}
        {pair ? (
          <div className="tray-pair">
            <p className="row-sub">The matcher says: {explainPair(pair.spotify, pair.youtube)}</p>
            <div className="tray-actions">
              <OpenLink track={pair.spotify} label="↗ Open in Spotify" />
              <OpenLink track={pair.youtube} label="↗ Open in YouTube Music" />
              <span className="tray-decide">
                {settled ? (
                  <QuietLever className="lever-quiet is-compact" onClick={onUndo} disabled={deciding}>
                    Undo
                  </QuietLever>
                ) : (
                  <>
                    <QuietLever className="lever-quiet is-compact" onClick={() => onDecide('same')} disabled={deciding}>
                      Confirm
                    </QuietLever>
                    <QuietLever className="lever-quiet is-compact" onClick={() => onDecide('different')} disabled={deciding}>
                      Reject
                    </QuietLever>
                  </>
                )}
              </span>
            </div>
          </div>
        ) : null}

        {settled ? null : (
          <>
            {pair ? <p className="col-label">Not this one? Pick another</p> : null}
            <form className="tray-field" onSubmit={search}>
              <input
                className="field"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={`Search ${other}`}
              />
              <QuietLever type="submit" disabled={searching}>
                {searching ? 'Searching…' : `Search ${other}`}
              </QuietLever>
            </form>
            {searchError ? (
              <p className="row-sub tray-error" role="alert">
                {searchError}
              </p>
            ) : null}
            <form className="tray-field" onSubmit={pairLink}>
              <input
                className="field"
                value={link}
                onChange={(event) => setLink(event.target.value)}
                placeholder={`Or paste a ${other} link`}
                aria-label={`Paste a ${other} link`}
              />
              <QuietLever type="submit" disabled={deciding || linking || !link.trim()}>
                Pair
              </QuietLever>
            </form>
            {linkError ? (
              <p className="row-sub tray-error" role="alert">
                {linkError}
              </p>
            ) : null}
            {linkWaits && deciding ? (
              <p className="row-sub">Deciding waits until the search or the update ends, or is stopped.</p>
            ) : null}
            {manual?.length === 0 ? (
              <p className="row-sub">Nothing found on {other}.</p>
            ) : (
              <CandidateList title="Search results" rows={results} {...list} />
            )}
            <CandidateList title={`In your ${other} playlist`} rows={leftoverRows} {...list} />
          </>
        )}

        <div className="tray-foot">
          <QuietLever className="lever-quiet is-compact" onClick={onClose}>
            Close
          </QuietLever>
        </div>
      </div>
    </div>
  )
}

/** What the sweep searched for this song, so the owner edits rather than retypes. */
function startingQuery(song, side) {
  const title = side === 'youtube' ? song.name : queryTitle(song)
  return `${title ?? ''} ${song.primaryArtist?.name ?? ''}`.trim()
}

function CandidateList({ title, rows, playingId, onListen, onPair, deciding, other }) {
  if (rows.length === 0) return null
  return (
    <div className="tray-list" role="list" aria-label={title}>
      <p className="col-label tray-list-title">{title}</p>
      {rows.map(({ track, verdict, already }, index) => {
        // A local file has no id, so it never reads as the one playing.
        const playing = playingId != null && playingId === track.id
        return (
          <div className="tray-cand" role="listitem" key={`${track.id}:${index}`}>
            <span className="cell-stack">
              <span className="row-title">{titleOf(track)}</span>
              <span className="row-sub">{artistsOf(track)}</span>
              <span className="row-sub tray-verdict">
                {already ? `Already in your ${other} playlist · ` : ''}
                {verdict}
              </span>
            </span>
            <span className="row-meta num">{formatDuration(track.durationMs)}</span>
            <span className="tray-actions">
              <QuietLever className="lever-quiet is-compact" aria-pressed={playing} onClick={() => onListen(track)}>
                {playing ? '■ Playing' : '▶ Listen'}
              </QuietLever>
              <OpenLink track={track} label="↗ Open" />
              <QuietLever className="lever-quiet is-compact" onClick={() => onPair(track)} disabled={deciding}>
                Pair
              </QuietLever>
            </span>
          </div>
        )
      })}
    </div>
  )
}

function OpenLink({ track, label }) {
  const href = openHref(track)
  return href ? (
    <a className="lever-quiet is-compact" href={href} target="_blank" rel="noreferrer">
      {label}
    </a>
  ) : null
}

function SpotifyPlayer({ track }) {
  if (!track) return <div className="tray-player tray-player-spotify is-empty">Listen to a result to hear it here</div>
  if (!track.id) return <div className="tray-player tray-player-spotify is-empty">A local file can't play here.</div>
  return (
    <iframe
      key={track.id}
      className="tray-player tray-player-spotify"
      title={`Spotify player: ${titleOf(track)}`}
      src={`https://open.spotify.com/embed/track/${track.id}`}
      allow="encrypted-media"
    />
  )
}

function YouTubePlayer({ track, autoplay }) {
  if (!track?.id) return <div className="tray-player tray-player-youtube is-empty">Listen to a result to hear it here</div>
  return (
    <iframe
      key={track.id}
      className="tray-player tray-player-youtube"
      title={`YouTube player: ${titleOf(track)}`}
      src={`https://www.youtube-nocookie.com/embed/${track.id}${autoplay ? '?autoplay=1' : ''}`}
      allow="autoplay; encrypted-media"
      allowFullScreen
    />
  )
}
