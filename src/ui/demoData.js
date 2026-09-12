/**
 * SYNTHETIC DATA — development only.
 *
 * Reached with `?demo=1` and gated on `import.meta.env.DEV`, so Vite drops
 * this from a production build. It exists so the board can be inspected and
 * designed against realistic content without a Spotify connection.
 *
 * Track and artist names are real releases; every id, URI, and date here is
 * invented.
 */

import { normalizePlaylistItem } from '../model/track.js'
import { sortTracks } from '../sort/index.js'

const CATALOGUE = [
  ['Radiohead', 'a-radiohead', 'In Rainbows', '2007-10-10', ['15 Step', 'Bodysnatchers', 'Nude', 'Weird Fishes / Arpeggi', 'All I Need', 'Reckoner']],
  ['Radiohead', 'a-radiohead', 'Kid A', '2000-10-02', ['Everything In Its Right Place', 'Kid A', 'The National Anthem', 'How To Disappear Completely', 'Idioteque']],
  ['The Beatles', 'a-beatles', 'Abbey Road', '1969-09-26', ['Come Together', 'Something', 'Oh! Darling', 'Here Comes The Sun', 'Because']],
  ['Beyoncé', 'a-beyonce', 'Lemonade', '2016-04-23', ['Pray You Catch Me', 'Hold Up', 'Sorry', 'Freedom']],
  ['Kendrick Lamar', 'a-kendrick', 'To Pimp A Butterfly', '2015-03-15', ['King Kunta', 'Institutionalized', 'Alright', 'Mortal Man']],
  ['Fleetwood Mac', 'a-fleetwood', 'Rumours', '1977-02-04', ['Dreams', 'Never Going Back Again', 'Go Your Own Way', 'The Chain', 'Songbird']],
  ['Aphex Twin', 'a-aphex', 'Selected Ambient Works 85-92', '1992-02-12', ['Xtal', 'Tha', 'Ageispolis', 'Heliosphan']],
  ['Nina Simone', 'a-nina', 'Pastel Blues', '1965-09-01', ['Be My Husband', 'Nobody Knows You When You’re Down And Out', 'Sinnerman']],
  ['Arctic Monkeys', 'a-arctic', 'AM', '2013-09-09', ['Do I Wanna Know?', 'R U Mine?', 'Arabella', 'Why’d You Only Call Me When You’re High?']],
  ['Talking Heads', 'a-talking', 'Remain In Light', '1980-10-08', ['Born Under Punches', 'Crosseyed And Painless', 'Once In A Lifetime', 'Houses In Motion']],
  ['A Tribe Called Quest', 'a-atcq', 'The Low End Theory', '1991-09-24', ['Excursions', 'Buggin’ Out', 'Jazz (We’ve Got)', 'Check The Rhime']],
  ['Sade', 'a-sade', 'Love Deluxe', '1992-10-26', ['No Ordinary Love', 'Feel No Pain', 'Kiss Of Life', 'Cherish The Day']],
]

function* everyTrack() {
  for (const [artistName, artistId, album, releaseDate, titles] of CATALOGUE) {
    for (const [index, title] of titles.entries()) {
      yield { artistName, artistId, album, releaseDate, title, trackNumber: index + 1 }
    }
  }
}

/** Deterministic, so the board looks the same on every reload. */
function pseudoRandom(seed) {
  let value = seed
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296
    return value / 4294967296
  }
}

