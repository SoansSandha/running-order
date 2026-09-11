/**
 * Works out which CSV column holds which field.
 *
 * Pure module: no network, no browser APIs. See docs design §7.1.
 *
 * Detection is a best guess that pre-fills a mapping UI the user can always
 * correct — it is never the last word. Header matching is EXACT against a
 * priority-ordered candidate list rather than substring matching, because
 * real exports are full of near-misses: Exportify ships "Track URI" beside
 * "Artist URI(s)" and "Album Name" beside "Album Artist Name(s)", and a
 * substring rule picks the wrong one every time.
 */

const TRACK_URI = /^spotify:track:[A-Za-z0-9]{22}$/
const TRACK_LINK = /open\.spotify\.com\/track\/[A-Za-z0-9]{22}/

const FIELDS = {
  uri: {
    candidates: ['track uri', 'track url', 'track link', 'track id', 'spotify uri', 'spotify id', 'uri', 'url', 'link', 'id'],
    reject: ['artist', 'album', 'playlist'],
  },
  isrc: { candidates: ['isrc'], reject: [] },
  title: {
    candidates: ['track name', 'song name', 'track title', 'title', 'song', 'track', 'name'],
    reject: ['artist', 'album', 'uri', 'url', 'id', 'link', 'number', 'duration', 'date'],
  },
  artist: {
    candidates: ['artist name', 'artist names', 'artists', 'artist', 'performer'],
    reject: ['album', 'uri', 'url', 'id', 'link'],
  },
  album: {
    candidates: ['album name', 'album title', 'album'],
    reject: ['artist', 'uri', 'url', 'id', 'link', 'date', 'release'],
  },
}

const EMPTY = { uri: null, isrc: null, title: null, artist: null, album: null }

/**
 * @param {string[][]} rows the parsed grid
 * @returns {{hasHeader: boolean, columns: object, headers: string[]}}
 */
export function detectColumns(rows) {
  if (!rows.length) return { hasHeader: false, columns: { ...EMPTY }, headers: [] }

  // A row carrying a track URI is data, whatever else it contains. Without
  // this guard a headerless file whose first row happens to hold the word
  // "Song" gets read as a header, and its first track is silently dropped.
  const headerColumns = looksLikeData(rows[0]) ? { ...EMPTY } : matchHeaderRow(rows[0])
  const hasHeader = Object.values(headerColumns).some((index) => index !== null)

  if (hasHeader) {
    return { hasHeader: true, columns: headerColumns, headers: rows[0] }
  }

  // No header to read, so the only field with a recognisable shape is the URI.
  const columns = { ...EMPTY, uri: findUriColumnByValue(rows) }
  return {
    hasHeader: false,
    columns,
    headers: rows[0].map((_, index) => `Column ${index + 1}`),
  }
}

function matchHeaderRow(header) {
  const normalized = header.map(normalizeHeader)
  const columns = { ...EMPTY }

  for (const [field, rule] of Object.entries(FIELDS)) {
    for (const candidate of rule.candidates) {
      const index = normalized.findIndex(
        (name) => name === candidate && !rule.reject.some((word) => name.includes(word) && !candidate.includes(word)),
      )
      if (index !== -1) {
        columns[field] = index
        break
      }
    }
  }

  return columns
}

/** "Artist Name(s)" and "  TRACK_NAME " both need to reduce to a plain key. */
function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/\(s\)/gi, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function findUriColumnByValue(rows) {
  const width = rows[0].length
  for (let column = 0; column < width; column++) {
    const values = rows.map((row) => row[column]).filter(Boolean)
    if (values.length && values.every((value) => TRACK_URI.test(value) || TRACK_LINK.test(value))) {
      return column
    }
  }
  return null
}

function looksLikeData(row) {
  return row.some((cell) => TRACK_URI.test(cell) || TRACK_LINK.test(cell))
}
