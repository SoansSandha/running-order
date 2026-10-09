import { describe, expect, test } from 'vitest'
import {
  forgetDecision,
  loadMatchBook,
  recordDecision,
  saveMatchBook,
  spotifyKeyOf,
  verdictLookup,
} from './matchBook.js'

function memoryStorage() {
  const store = new Map()
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
    store,
  }
}

const blockedStorage = {
  getItem() {
    throw new Error('blocked')
  },
  setItem() {
    throw new Error('blocked')
  },
  removeItem() {
    throw new Error('blocked')
  },
}

// Verbatim from the live Spotify export: a local file carries no id.
const LOCAL_URI = 'spotify:local:Alfaaz%3B+Yo+Yo+Honey+Singh:Boy+Next+Door:Haye+Mera+Dil:203'

const same = (spotifyKey, youtubeVideoId) => ({ spotifyKey, youtubeVideoId, verdict: 'same' })

describe('spotifyKeyOf', () => {
  test('a catalogue track is filed under its id', () => {
    expect(spotifyKeyOf({ id: '4uLU6hMCjMI75M1A2tKUQC', uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC' })).toBe(
      '4uLU6hMCjMI75M1A2tKUQC',
    )
  })

  test('a local file, which has no id, is filed under its URI', () => {
    expect(spotifyKeyOf({ id: null, uri: LOCAL_URI })).toBe(LOCAL_URI)
  })
})

describe('the match book', () => {
  test('a recorded decision is found again', () => {
    const book = recordDecision([], same('s1', 'y1'), 1)
    expect(verdictLookup(book)('s1', 'y1')).toBe('same')
  })

  test('an undecided pair has no verdict', () => {
    const book = recordDecision([], same('s1', 'y1'), 1)
    expect(verdictLookup(book)('s1', 'y2')).toBeNull()
  })

  test('deciding a pair again replaces the earlier decision', () => {
    const first = recordDecision([], same('s1', 'y1'), 1)
    const second = recordDecision(first, { spotifyKey: 's1', youtubeVideoId: 'y1', verdict: 'different' }, 2)
    expect(second).toEqual([{ spotifyKey: 's1', youtubeVideoId: 'y1', verdict: 'different', decidedAt: 2 }])
  })

  test('forgetting a pair removes only that pair', () => {
    const book = recordDecision(recordDecision([], same('s1', 'y1'), 1), same('s2', 'y2'), 2)
    const lookup = verdictLookup(forgetDecision(book, 's1', 'y1'))
    expect(lookup('s1', 'y1')).toBeNull()
    expect(lookup('s2', 'y2')).toBe('same')
  })

  test('recording does not change the book it was given', () => {
    const book = Object.freeze([{ spotifyKey: 's1', youtubeVideoId: 'y1', verdict: 'same', decidedAt: 1 }])
    recordDecision(book, { spotifyKey: 's1', youtubeVideoId: 'y1', verdict: 'different' }, 2)
    expect(book[0].verdict).toBe('same')
  })

  test('a decision about a local file is found by its URI', () => {
    const book = recordDecision([], same(LOCAL_URI, 'y1'), 1)
    expect(verdictLookup(book)(spotifyKeyOf({ id: null, uri: LOCAL_URI }), 'y1')).toBe('same')
  })
})

describe('storing the match book', () => {
  test('a saved book loads back unchanged', () => {
    const storage = memoryStorage()
    const book = recordDecision([], same('s1', 'y1'), 1)
    expect(saveMatchBook(book, storage)).toBe(true)
    expect(loadMatchBook(storage)).toEqual(book)
  })

  test('it is stored under the playlist-sorter prefix', () => {
    const storage = memoryStorage()
    saveMatchBook([], storage)
    expect([...storage.store.keys()]).toEqual(['playlist-sorter:match-book'])
  })

  test('an empty store is an empty book', () => {
    expect(loadMatchBook(memoryStorage())).toEqual([])
  })

  test.each([['not json'], ['{"spotifyKey":"s1"}'], ['null']])(
    'a store holding %s is an empty book, not a crash',
    (raw) => {
      const storage = memoryStorage()
      storage.setItem('playlist-sorter:match-book', raw)
      expect(loadMatchBook(storage)).toEqual([])
    },
  )

  test('entries that are not decisions are dropped on load', () => {
    const storage = memoryStorage()
    const good = { spotifyKey: 's1', youtubeVideoId: 'y1', verdict: 'same', decidedAt: 1 }
    storage.setItem(
      'playlist-sorter:match-book',
      JSON.stringify([good, { spotifyKey: 's2', youtubeVideoId: 'y2', verdict: 'maybe' }, { spotifyKey: 3 }, null]),
    )
    expect(loadMatchBook(storage)).toEqual([good])
  })

  test('a store that refuses to be read is an empty book', () => {
    expect(loadMatchBook(blockedStorage)).toEqual([])
  })

  test('a store that refuses to be written says so', () => {
    expect(saveMatchBook([], blockedStorage)).toBe(false)
  })
})
