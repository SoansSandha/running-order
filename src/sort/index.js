/**
 * The sort strategy registry and the single entry point the UI calls.
 *
 * Pure module: no network, no browser APIs. See docs design §6.
 *
 * Note there are deliberately no tempo / energy / danceability strategies:
 * Spotify withdrew the audio-features endpoint for new apps in Nov 2024, so
 * offering them would be a promise the API cannot keep.
 */

import { ALBUM_ORDERS, DEFAULT_ALBUM_ORDER, albumGrouped } from './albumGrouped.js'
import { DEFAULT_INNER_ORDER, artistGrouped } from './artistGrouped.js'
import {
  byAddedAt,
  byDuration,
  byOriginalIndex,
  byPopularity,
  byReleaseDate,
  byTitle,
  chain,
  withDirection,
} from './comparators.js'
import { seededShuffle } from './shuffle.js'

/** Build a flat strategy from one primary comparator. */
function flat(comparator, defaultDirection = 'asc') {
  return (tracks, { direction } = {}) =>
    tracks.sort(chain(withDirection(comparator, direction ?? defaultDirection), byOriginalIndex))
}

function select(id, label, defaultValue, choices) {
  return { id, label, type: 'select', default: defaultValue, choices }
}

const direction = (ascLabel, descLabel, defaultValue = 'asc') =>
  select('direction', 'Direction', defaultValue, [
    { value: 'asc', label: ascLabel },
    { value: 'desc', label: descLabel },
  ])

export const STRATEGIES = [
  {
    id: 'artist',
    label: 'Artist',
    description: 'Artists A to Z, with every track by one artist kept together.',
    options: [
      select('innerOrder', 'Within each artist', DEFAULT_INNER_ORDER, [
        { value: 'addedAt', label: 'Date added — oldest at the top' },
        { value: 'releaseDate', label: 'Album release date — oldest album first' },
        { value: 'album', label: 'Album name A to Z' },
        { value: 'title', label: 'Title A to Z' },
      ]),
    ],
    run: (tracks, options) => artistGrouped(tracks, options),
  },
  {
    id: 'album',
    label: 'Album',
    description: 'One block per album, each read in disc and track order.',
    options: [
      select('albumOrder', 'Album order', DEFAULT_ALBUM_ORDER, [
        { value: ALBUM_ORDERS.releaseDate, label: 'Release date — oldest first' },
        { value: ALBUM_ORDERS.name, label: 'Album name A to Z' },
      ]),
    ],
    run: (tracks, options) => albumGrouped(tracks, options),
  },
  {
    id: 'releaseDate',
    label: 'Release date',
    description: 'Straight chronological order by when each track came out.',
    options: [direction('Oldest first', 'Newest first')],
    run: flat(byReleaseDate),
  },
  {
    id: 'addedAt',
    label: 'Date added',
    description: 'The order tracks joined the playlist.',
    options: [direction('Oldest first', 'Newest first')],
    run: flat(byAddedAt),
  },
  {
    id: 'title',
    label: 'Title',
    description: 'Alphabetical by track title, keeping any leading "The".',
    options: [direction('A to Z', 'Z to A')],
    run: flat(byTitle),
  },
  {
    id: 'duration',
    label: 'Duration',
    description: 'By track length.',
    options: [direction('Shortest first', 'Longest first')],
    run: flat(byDuration),
  },
  {
    id: 'popularity',
    label: 'Popularity',
    description: "Spotify's popularity score, which drifts over time.",
    options: [direction('Least popular first', 'Most popular first', 'desc')],
    run: flat(byPopularity, 'desc'),
  },
  {
    id: 'shuffle',
    label: 'Shuffle',
    description: 'A permanent random order. The same seed always shuffles the same way.',
    options: [{ id: 'seed', label: 'Seed', type: 'text', default: '' }],
    run: (tracks, { seed } = {}) => seededShuffle(tracks, seed),
  },
  {
    id: 'reverse',
    label: 'Reverse',
    description: 'Flip the playlist end to end.',
    options: [],
    literal: true,
    run: (tracks) => tracks.reverse(),
  },
]

const BY_ID = new Map(STRATEGIES.map((strategy) => [strategy.id, strategy]))

export function strategyById(id) {
  return BY_ID.get(id)
}

/** Default option values for a strategy, for seeding UI state. */
export function defaultOptionsFor(id) {
  const strategy = strategyById(id)
  if (!strategy) return {}
  return Object.fromEntries(strategy.options.map((option) => [option.id, option.default]))
}

/**
 * Sort a playlist.
 *
 * @param {Array} tracks   normalized Tracks in their current playlist order
 * @param {object} options `{ strategy, direction?, innerOrder?, albumOrder?, seed? }`
 * @returns {Array} a new array — a permutation of `tracks`
 */
export function sortTracks(tracks, options = {}) {
  const strategy = strategyById(options.strategy)
  if (!strategy) throw new Error(`Unknown strategy: ${options.strategy}`)

  // Reverse means reverse. Pinning anything would make it a different sort.
  if (strategy.literal) return strategy.run([...tracks], options)

  // Unavailable tracks carry no sortable data, so they sink to the bottom of
  // every real sort rather than clustering wherever empty strings happen to
  // land.
  const sortable = []
  const unavailable = []
  for (const track of tracks) {
    if (track.isUnavailable) unavailable.push(track)
    else sortable.push(track)
  }

  return [...strategy.run(sortable, options), ...unavailable.sort(byOriginalIndex)]
}
