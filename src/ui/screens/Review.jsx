/**
 * Match review: which Spotify track is which YouTube track.
 *
 * Read-only. Decisions go to the match book; nothing is written to Spotify or
 * YouTube. Likely rows warm amber (pending) and settled rows take the green
 * seat (committed), reusing the board's data-moves and data-written states.
 * "Search all unmatched" looks for the leftovers' twins in the other
 * service's catalogue, and every row opens a tray beneath it where one song
 * is matched by hand. See docs/2026-10-05-match-review-design.md §3,
 * docs/2026-10-08-catalogue-search-design.md §6 and
 * docs/2026-10-10-match-tray-design.md.
 */

import { useState } from 'react'
import { spotifyKeyOf } from '../../match/matchBook.js'
import { closestTitles } from '../../match/pairTracks.js'
import { explainPair } from '../../match/scorePair.js'
import { artistsOf, formatCount, formatDelta, openHref, titleOf } from '../format.js'
import { useMatchReview } from '../useMatchReview.js'
import { Frame, Head, Lever, LeverRow, Meter, Notice, QuietLever } from '../components/chrome.jsx'
import { UnlitField } from '../components/UnlitField.jsx'
import { MatchTray } from './MatchTray.jsx'

export function ReviewScreen({ app }) {
  const { playlist, tracks, youtube, client, setScreen } = app
  const review = useMatchReview({ youtube, spotify: client, spotifyTracks: tracks })
  const { result, sweep } = review
  const [openKey, setOpenKey] = useState(null)
  const tier = (name) => result?.pairs.filter((pair) => pair.tier === name) ?? []
  const likely = tier('likely')
  const strong = tier('strong')
  const settled = tier('certain')
  // M-1: a row can move mid-decision while a sweep lands results, so deciding
  // waits until it ends or is stopped.
  const deciding = sweep?.running === true

  const toggle = (key) => setOpenKey((open) => (open === key ? null : key))
  const close = () => setOpenKey(null)
  const clients = { youtube, spotify: client }

  /** Everything the tray needs to match one playlist song. */
  const trayFor = (song, side, extra = {}) => {
    const onYoutube = side === 'spotify'
    return (
      <MatchTray
        song={song}
        side={side}
        sweepResults={searchOptionsOf(
          onYoutube ? review.found.forYoutube.get(song.id) : review.found.forSpotify.get(spotifyKeyOf(song)),
          side,
        )}
        leftovers={closestTitles(song, onYoutube ? result.unmatchedSpotify : result.unmatchedYoutube)}
        inOtherPlaylist={(track) =>
          onYoutube ? review.spotifyKeys.has(spotifyKeyOf(track)) : review.youtubeIds.has(track.id)
        }
        clients={clients}
        deciding={deciding}
        onPair={(chosen) => {
          const [spotifyTrack, youtubeTrack] = onYoutube ? [chosen, song] : [song, chosen]
          // §3: a pick in a proposal's tray replaces the proposal.
          if (extra.pair) review.pickAnother(extra.pair, spotifyTrack, youtubeTrack)
          else review.decide(spotifyTrack, youtubeTrack, 'same')
          close()
        }}
        onClose={close}
        {...extra}
      />
    )
  }

  /** A pair's tray matches its playlist-side song: the YouTube one for a Spotify find. */
  const pairTray = (pair, state) =>
    trayFor(pair.missingFrom === 'spotify' ? pair.youtube : pair.spotify, pair.missingFrom === 'spotify' ? 'spotify' : 'youtube', {
      pair,
      settled: state === 'settled',
      onDecide: (verdict) => {
        review.decide(pair.spotify, pair.youtube, verdict)
        close()
      },
      onUndo: () => {
        review.undo(pair)
        close()
      },
    })

  return (
    <Frame fill>
      <Head
        back={{ label: 'Back to sorting', onClick: () => setScreen('sort') }}
        title={playlist?.name ?? 'Playlist'}
        tally={
          result
            ? [
                { label: 'Strong', value: formatCount(strong.length) },
                { label: 'Likely', value: formatCount(likely.length), tone: likely.length ? 'amber' : undefined },
                { label: 'Settled', value: formatCount(settled.length), tone: settled.length ? 'green' : undefined },
                { label: 'Only Spotify', value: formatCount(result.unmatchedSpotify.length) },
                { label: 'Only YouTube', value: formatCount(result.unmatchedYoutube.length) },
              ]
            : []
        }
      />

      <div className="section">
        <label className="field-label" htmlFor="review-youtube">
          Match against
        </label>
        <select
          id="review-youtube"
          className="field"
          value={review.chosenId ?? ''}
          onChange={(event) => review.choose(event.target.value)}
        >
          <option value="">Choose a YouTube Music playlist</option>
          {review.youtubePlaylists.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({formatCount(item.trackCount)})
            </option>
          ))}
        </select>
        {review.unavailable > 0 ? (
          <p className="row-sub" style={{ marginTop: 8 }}>
            <span className="num">{formatCount(review.unavailable)}</span> unavailable on YouTube
          </p>
        ) : null}
      </div>

      {review.busy ? (
        <div className="section">
          <p className="col-label" style={{ marginBottom: 8 }}>
            {review.busy}
          </p>
          <Meter done={0} total={1} />
        </div>
      ) : null}

      {review.error ? (
        <div className="section">
          <Notice tone="red" title="Could not read YouTube Music">
            {review.error}
            <div style={{ marginTop: 10 }}>
              <QuietLever className="lever-quiet is-compact" onClick={review.retryPlaylists}>
                Try again
              </QuietLever>
            </div>
          </Notice>
        </div>
      ) : null}

      {review.remembered ? null : (
        <div className="section">
          <Notice tone="amber" title="Decisions will not be remembered">
            This browser is blocking storage for the page, so these decisions last only while this screen is open.
          </Notice>
        </div>
      )}

      {sweep ? (
        <div className="section">
          <p className="col-label" style={{ marginBottom: 8 }}>
            {sweep.running ? 'Searching' : 'Searched'} <span className="num">{formatCount(sweep.done)}</span> of{' '}
            <span className="num">{formatCount(sweep.total)}</span>
            {sweep.failed > 0 ? (
              <>
                {' · '}
                <span className="num">{formatCount(sweep.failed)}</span> search{sweep.failed === 1 ? '' : 'es'} failed
              </>
            ) : null}
          </p>
          <Meter done={sweep.done} total={sweep.total} />
          {sweep.running ? (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
              <QuietLever className="lever-quiet is-compact" onClick={review.stopSearch}>
                Stop
              </QuietLever>
              <span className="row-sub">
                Deciding waits until the search ends or is stopped, so no row moves under the pointer.
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {sweep?.errors.map((failure) => (
        <div className="section" key={failure.label}>
          <Notice tone="red" title={`Could not search ${failure.label}`}>
            {failure.message}
          </Notice>
        </div>
      ))}

      {result ? (
        <div className="board board-review">
          <div className="board-cols" role="row">
            <span className="col-label">Spotify</span>
            <span className="col-label">YouTube Music</span>
            <span className="col-label col-length">Length</span>
            <span className="col-label col-why">Why</span>
            <span className="col-label" />
          </div>

          <div className="board-scroll" role="table" aria-label="Matches">
            <GroupHeading count={likely.length}>Likely — check each one</GroupHeading>
            {likely.map((pair) => {
              const key = `l${rowKey(pair)}`
              return (
                <PairBlock key={key} pair={pair} state="pending" open={openKey === key} tray={() => pairTray(pair, 'pending')}>
                  <TrayToggle open={openKey === key} onClick={() => toggle(key)} label="Listen" />
                  <DecisionLevers pair={pair} review={review} disabled={deciding} />
                </PairBlock>
              )
            })}

            <GroupHeading count={strong.length}>Strong</GroupHeading>
            {strong.map((pair) => {
              const key = `s${rowKey(pair)}`
              return (
                <PairBlock key={key} pair={pair} open={openKey === key} tray={() => pairTray(pair, 'strong')}>
                  <TrayToggle open={openKey === key} onClick={() => toggle(key)} label="Listen" />
                  <DecisionLevers pair={pair} review={review} disabled={deciding} />
                </PairBlock>
              )
            })}

            <GroupHeading count={result.unmatchedSpotify.length}>Only on Spotify</GroupHeading>
            {result.unmatchedSpotify.map((track) => {
              const key = `o${track.originalIndex}`
              return (
                <UnmatchedBlock
                  key={key}
                  track={track}
                  side="spotify"
                  open={openKey === key}
                  onToggle={() => toggle(key)}
                  tray={() => trayFor(track, 'youtube')}
                />
              )
            })}

            <GroupHeading count={result.unmatchedYoutube.length}>Only on YouTube</GroupHeading>
            {result.unmatchedYoutube.map((track) => {
              const key = `y${track.originalIndex}`
              return (
                <UnmatchedBlock
                  key={key}
                  track={track}
                  side="youtube"
                  open={openKey === key}
                  onToggle={() => toggle(key)}
                  tray={() => trayFor(track, 'spotify')}
                />
              )
            })}

            <details className="review-settled">
              <summary className="review-group col-label">
                Settled (<span className="num">{formatCount(settled.length)}</span>)
              </summary>
              {settled.map((pair) => {
                const key = `c${rowKey(pair)}`
                return (
                  <PairBlock key={key} pair={pair} state="settled" open={openKey === key} tray={() => pairTray(pair, 'settled')}>
                    <TrayToggle open={openKey === key} onClick={() => toggle(key)} label="Listen" />
                    <span className="row-decide">
                      <QuietLever className="lever-quiet is-compact" onClick={() => review.undo(pair)} disabled={deciding}>
                        Undo
                      </QuietLever>
                    </span>
                  </PairBlock>
                )
              })}
            </details>

            <UnlitField />
          </div>
        </div>
      ) : null}

      <LeverRow>
        <QuietLever
          onClick={review.searchAll}
          disabled={!result || sweep?.running === true || review.unsearchedCount === 0}
        >
          Search all unmatched
        </QuietLever>
        <span className="spacer" />
        <Lever disabled={strong.length === 0 || deciding} onClick={() => review.confirmAll(strong)}>
          Confirm all <span className="num">{formatCount(strong.length)}</span> strong
        </Lever>
      </LeverRow>
    </Frame>
  )
}

/**
 * A row is keyed by its playlist-side track: a found track's position in a
 * search result is not unique.
 */
const rowKey = (pair) =>
  pair.missingFrom === 'spotify' ? `y${pair.youtube.originalIndex}` : `p${pair.spotify.originalIndex}`

/** Everything the sweep turned up for one song, accepted first. */
function searchOptionsOf(entry, side) {
  if (!entry) return []
  return [...entry.candidates.map((pair) => pair[side]), ...entry.nearMisses]
}

function GroupHeading({ count, children }) {
  return (
    <p className="review-group col-label">
      {children} (<span className="num">{formatCount(count)}</span>)
    </p>
  )
}

function TrayToggle({ open, onClick, label }) {
  return (
    <QuietLever className="lever-quiet is-compact" aria-expanded={open} onClick={onClick}>
      {open ? 'Close' : label}
    </QuietLever>
  )
}

function DecisionLevers({ pair, review, disabled }) {
  return (
    <span className="row-decide">
      <QuietLever
        className="lever-quiet is-compact"
        onClick={() => review.decide(pair.spotify, pair.youtube, 'same')}
        disabled={disabled}
      >
        Confirm
      </QuietLever>
      <QuietLever
        className="lever-quiet is-compact"
        onClick={() => review.decide(pair.spotify, pair.youtube, 'different')}
        disabled={disabled}
      >
        Reject
      </QuietLever>
    </span>
  )
}

/** A pair row, and its tray beneath it when open. */
function PairBlock({ pair, state, open, tray, children }) {
  // §7: a settled row says what the matcher thinks, so a wrong pick stands out.
  const reason = state === 'settled' ? `You confirmed this · the matcher says: ${explainPair(pair.spotify, pair.youtube)}` : pair.reason
  return (
    <>
      <div
        className="board-row"
        role="row"
        data-moves={state === 'pending' ? 'true' : undefined}
        data-written={state === 'settled' ? 'true' : undefined}
      >
        <TrackCell track={pair.spotify} note={pair.missingFrom === 'spotify' ? 'Not in your Spotify playlist' : null} />
        <TrackCell track={pair.youtube} note={pair.missingFrom === 'youtube' ? 'Not in your YouTube playlist' : null} />
        <span className="cell-end col-length" role="cell">
          <span className="row-meta num">{formatDelta(pair.durationDeltaMs)}</span>
        </span>
        <span className="row-sub col-why" role="cell">
          {reason}
        </span>
        <span className="cell-end review-levers" role="cell">
          {children}
        </span>
      </div>
      {open ? tray() : null}
    </>
  )
}

/** An unmatched song, its Find a match lever, and its tray beneath it when open. */
function UnmatchedBlock({ track, side, open, onToggle, tray }) {
  const own = <TrackCell track={track} />
  const none = (
    <span className="row-sub" role="cell">
      No match yet
    </span>
  )
  return (
    <>
      <div className="board-row" role="row">
        {side === 'spotify' ? own : none}
        {side === 'spotify' ? none : own}
        <span role="cell" className="col-length" />
        <span role="cell" className="col-why" />
        <span className="cell-end review-levers" role="cell">
          <TrayToggle open={open} onClick={onToggle} label="Find a match" />
        </span>
      </div>
      {open ? tray() : null}
    </>
  )
}

function TrackCell({ track, note = null }) {
  const href = openHref(track)
  return (
    <span className="cell-stack" role="cell">
      <span className="row-title">{titleOf(track)}</span>
      <span className="row-sub row-sub-links">
        <span className="row-sub-text">{artistsOf(track)}</span>
        {href ? (
          <>
            ·
            <a className="row-play" href={href} target="_blank" rel="noreferrer">
              ↗ Open
            </a>
          </>
        ) : null}
      </span>
      {note ? <span className="row-sub">{note}</span> : null}
    </span>
  )
}
