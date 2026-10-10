/**
 * Match review: which Spotify track is which YouTube track.
 *
 * Read-only. Decisions go to the match book; nothing is written to Spotify or
 * YouTube. Likely rows warm amber (pending) and settled rows take the green
 * seat (committed), reusing the board's data-moves and data-written states.
 * "Search all unmatched" looks for the leftovers' twins in the other
 * service's catalogue. See docs/2026-10-05-match-review-design.md §3 and
 * docs/2026-10-08-catalogue-search-design.md §6.
 */

import { spotifyKeyOf } from '../../match/matchBook.js'
import { closestTitles } from '../../match/pairTracks.js'
import { artistsOf, formatCount, formatDelta, titleOf } from '../format.js'
import { useMatchReview } from '../useMatchReview.js'
import { Frame, Head, Lever, LeverRow, Meter, Notice, QuietLever } from '../components/chrome.jsx'
import { UnlitField } from '../components/UnlitField.jsx'

export function ReviewScreen({ app }) {
  const { playlist, tracks, youtube, client, setScreen } = app
  const review = useMatchReview({ youtube, spotify: client, spotifyTracks: tracks })
  const { result, sweep } = review
  const tier = (name) => result?.pairs.filter((pair) => pair.tier === name) ?? []
  const likely = tier('likely')
  const strong = tier('strong')
  const settled = tier('certain')
  // M-1: a row can move mid-decision while a sweep lands results, so deciding
  // waits until it ends or is stopped.
  const deciding = sweep?.running === true

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
            <span className="col-label">Length</span>
            <span className="col-label col-why">Why</span>
            <span className="col-label" />
          </div>

          <div className="board-scroll" role="table" aria-label="Matches">
            <GroupHeading count={likely.length}>Likely — check each one</GroupHeading>
            {likely.map((pair) => (
              <PairRow key={`l${rowKey(pair)}`} pair={pair} state="pending">
                <DecisionLevers pair={pair} review={review} disabled={deciding} />
              </PairRow>
            ))}

            <GroupHeading count={strong.length}>Strong</GroupHeading>
            {strong.map((pair) => (
              <PairRow key={`s${rowKey(pair)}`} pair={pair}>
                <DecisionLevers pair={pair} review={review} disabled={deciding} />
              </PairRow>
            ))}

            <GroupHeading count={result.unmatchedSpotify.length}>Only on Spotify</GroupHeading>
            {result.unmatchedSpotify.map((track) => (
              <PickerRow
                key={`o${track.originalIndex}`}
                track={track}
                side="spotify"
                searchOptions={searchOptionsOf(review.found.forSpotify.get(spotifyKeyOf(track)), 'youtube')}
                playlistOptions={closestTitles(track, result.unmatchedYoutube)}
                onPair={(chosen) => review.decide(track, chosen, 'same')}
                disabled={deciding}
              />
            ))}

            <GroupHeading count={result.unmatchedYoutube.length}>Only on YouTube</GroupHeading>
            {result.unmatchedYoutube.map((track) => (
              <PickerRow
                key={`y${track.originalIndex}`}
                track={track}
                side="youtube"
                searchOptions={searchOptionsOf(review.found.forYoutube.get(track.id), 'spotify')}
                playlistOptions={closestTitles(track, result.unmatchedSpotify)}
                onPair={(chosen) => review.decide(chosen, track, 'same')}
                disabled={deciding}
              />
            ))}

            <details className="review-settled">
              <summary className="review-group col-label">
                Settled (<span className="num">{formatCount(settled.length)}</span>)
              </summary>
              {settled.map((pair) => (
                <PairRow key={`c${rowKey(pair)}`} pair={pair} state="settled">
                  <QuietLever className="lever-quiet is-compact" onClick={() => review.undo(pair)} disabled={deciding}>
                    Undo
                  </QuietLever>
                </PairRow>
              ))}
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

/** Everything a search turned up for one song, accepted first, for Pair with…. */
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

function DecisionLevers({ pair, review, disabled }) {
  return (
    <>
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
    </>
  )
}

function PairRow({ pair, state, children }) {
  return (
    <div
      className="board-row"
      role="row"
      data-moves={state === 'pending' ? 'true' : undefined}
      data-written={state === 'settled' ? 'true' : undefined}
    >
      <TrackCell
        track={pair.spotify}
        href={spotifyHref(pair.spotify)}
        note={pair.missingFrom === 'spotify' ? 'Not in your Spotify playlist' : null}
      />
      <TrackCell
        track={pair.youtube}
        href={youtubeHref(pair.youtube)}
        note={pair.missingFrom === 'youtube' ? 'Not in your YouTube playlist' : null}
      />
      <span className="cell-end" role="cell">
        <span className="row-meta num">{formatDelta(pair.durationDeltaMs)}</span>
      </span>
      <span className="row-sub col-why" role="cell">
        {pair.reason}
      </span>
      <span className="cell-end review-levers" role="cell">
        {children}
      </span>
    </div>
  )
}

/**
 * An unmatched song and its Pair with… picker: what search turned up for it
 * first, then the other playlist's leftovers, closest title first. The picker
 * sits in the other service's column.
 */
function PickerRow({ track, side, searchOptions, playlistOptions, onPair, disabled }) {
  const options = [...searchOptions, ...playlistOptions]
  const other = side === 'spotify' ? 'YouTube' : 'Spotify'
  const own = <TrackCell track={track} href={side === 'spotify' ? spotifyHref(track) : youtubeHref(track)} />
  const picker = (
    <span role="cell">
      <select
        className="field field-compact"
        value=""
        aria-label={`Pair ${titleOf(track)} with a ${other} track`}
        disabled={disabled}
        onChange={(event) => {
          const chosen = options[Number(event.target.value)]
          if (chosen) onPair(chosen)
        }}
      >
        <option value="">Pair with…</option>
        {searchOptions.length > 0 ? (
          <optgroup label="Search results">
            {searchOptions.map((option, index) => (
              <option key={`f${option.id}`} value={index}>
                {titleOf(option)} — {artistsOf(option)}
              </option>
            ))}
          </optgroup>
        ) : null}
        {playlistOptions.length > 0 ? (
          <optgroup label={`In your ${other} playlist`}>
            {playlistOptions.map((option, index) => (
              <option key={`p${option.originalIndex}`} value={searchOptions.length + index}>
                {titleOf(option)} — {artistsOf(option)}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </span>
  )
  return (
    <div className="board-row" role="row">
      {side === 'spotify' ? own : picker}
      {side === 'spotify' ? picker : own}
      <span role="cell" />
      <span role="cell" className="col-why" />
      <span role="cell" />
    </div>
  )
}

function TrackCell({ track, href, note = null }) {
  return (
    <span className="cell-stack" role="cell">
      <span className="row-title">{titleOf(track)}</span>
      <span className="row-sub">
        {artistsOf(track)}
        {href ? (
          <>
            {' · '}
            <a className="row-play" href={href} target="_blank" rel="noreferrer">
              Play
            </a>
          </>
        ) : null}
      </span>
      {note ? <span className="row-sub">{note}</span> : null}
    </span>
  )
}

// A local file has no id and nothing to link to.
const spotifyHref = (track) => (track?.id ? `https://open.spotify.com/track/${track.id}` : null)
const youtubeHref = (track) => (track?.id ? `https://music.youtube.com/watch?v=${track.id}` : null)
