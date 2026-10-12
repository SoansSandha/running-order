/**
 * The mirror run's panel (docs/2026-10-11-mirror-run-design.md §7): what an
 * update will change, its progress, and how it ended. Update YouTube itself
 * sits in the review's lever row; Stop and Undo sit here.
 */

import { useState } from 'react'
import { artistsOf, formatCount, titleOf } from '../format.js'
import { Meter, Notice, QuietLever } from '../components/chrome.jsx'

const PHASE_LABEL = {
  guard: 'Checking both playlists',
  addingSpotify: 'Adding to Spotify',
  addingYoutube: 'Adding to YouTube',
  reading: 'Reading both playlists',
  moving: 'Moving',
  verifying: 'Checking the result',
  removingYoutube: 'Removing from YouTube',
  removingSpotify: 'Removing from Spotify',
  restoring: 'Putting YouTube’s order back',
}

const added = (o) => `Added ${formatCount(o.addedToYoutube)} to YouTube and ${formatCount(o.addedToSpotify)} to Spotify.`
const removed = (o) => `Removed ${formatCount(o.removedFromYoutube)} from YouTube and ${formatCount(o.removedFromSpotify)} from Spotify.`
const movedOf = (o) => (o.total > 0 ? ` Moved ${formatCount(o.applied)} of ${formatCount(o.total)}.` : '')

/** @param {{ mirror: object, unavailable: number, waiting: boolean }} props `waiting`: a search sweep is running */
export function MirrorPanel({ mirror, unavailable, waiting }) {
  const { preview, phase, outcome, record, running } = mirror
  const [confirmingUndo, setConfirmingUndo] = useState(false)
  if (!preview) return null

  return (
    <div className="section mirror">
      <p className="col-label" style={{ marginBottom: 8 }}>
        Update YouTube
      </p>

      {running ? (
        <>
          <p className="row-sub" style={{ marginBottom: 8 }}>
            {PHASE_LABEL[phase.name]}
            {phase.total > 0 ? (
              <>
                {' '}
                <span className="num">{formatCount(phase.done)}</span> of <span className="num">{formatCount(phase.total)}</span>
              </>
            ) : null}
          </p>
          <Meter done={phase.done} total={phase.total || 1} />
          <div className="mirror-undo">
            <QuietLever className="lever-quiet is-compact" onClick={mirror.stop}>
              Stop
            </QuietLever>
            <span className="row-sub">Deciding waits until the update ends or is stopped.</span>
          </div>
        </>
      ) : (
        <MirrorPlan mirror={mirror} unavailable={unavailable} />
      )}

      {!running && outcome ? <MirrorOutcome outcome={outcome} /> : null}
      {!running && mirror.rereadFailed ? (
        <Notice tone="amber" title="The board may be out of date">
          The playlists could not be read again after the update. Choose the YouTube playlist again, or reload this
          screen, before running again.
        </Notice>
      ) : null}

      {!running && record ? (
        <div className="mirror-undo">
          {confirmingUndo ? (
            <>
              {/* Each addition once: write-ahead can record one twice (P6). */}
              <p className="row-sub">
                Remove {formatCount(new Set(record.addedToYoutube.map((e) => e.setVideoId ?? `v:${e.videoId}`)).size)} from
                YouTube and {formatCount(new Set(record.addedToSpotify).size)} from Spotify
                {record.reordered === false ? '.' : ', and put YouTube’s order back.'}
              </p>
              <QuietLever
                className="lever-quiet is-compact"
                onClick={() => {
                  setConfirmingUndo(false)
                  mirror.undo()
                }}
              >
                Undo
              </QuietLever>
              <QuietLever className="lever-quiet is-compact" onClick={() => setConfirmingUndo(false)}>
                Keep it
              </QuietLever>
            </>
          ) : (
            <QuietLever className="lever-quiet is-compact" onClick={() => setConfirmingUndo(true)} disabled={waiting}>
              Undo last update
            </QuietLever>
          )}
        </div>
      ) : null}
    </div>
  )
}

