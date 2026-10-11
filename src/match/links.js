/**
 * Reading a pasted link as one song on Spotify or YouTube Music, for pairing
 * by link in the match tray. See docs/2026-10-10-match-tray-design.md §5.
 *
 * Pure. An album, a playlist, a search page or plain text is not one song, and
 * reads as null.
 */

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_HOSTS = new Set(['music.youtube.com', 'youtube.com', 'm.youtube.com'])

/** @returns {{service: 'spotify'|'youtube', id: string}|null} */
export function parseTrackLink(text) {
  const value = String(text ?? '').trim()
  const uri = /^spotify:track:(\w+)$/.exec(value)
  if (uri) return spotify(uri[1])

  const url = toUrl(value)
  if (!url) return null
  const host = url.hostname.replace(/^www\./, '')
  if (host === 'open.spotify.com') {
    // A localized link carries an /intl-xx/ segment before the type.
    const [type, id] = url.pathname.split('/').filter((part) => part && !part.startsWith('intl-'))
    return type === 'track' ? spotify(id) : null
  }
  if (host === 'youtu.be') return youtube(url.pathname.slice(1))
  if (YOUTUBE_HOSTS.has(host) && url.pathname === '/watch') return youtube(url.searchParams.get('v'))
  return null
}

/** A link pasted without its scheme is still a link. */
function toUrl(value) {
  for (const candidate of [value, `https://${value}`]) {
    try {
      return new URL(candidate)
    } catch {
      // Try the next form.
    }
  }
  return null
}

const spotify = (id) => (SPOTIFY_ID.test(id ?? '') ? { service: 'spotify', id } : null)
const youtube = (id) => (YOUTUBE_ID.test(id ?? '') ? { service: 'youtube', id } : null)