function buildTracks() {
  const source = [...everyTrack()]
  const random = pseudoRandom(20260910)

  // Shuffle so the playlist arrives in the disordered state a real one is in.
  for (let i = source.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[source[i], source[j]] = [source[j], source[i]]
  }

  const items = source.map((entry, index) => {
    const year = 2016 + Math.floor(random() * 9)
    const month = 1 + Math.floor(random() * 12)
    const day = 1 + Math.floor(random() * 28)
    return {
      added_at: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00Z`,
      is_local: false,
      track: {
        id: `demo${String(index).padStart(18, '0')}`,
        uri: `spotify:track:demo${String(index).padStart(18, '0')}`,
        name: entry.title,
        type: 'track',
        duration_ms: 140000 + Math.floor(random() * 200000),
        popularity: Math.floor(random() * 100),
        explicit: false,
        track_number: entry.trackNumber,
        disc_number: 1,
        external_ids: {},
        artists: [{ id: entry.artistId, name: entry.artistName }],
        album: {
          id: `al-${entry.album}`,
          name: entry.album,
          release_date: entry.releaseDate,
          release_date_precision: 'day',
        },
      },
    }
  })

  // One unavailable track and one local file, because real playlists have them
  // and they are the cases the board has to handle honestly.
  items.splice(7, 0, { added_at: '2019-04-02T12:00:00Z', track: null })
  items.splice(22, 0, {
    added_at: '2018-11-19T12:00:00Z',
    is_local: true,
    track: {
      id: null,
      uri: 'spotify:local:Unknown:Bootlegs:Live+At+Massey+Hall:214',
      name: 'Live At Massey Hall (bootleg)',
      type: 'track',
      duration_ms: 214000,
      artists: [{ id: null, name: 'Neil Young' }],
      album: { id: null, name: 'Bootlegs', release_date: null },
    },
  })

  return items.map((item, index) => normalizePlaylistItem(item, index))
}

/**
 * A playlist that is already mostly in artist order, with a handful of tracks
 * out of place. Without this every demo row moves, and the holding state —
 * one numeral and a dimmed dash — cannot be seen at all.
 */
function buildNearlySorted(base) {
  const arranged = sortTracks(base, { strategy: 'artist', innerOrder: 'addedAt' }).map(
    (track, index) => ({ ...track, originalIndex: index }),
  )

  for (const [a, b] of [[2, 37], [9, 28], [14, 45], [21, 33], [5, 50], [17, 41]]) {
    if (a < arranged.length && b < arranged.length) {
      ;[arranged[a], arranged[b]] = [arranged[b], arranged[a]]
    }
  }

  return arranged.map((track, index) => ({ ...track, originalIndex: index }))
}

const PLAYLISTS = [
  { id: 'demo-1', name: 'Long Drive', trackCount: 0, editable: true },
  { id: 'demo-2', name: 'Kitchen, Sunday Morning', trackCount: 0, editable: true },
  { id: 'demo-3', name: 'Someone Else’s Mixtape', trackCount: 31, editable: false },
]

/** Null unless `?demo=1` in a dev build. */
export function loadDemo() {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  if (!params.has('demo')) return null

  const shuffled = buildTracks()
  const nearlySorted = buildNearlySorted(shuffled)
  const which = Number(params.get('playlist') ?? '1')
  const tracks = which === 2 ? nearlySorted : shuffled

  const playlists = PLAYLISTS.map((item, index) => ({
    ...item,
    description: '',
    imageUrl: null,
    trackCount: index < 2 ? shuffled.length : item.trackCount,
    owner: { id: index === 2 ? 'someone' : 'demo-user', displayName: index === 2 ? 'A Friend' : 'Demo' },
    collaborative: false,
    isPublic: false,
    snapshotId: `snap-${item.id}`,
  }))

  return {
    me: { id: 'demo-user', displayName: 'Demo', imageUrl: null },
    playlists,
    tracks,
    playlist: playlists[which === 2 ? 1 : 0],
    // Lets a capture land straight on one screen, in a given state.
    screen: params.get('screen') ?? 'playlists',
    // Blocked tracks sort to the bottom, so proving their treatment needs a
    // way to land the board on them.
    focusKey:
      params.get('focus') === 'blocked'
        ? (tracks.find((track) => track.isUnavailable || track.isLocal)?.originalIndex ?? null)
        : null,
    ...progressState(params.get('progress'), tracks),
  }
}

/** Seeds the progress screen mid-run or finished, for inspection. */
function progressState(mode, tracks) {
  if (mode === 'running') {
    return {
      run: { phase: 'running', done: 18, total: 45, turning: tracks[23]?.originalIndex ?? null },
    }
  }
  if (mode === 'done') {
    return { outcome: { kind: 'reordered', applied: 45, total: 45, canUndo: true } }
  }
  return {}
}