function MirrorPlan({ mirror, unavailable }) {
  const { preview, reorder, setReorder, keepsData } = mirror
  if (preview.blocked > 0) {
    return (
      <p className="row-sub">
        Settle <span className="num">{formatCount(preview.blocked)}</span> more song{preview.blocked === 1 ? '' : 's'} first
      </p>
    )
  }
  if (preview.spotifyLocked) return <p className="row-sub">This Spotify playlist isn’t yours to add to.</p>

  const toYoutube = preview.addToYoutube.length
  const toSpotify = preview.addToSpotify.length
  return (
    <>
      <p className="row-sub">
        {preview.nothingToDo ? (
          reorder ? 'YouTube already matches.' : 'Nothing to add.'
        ) : (
          <>
            Add <span className="num">{formatCount(toYoutube)}</span> to YouTube · Add{' '}
            <span className="num">{formatCount(toSpotify)}</span> to Spotify ·{' '}
            {reorder ? (
              <>
                about <span className="num">{formatCount(preview.moves)}</span> moves
              </>
            ) : (
              'Order left as it is'
            )}
          </>
        )}
      </p>
      <label className="mirror-toggle">
        <input type="checkbox" checked={reorder} onChange={(event) => setReorder(event.target.checked)} />
        Also reorder YouTube to Spotify’s order
      </label>
      {toYoutube + toSpotify > 0 ? (
        <details className="mirror-list">
          <summary className="col-label">
            Songs to add (<span className="num">{formatCount(toYoutube + toSpotify)}</span>)
          </summary>
          {preview.addToYoutube.map((track) => (
            <MirrorRow key={`y${track.id}`} track={track} where="To YouTube" />
          ))}
          {preview.addToSpotify.map((track) => (
            <MirrorRow key={`s${track.id}`} track={track} where="To Spotify" />
          ))}
        </details>
      ) : null}
      {reorder && preview.bottom.length > 0 ? (
        <details className="mirror-list">
          <summary className="col-label">
            Going to the bottom (<span className="num">{formatCount(preview.bottom.length)}</span>)
          </summary>
          {preview.bottom.map((track) => (
            <MirrorRow key={`b${track.itemId}`} track={track} where="Not on Spotify" />
          ))}
        </details>
      ) : null}
      {unavailable > 0 ? (
        <p className="row-sub">
          <span className="num">{formatCount(unavailable)}</span> item{unavailable === 1 ? '' : 's'} YouTube won’t show us{' '}
          {unavailable === 1 ? 'stays' : 'stay'} where {unavailable === 1 ? 'it is' : 'they are'}.
        </p>
      ) : null}
      {keepsData ? null : (
        <Notice tone="amber" title="Undo will not be remembered">
          Undo will last only until you leave this screen: this browser isn’t keeping site data.
        </Notice>
      )}
    </>
  )
}

function MirrorRow({ track, where }) {
  return (
    <div className="mirror-row">
      <span className="mirror-song">
        {titleOf(track)} · {artistsOf(track)}
      </span>
      <span className="row-sub">{where}</span>
    </div>
  )
}

function MirrorOutcome({ outcome }) {
  if (outcome.kind === 'stale') {
    return (
      <Notice tone="amber" title="Nothing was written">
        A playlist changed since the preview. It has been re-read: check the new preview.
      </Notice>
    )
  }
  if (outcome.kind === 'failed') {
    return (
      <Notice tone="red" title={outcome.of === 'undo' ? 'Undo stopped' : 'The update stopped'}>
        {outcome.message}
      </Notice>
    )
  }
  if (outcome.kind === 'stopped') {
    return (
      <Notice tone="amber" title="Stopped">
        {added(outcome)}
        {movedOf(outcome)} Run it again to finish, or Undo.
      </Notice>
    )
  }
  if (outcome.kind === 'undoStopped') {
    return (
      <Notice tone="amber" title="Undo stopped">
        {removed(outcome)}
        {movedOf(outcome)} Undo again to finish.
      </Notice>
    )
  }
  if (outcome.kind === 'undone') {
    return (
      <Notice tone="green" title="Put back">
        {removed(outcome)}
        {outcome.restored ? ' YouTube’s order is back.' : ''}
      </Notice>
    )
  }
  const summary = `${added(outcome)}${outcome.total > 0 ? ` Moved ${formatCount(outcome.applied)}.` : ''}`
  return (
    <>
      {outcome.matches === false ? (
        <Notice tone="amber" title="YouTube shows a different order">
          {summary} YouTube shows a different order than the one written. If this playlist is set to sort by date in
          YouTube Music, set it to Manual and run again.
        </Notice>
      ) : (
        <Notice tone="green" title="YouTube updated">
          {summary}
        </Notice>
      )}
      {outcome.unpaired.length > 0 ? (
        <Notice tone="amber" title="Added, but not paired">
          {outcome.unpaired.map(titleOf).join(', ')}: the service added a different track than the one asked for, so it
          did not pair. Check it on the board.
        </Notice>
      ) : null}
    </>
  )
}
