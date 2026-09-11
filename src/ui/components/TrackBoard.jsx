/**
 * The board proper: a dense, windowed table of flap rows.
 *
 * The left gutter carries two numerals — where a track is now, and where it
 * is scheduled to be. That gutter is what makes a reorder legible, so it is
 * the last thing to collapse on a narrow screen.
 *
 * Rows are windowed because playlists are expected to grow well past the
 * ~400 they hold today (design D9).
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { artistsOf, formatAdded, formatDuration, titleOf } from '../format.js'
import { FlapText } from './Flap.jsx'
import { BoardEmpty } from './chrome.jsx'

const DESKTOP_ROW_HEIGHT = 46
const MOBILE_ROW_HEIGHT = 58
const OVERSCAN = 10

function currentRowHeight() {
  if (typeof window === 'undefined') return DESKTOP_ROW_HEIGHT
  return window.innerWidth <= 680 ? MOBILE_ROW_HEIGHT : DESKTOP_ROW_HEIGHT
}

export function TrackBoard({ rows, turningKeys, emptyTitle, emptyBody, scrollToKey }) {
  const scroller = useRef(null)
  const [rowHeight, setRowHeight] = useState(currentRowHeight)
  const [range, setRange] = useState({ start: 0, end: 60 })

  useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return

    const measure = () => {
      const height = currentRowHeight()
      setRowHeight(height)
      const start = Math.max(0, Math.floor(element.scrollTop / height) - OVERSCAN)
      const visible = Math.ceil(element.clientHeight / height) + OVERSCAN * 2
      setRange({ start, end: Math.min(rows.length, start + visible) })
    }

    measure()
    element.addEventListener('scroll', measure, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)

    return () => {
      element.removeEventListener('scroll', measure)
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [rows.length])

  // Follow the reorder as it happens, so the turning row stays on screen.
  useEffect(() => {
    if (scrollToKey == null || !scroller.current) return
    const index = rows.findIndex((row) => row.key === scrollToKey)
    if (index < 0) return
    const element = scroller.current
    const target = index * rowHeight
    if (target < element.scrollTop || target > element.scrollTop + element.clientHeight - rowHeight * 2) {
      element.scrollTo({ top: Math.max(0, target - element.clientHeight / 2) })
    }
  }, [scrollToKey, rows, rowHeight])

  if (rows.length === 0) {
    return <BoardEmpty title={emptyTitle}>{emptyBody}</BoardEmpty>
  }

  const visible = rows.slice(range.start, range.end)

  return (
    <>
      <div className="board-cols" role="row">
        <span className="col-label">Pos</span>
        <span className="col-label">Track</span>
        <span className="col-label col-artist">Artist</span>
        <span className="col-label col-added">Added</span>
        <span className="col-label">Dur</span>
      </div>

      <div
        className="board-scroll"
        ref={scroller}
        role="table"
        aria-label="Playlist order"
        aria-rowcount={rows.length}
      >
        <div style={{ height: range.start * rowHeight }} />

        {visible.map((row, offset) => (
          <BoardRow
            key={row.key}
            row={row}
            rowIndex={range.start + offset + 1}
            turning={turningKeys?.has(row.key)}
          />
        ))}

        <div style={{ height: Math.max(0, (rows.length - range.end) * rowHeight) }} />
      </div>
    </>
  )
}

function BoardRow({ row, rowIndex, turning }) {
  const { track, from, to, moves, blocked } = row

  return (
    <div
      className={`board-row${turning ? ' is-turning' : ''}`}
      data-moves={moves ? 'true' : 'false'}
      data-blocked={blocked ? 'true' : 'false'}
      role="row"
      aria-rowindex={rowIndex}
    >
      <span className="slots" role="cell">
        {moves ? (
          <>
            <span className="slot-from num">{from}</span>
            <span className="slot-lead" aria-hidden="true">
              ›
            </span>
            <FlapText className="slot-to" value={String(to)} />
          </>
        ) : (
          <>
            <span className="slot-hold num">{from}</span>
            <span className="slot-dash" aria-hidden="true">
              ·
            </span>
          </>
        )}
      </span>

      <span role="cell" style={{ minWidth: 0 }}>
        <span className="row-title">{titleOf(track)}</span>
        <span className="row-sub row-mobile-sub">{artistsOf(track)}</span>
      </span>

      <span className="row-sub row-artist" role="cell">
        {artistsOf(track)}
      </span>

      <span className="row-meta row-added num" role="cell">
        {formatAdded(track.addedAt)}
      </span>

      <span className="row-meta num" role="cell">
        {formatDuration(track.durationMs)}
      </span>
    </div>
  )
}
