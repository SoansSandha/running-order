/**
 * Match review: which Spotify track is which YouTube track.
 *
 * Read-only. Decisions go to the match book; nothing is written to Spotify or
 * YouTube. Likely rows warm amber (pending) and settled rows take the green
 * seat (committed), reusing the board's data-moves and data-written states.
 * See docs/2026-10-05-match-review-design.md §3.
 */

import { closestTitles } from '../../match/pairTracks.js'
import { artistsOf, formatCount, formatDelta, titleOf } from '../format.js'
import { useMatchReview } from '../useMatchReview.js'
import { Frame, Head, Lever, LeverRow, Meter, Notice, QuietLever } from '../components/chrome.jsx'
import { UnlitField } from '../components/UnlitField.jsx'

export function ReviewScreen({ app }) {
  const { playlist, tracks, youtube, setScreen } = app
  const review = useMatchReview({ youtube, spotifyTracks: tracks })
  const { result } = review
  const tier = (name) => result?.pairs.filter((pair) => pair.tier === name) ?? []
  const likely = tier('likely')
  const strong = tier('strong')
  const settled = tier('certain')

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
              <PairRow key={`l${pair.spotify.originalIndex}`} pair={pair} state="pending">
                <DecisionLevers pair={pair} review={review} />
              </PairRow>
            ))}

            <GroupHeading count={strong.length}>Strong</GroupHeading>
            {strong.map((pair) => (
              <PairRow key={`s${pair.spotify.originalIndex}`} pair={pair}>
                <DecisionLevers pair={pair} review={review} />
              </PairRow>
            ))}

            <GroupHeading count={result.unmatchedSpotify.length}>Only on Spotify</GroupHeading>
            {result.unmatchedSpotify.map((track) => (
              <OnlySpotifyRow
                key={`o${track.originalIndex}`}
                track={track}
                options={closestTitles(track, result.unmatchedYoutube)}
                onPair={(chosen) => review.decide(track, chosen, 'same')}
              />
            ))}

            <GroupHeading count={result.unmatchedYoutube.length}>Only on YouTube</GroupHeading>
            {result.unmatchedYoutube.map((track) => (
              <div className="board-row" role="row" key={`y${track.originalIndex}`}>
                <span role="cell" />
                <TrackCell track={track} href={youtubeHref(track)} />
                <span role="cell" />
                <span role="cell" className="col-why" />
                <span role="cell" />
              </div>
            ))}

            <details className="review-settled">
              <summary className="review-group col-label">
                Settled (<span className="num">{formatCount(settled.length)}</span>)
              </summary>
              {settled.map((pair) => (
                <PairRow key={`c${pair.spotify.originalIndex}`} pair={pair} state="settled">
                  <QuietLever className="lever-quiet is-compact" onClick={() => review.undo(pair)}>
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
        <span className="spacer" />
        <Lever disabled={strong.length === 0} onClick={() => review.confirmAll(strong)}>
          Confirm all <span className="num">{formatCount(strong.length)}</span> strong
        </Lever>
      </LeverRow>
    </Frame>
  )
}

function GroupHeading({ count, children }) {
  return (
    <p className="review-group col-label">
      {children} (<span className="num">{formatCount(count)}</span>)
    </p>
  )
}

function DecisionLevers({ pair, review }) {
  return (
    <>
      <QuietLever className="lever-quiet is-compact" onClick={() => review.decide(pair.spotify, pair.youtube, 'same')}>
        Confirm
      </QuietLever>
      <QuietLever
        className="lever-quiet is-compact"
        onClick={() => review.decide(pair.spotify, pair.youtube, 'different')}
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
      <TrackCell track={pair.spotify} href={spotifyHref(pair.spotify)} />
      <TrackCell track={pair.youtube} href={youtubeHref(pair.youtube)} />
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

function OnlySpotifyRow({ track, options, onPair }) {
  return (
    <div className="board-row" role="row">
      <TrackCell track={track} href={spotifyHref(track)} />
      <span role="cell">
        <select
          className="field field-compact"
          value=""
          aria-label={`Pair ${titleOf(track)} with a YouTube track`}
          onChange={(event) => {
            const chosen = options[Number(event.target.value)]
            if (chosen) onPair(chosen)
          }}
        >
          <option value="">Pair with…</option>
          {options.map((option, index) => (
            <option key={`${option.originalIndex}`} value={index}>
              {titleOf(option)} — {artistsOf(option)}
            </option>
          ))}
        </select>
      </span>
      <span role="cell" />
      <span role="cell" className="col-why" />
      <span role="cell" />
    </div>
  )
}

function TrackCell({ track, href }) {
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
    </span>
  )
}

// A local file has no id and nothing to link to.
const spotifyHref = (track) => (track?.id ? `https://open.spotify.com/track/${track.id}` : null)
const youtubeHref = (track) => (track?.id ? `https://music.youtube.com/watch?v=${track.id}` : null)
