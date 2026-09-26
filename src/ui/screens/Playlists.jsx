/**
 * The board of destinations.
 *
 * Playlists owned by someone else stay on the board — they cannot be sorted
 * in place, but they can be cloned and sorted, so hiding them would remove a
 * capability rather than simplify the screen.
 */

import { useEffect, useRef, useState } from 'react'
import { formatCount } from '../format.js'
import {
  BoardEmpty,
  Chip,
  Frame,
  Head,
  Meter,
  Notice,
  OptionRow,
  QuietLever,
} from '../components/chrome.jsx'
import { UnlitField } from '../components/UnlitField.jsx'
import { writeUnsupportedReason } from '../../services/capabilities.js'

const SOURCE_LABELS = { spotify: 'Spotify', youtube: 'YouTube Music' }

/**
 * What can be done to this row, in three states rather than two.
 *
 * The adapter for a source with no writer already refuses to claim the row
 * is editable; labelling it "Clone only" would just swap one promise the
 * app cannot keep for another, exactly as the system pseudo-playlists are
 * dropped rather than shown that way. A Spotify row carries no `source`, so
 * it reads as before.
 */
function accessLabel(item) {
  if (writeUnsupportedReason(item.source)) return 'Read only'
  return item.editable ? 'Editable' : 'Clone only'
}

export function PlaylistsScreen({ app, auth }) {
  const { playlists, busy, error, loadPlaylists, openPlaylist, me, source, setSource } = app
  const [filter, setFilter] = useState('')

  /**
   * Which source the library on the board was fetched for.
   *
   * A plain "already requested" boolean cannot work here: the source toggle
   * lives on this screen, and changing the source only re-asserts the screen
   * it is already on, so this component never unmounts and the ref never
   * resets. The effect does re-fire — `loadPlaylists` is rebuilt whenever the
   * source changes — but a boolean guard swallows it, leaving an empty board
   * claiming the new service returned nothing. Keyed on the source, the guard
   * re-arms for a service it has not read yet and still refuses the duplicate
   * fetch it was put here for.
   */
  const requestedFor = useRef(null)

  useEffect(() => {
    if (requestedFor.current === source) return
    requestedFor.current = source
    loadPlaylists()
  }, [loadPlaylists, source])

  const needle = filter.trim().toLowerCase()
  const shown = needle
    ? playlists.filter((item) => item.name.toLowerCase().includes(needle))
    : playlists

  const editable = playlists.filter((item) => item.editable).length
  const sourceLabel = SOURCE_LABELS[source] ?? source
  const title =
    source === 'youtube' ? `${sourceLabel} Library` : me ? `${me.displayName}'s Library` : 'Library'

  return (
    <Frame fill>
      <Head
        title={title}
        tally={[
          { label: 'Playlists', value: formatCount(playlists.length) },
          { label: 'Editable', value: formatCount(editable), tone: 'green' },
        ]}
      />

      <div
        style={{
          display: 'flex',
          gap: 12,
          // Bottom edges, not centres: the filter field, the source toggle
          // and the levers have three different heights, so centring leaves
          // each sitting at its own level. Aligning the bottoms lands them
          // on one line however tall each happens to be.
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          padding: '18px 0',
        }}
      >
        <input
          className="field"
          style={{ maxWidth: 320 }}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by name"
          aria-label="Filter playlists by name"
        />
        <div style={{ flex: 1 }} />
        <OptionRow
          label="Source"
          labelHidden
          className="option-row-inline"
          value={source}
          onChange={setSource}
          // Switching mid-read lets an in-flight library land on top of the
          // cleared board, leaving rows from one service under the name of
          // the other. Reload is already held for the same reason.
          disabled={Boolean(busy)}
          choices={[
            { value: 'spotify', label: 'Spotify' },
            { value: 'youtube', label: 'YouTube Music' },
          ]}
        />
        <QuietLever onClick={() => loadPlaylists()} disabled={Boolean(busy)}>
          Reload
        </QuietLever>
        <QuietLever onClick={auth.disconnect}>Disconnect</QuietLever>
      </div>

      {error ? (
        <div style={{ marginBottom: 18 }}>
          <Notice tone="red" title="Could not read your library">
            {error}
          </Notice>
        </div>
      ) : null}

      {busy ? (
        <div style={{ paddingBottom: 18 }}>
          <p className="col-label" style={{ marginBottom: 8 }}>
            {busy.label}
          </p>
          <Meter done={busy.done} total={busy.total || 1} />
        </div>
      ) : null}

      <div className="board board-playlists">
      <div className="board-cols" role="row">
        <span className="col-label">Art</span>
        <span className="col-label">Playlist</span>
        <span className="col-label col-artist">Owner</span>
        <span className="col-label">Tracks</span>
        <span className="col-label col-access">Access</span>
      </div>

      <div className="board-scroll" role="table" aria-label="Your playlists">
        {shown.length === 0 && !busy ? (
          <BoardEmpty title={playlists.length ? 'Nothing matches' : 'No playlists yet'}>
            {playlists.length
              ? 'No playlist on the board has that in its name.'
              : `${sourceLabel} returned no playlists for this account.`}
          </BoardEmpty>
        ) : null}

        {shown.map((item) => (
          <button
            key={item.id}
            type="button"
            className="board-row pl-row"
            onClick={() => openPlaylist(item)}
            role="row"
          >
            <span role="cell">
              {item.imageUrl ? (
                <img className="pl-art" src={item.imageUrl} alt="" loading="lazy" />
              ) : (
                <span className="pl-art-blank" aria-hidden="true" />
              )}
            </span>

            <span className="cell-stack" role="cell">
              <span className="row-title">{item.name}</span>
              <span className="row-sub row-mobile-sub">
                {accessLabel(item)} · {formatCount(item.trackCount)}
              </span>
            </span>

            <span className="row-sub row-artist" role="cell">
              {item.owner.displayName}
            </span>

            <span className="cell-end" role="cell">
              <span className="row-meta num">{formatCount(item.trackCount)}</span>
            </span>

            <span className="cell-end pl-access" role="cell">
              {item.editable ? null : <Chip tone="amber">{accessLabel(item)}</Chip>}
            </span>
          </button>
        ))}

        <UnlitField />
      </div>
      </div>
    </Frame>
  )
}
