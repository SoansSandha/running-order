/**
 * The board turning over.
 *
 * This is the same board as Preview, not a separate screen: each row flaps
 * as its own write returns, so the animation IS the progress rather than a
 * decoration running beside it.
 */

import { formatCount } from '../format.js'
import { TrackBoard } from '../components/TrackBoard.jsx'
import {
  Frame,
  Head,
  Lever,
  LeverRow,
  Meter,
  Notice,
  QuietLever,
} from '../components/chrome.jsx'

const PHASE_LABEL = {
  running: 'Reordering',
  cloning: 'Building the copy',
  undoing: 'Putting it back',
  dry: 'Dry run',
}

export function ProgressScreen({ app }) {
  const { playlist, previewRows, run, outcome, cancelRun, setScreen, undoLast, tracks, writtenKeys } =
    app

  const turning = run?.turning != null ? new Set([run.turning]) : undefined
  const done = run?.done ?? outcome?.applied ?? 0
  const total = run?.total ?? outcome?.total ?? 0

  return (
    <Frame fill>
      <Head
        back={
          run ? undefined : { label: 'Back to the playlist', onClick: () => setScreen('sort') }
        }
        title={playlist?.name ?? 'Playlist'}
        tally={[
          { label: 'Tracks', value: formatCount(tracks.length) },
          { label: 'Written', value: formatCount(done), tone: 'green', flap: true },
          { label: 'Of', value: formatCount(total) },
        ]}
      />

      {run ? (
        <div className="section" style={{ paddingBottom: 14 }}>
          <p className="col-label" style={{ marginBottom: 8 }}>
            {PHASE_LABEL[run.phase] ?? 'Working'}
          </p>
          <Meter done={done} total={total || 1} />
        </div>
      ) : null}

      {outcome ? (
        <div style={{ padding: '18px 0 0' }}>
          <Outcome outcome={outcome} />
        </div>
      ) : null}

      <div style={{ paddingTop: 18, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <TrackBoard
          rows={previewRows}
          turningKeys={turning}
          writtenKeys={writtenKeys}
          scrollToKey={run?.turning}
          emptyTitle="Nothing to show"
          emptyBody="This playlist has no tracks."
        />
      </div>

      <LeverRow>
        {run ? (
          <>
            <span className="spacer" />
            <QuietLever onClick={cancelRun}>Stop after this move</QuietLever>
          </>
        ) : (
          <>
            {outcome?.canUndo ? <QuietLever onClick={undoLast}>Undo</QuietLever> : null}
            <span className="spacer" />
            <QuietLever onClick={() => setScreen('playlists')}>All playlists</QuietLever>
            <Lever onClick={() => setScreen('sort')}>Sort again</Lever>
          </>
        )}
      </LeverRow>
    </Frame>
  )
}

function Outcome({ outcome }) {
  if (outcome.kind === 'reordered') {
    return (
      <Notice tone="green" title="Order applied">
        {formatCount(outcome.applied)} of {formatCount(outcome.total)} moves written. Date
        added is untouched, so this playlist can be sorted again on the same data.
      </Notice>
    )
  }

  if (outcome.kind === 'cancelled') {
    return (
      <Notice tone="amber" title="Stopped partway">
        {formatCount(outcome.applied)} of {formatCount(outcome.total)} moves were written
        before you stopped. A partly sorted playlist is still a valid playlist —
        undo puts it back, or run it again to finish.
      </Notice>
    )
  }

  if (outcome.kind === 'dry') {
    return (
      <Notice tone="amber" title="Dry run only">
        Nothing was sent. This order would take {formatCount(outcome.total)} write
        {outcome.total === 1 ? '' : 's'}.
      </Notice>
    )
  }

  if (outcome.kind === 'cloned') {
    return (
      <Notice tone="green" title="Copy created">
        {outcome.playlist?.name} holds {formatCount(outcome.added)} tracks.
        {outcome.requested > outcome.added
          ? ` ${formatCount(outcome.requested - outcome.added)} could not be copied: ${formatCount(outcome.skipped.localFiles)} local, ${formatCount(outcome.skipped.unavailable)} unavailable.`
          : ' The original is untouched.'}
      </Notice>
    )
  }

  if (outcome.kind === 'dryClone') {
    return (
      <Notice tone="amber" title="Dry run only">
        Nothing was created. A clone would hold {formatCount(outcome.wouldAdd)} of{' '}
        {formatCount(outcome.requested)} tracks.
      </Notice>
    )
  }

  if (outcome.kind === 'undone') {
    return (
      <Notice tone="green" title="Put back">
        {formatCount(outcome.applied)} moves returned the playlist to the order it
        had before.
      </Notice>
    )
  }

  if (outcome.kind === 'stale') {
    return (
      <Notice tone="amber" title="The playlist moved">
        {outcome.message}
      </Notice>
    )
  }

  return (
    <Notice tone="red" title="Stopped on an error">
      {outcome.message}
      {outcome.applied > 0
        ? ` ${formatCount(outcome.applied)} moves had already been written — undo puts them back.`
        : ' Nothing was written.'}
    </Notice>
  )
}
