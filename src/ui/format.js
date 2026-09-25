/** Display formatting. Every numeral this returns is set in tabular mono. */

export function formatDuration(ms) {
  if (!ms) return '—'
  const total = Math.round(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Board-style running time: "1H 12M", "4M". */
export function formatRunTime(ms) {
  const minutes = Math.round(ms / 60000)
  if (minutes < 1) return 'UNDER 1M'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours ? `${hours}H ${String(rest).padStart(2, '0')}M` : `${rest}M`
}

/** Added-at as a short board date: "MAR 2021". */
export function formatAdded(iso) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date
    .toLocaleDateString('en-CA', { month: 'short', year: 'numeric' })
    .toUpperCase()
}

/**
 * Reorder time, estimated from the move count. Writes are sequential and
 * Spotify is not fast, so this is deliberately not optimistic.
 */
export function estimateReorder(moveCount) {
  const seconds = Math.ceil((moveCount * 260) / 1000)
  if (moveCount === 0) return 'NONE'
  if (seconds < 60) return `~${seconds}S`
  return `~${Math.ceil(seconds / 60)}M`
}

export function formatCount(value) {
  return new Intl.NumberFormat('en-CA').format(value)
}

export function artistsOf(track) {
  if (track.isEpisode) return track.showName ?? 'Podcast'
  if (track.isUnavailable) return 'No longer available'
  return track.artists.map((artist) => artist.name).join(', ') || '—'
}

export function titleOf(track) {
  if (track.isUnavailable) return 'Unavailable track'
  return track.name || 'Untitled'
}
