/**
 * The board of destinations.
 *
 * Playlists owned by someone else stay on the board — they cannot be sorted
 * in place, but they can be cloned and sorted, so hiding them would remove a
 * capability rather than simplify the screen.
 */

import { useEffect, useRef, useState } from 'react'
import { formatCount } from '../format.js'
import { BoardEmpty, Chip, Frame, Head, Meter, Notice, QuietLever } from '../components/chrome.jsx'
import { UnlitField } from '../components/UnlitField.jsx'

export function PlaylistsScreen({ app, auth }) {
  const { playlists, busy, error, loadPlaylists, openPlaylist, me } = app
  const [filter, setFilter] = useState('')
  const requested = useRef(false)

  useEffect(() => {
    if (requested.current) return
    requested.current = true
    loadPlaylists()
  }, [loadPlaylists])

  const needle = filter.trim().toLowerCase()
  const shown = needle
    ? playlists.filter((item) => item.name.toLowerCase().includes(needle))
    : playlists

  const editable = playlists.filter((item) => item.editable).length

  return (
    <Frame fill>
      <Head
        title={me ? `${me.displayName}'s Library` : 'Library'}
        tally={[
          { label: 'Playlists', value: formatCount(playlists.length) },
          { label: 'Editable', value: formatCount(editable), tone: 'green' },
        ]}
      />

      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
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
      </div>

      <div className="board-scroll" role="table" aria-label="Your playlists">
        {shown.length === 0 && !busy ? (
          <BoardEmpty title={playlists.length ? 'Nothing matches' : 'No playlists yet'}>
            {playlists.length
              ? 'No playlist on the board has that in its name.'
              : 'Spotify returned no playlists for this account.'}
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
                {item.editable ? 'Editable' : 'Clone only'} · {formatCount(item.trackCount)}
              </span>
            </span>

            <span className="row-sub row-artist" role="cell">
              {item.owner.displayName}
            </span>

            <span className="cell-end" role="cell">
              <span className="row-meta num">{formatCount(item.trackCount)}</span>
              {item.editable ? null : <Chip tone="amber">Clone only</Chip>}
            </span>
          </button>
        ))}

        <UnlitField />
      </div>
      </div>
    </Frame>
  )
}
