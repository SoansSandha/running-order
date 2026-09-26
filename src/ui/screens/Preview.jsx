/**
 * The board, showing the scheduled order against the current one.
 *
 * This is the screen the whole product exists to make possible: nothing is
 * written until it has been read here.
 */

import { estimateReorder, formatCount } from '../format.js'
import { TrackBoard } from '../components/TrackBoard.jsx'
import { Frame, Head, Lever, LeverRow, Notice, QuietLever } from '../components/chrome.jsx'

export function PreviewScreen({ app }) {
  const {
    playlist,
    tracks,
    previewRows,
    movingCount,
    ops,
    strategyLabel,
    setScreen,
    applyInPlace,
    applyClone,
    focusKey,
    writeBlocked,
  } = app

  const blocked = previewRows.filter((row) => row.blocked)
  const nothingToDo = ops.length === 0

  return (
    <Frame fill>
      <Head
        back={{ label: 'Change the order', onClick: () => setScreen('sort') }}
        title={playlist?.name ?? 'Playlist'}
        tally={[
          { label: 'Tracks', value: formatCount(tracks.length) },
          { label: 'Moving', value: formatCount(movingCount), tone: movingCount ? 'amber' : undefined },
          { label: 'Writes', value: formatCount(ops.length) },
          { label: 'Time', value: estimateReorder(ops.length) },
        ]}
      />

      {writeBlocked ? (
        <div style={{ padding: '18px 0 0' }}>
          <Notice tone="amber" title="Nothing here can be written yet">
            {writeBlocked}
          </Notice>
        </div>
      ) : null}

      {nothingToDo && tracks.length > 0 ? (
        <div style={{ padding: '18px 0 0' }}>
          <Notice tone="green" title={`Already in ${strategyLabel} order`}>
            Every track is where this order would put it, so there is nothing to
            write. Cloning would still make a copy.
          </Notice>
        </div>
      ) : null}

      {blocked.length > 0 ? (
        <div style={{ padding: '18px 0 0' }}>
          <Notice tone="red" title={`${blocked.length} cannot be copied`}>
            Local files, and tracks the service no longer serves, can be
            reordered in place but have no URI to add to a new playlist. A
            clone would come back {formatCount(blocked.length)} short.
          </Notice>
        </div>
      ) : null}

      <div style={{ paddingTop: 18, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <TrackBoard
          rows={previewRows}
          scrollToKey={focusKey}
          emptyTitle="Nothing to show"
          emptyBody="This playlist has no tracks."
        />
      </div>

      {/* Every lever here writes through the Spotify client. On a source
          with no writer they are all held, and the notice above says why —
          the levers stay on the board rather than disappearing from it. */}
      <LeverRow>
        <QuietLever
          onClick={() => applyInPlace({ dryRun: true })}
          disabled={nothingToDo || Boolean(writeBlocked)}
          title={writeBlocked ?? undefined}
        >
          Dry run
        </QuietLever>
        <span className="spacer" />
        <QuietLever
          onClick={() => applyClone()}
          disabled={tracks.length === 0 || Boolean(writeBlocked)}
          title={writeBlocked ?? undefined}
        >
          Clone and sort
        </QuietLever>
        <Lever
          onClick={() => applyInPlace()}
          disabled={nothingToDo || !playlist?.editable || Boolean(writeBlocked)}
          title={
            writeBlocked ??
            (playlist?.editable ? undefined : 'You can only clone a playlist you do not own')
          }
        >
          Apply order
        </Lever>
      </LeverRow>
    </Frame>
  )
}
