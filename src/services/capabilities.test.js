import { describe, expect, test } from 'vitest'
import { STRATEGIES } from '../sort/index.js'
import {
  UNSUPPORTED_BY_SOURCE,
  defaultStrategyOptionsFor,
  supportedStrategyFor,
  unsupportedReason,
} from './capabilities.js'

describe('unsupportedReason', () => {
  test('Spotify supports every strategy', () => {
    for (const s of STRATEGIES) expect(unsupportedReason('spotify', s.id)).toBeNull()
  })

  test('YouTube cannot sort by the three fields it does not return', () => {
    for (const id of ['addedAt', 'releaseDate', 'popularity']) {
      expect(unsupportedReason('youtube', id)).toMatch(/YouTube/)
    }
  })

  test('YouTube supports the rest', () => {
    for (const id of ['artist', 'album', 'title', 'duration', 'shuffle', 'reverse']) {
      expect(unsupportedReason('youtube', id)).toBeNull()
    }
  })

  test('an unknown source is treated as fully capable rather than crashing', () => {
    expect(unsupportedReason('something-else', 'addedAt')).toBeNull()
  })

  // A typo in the table would silently disable nothing, or disable a strategy
  // that does not exist. Both fail quietly, so assert the table is real.
  test('every id in the table is a real strategy id', () => {
    const ids = new Set(STRATEGIES.map((s) => s.id))
    for (const [, reasons] of Object.entries(UNSUPPORTED_BY_SOURCE)) {
      for (const id of Object.keys(reasons)) expect(ids).toContain(id)
    }
  })
})

describe('defaultStrategyOptionsFor', () => {
  test('leaves Spotify options alone', () => {
    const base = { innerOrder: 'addedAt' }
    expect(defaultStrategyOptionsFor('spotify', 'artist', base)).toEqual(base)
  })

  test("replaces the artist sort's date-added inner order on YouTube", () => {
    // The default inner order is date added, which YouTube does not have.
    // Leaving it would make the most-used sort quietly do something else.
    const out = defaultStrategyOptionsFor('youtube', 'artist', { innerOrder: 'addedAt' })
    expect(out.innerOrder).toBe('title')
  })

  test('replaces the release-date inner order on YouTube too', () => {
    const out = defaultStrategyOptionsFor('youtube', 'artist', { innerOrder: 'releaseDate' })
    expect(out.innerOrder).toBe('title')
  })

  test('keeps an inner order YouTube can honour', () => {
    const out = defaultStrategyOptionsFor('youtube', 'artist', { innerOrder: 'album' })
    expect(out.innerOrder).toBe('album')
  })

  test('passes through options for strategies with no inner order', () => {
    expect(defaultStrategyOptionsFor('youtube', 'title', { direction: 'desc' }))
      .toEqual({ direction: 'desc' })
  })

  // The 'title' strategy owns no `innerOrder` option. Passing baseOptions
  // that happen to hold an `innerOrder` key with an unsupported value proves
  // the replacement is keyed off which strategy owns the option, not off
  // whatever key shows up in baseOptions.
  test('leaves a stray innerOrder key untouched on a strategy that does not own it', () => {
    const out = defaultStrategyOptionsFor('youtube', 'title', { innerOrder: 'addedAt' })
    expect(out.innerOrder).toBe('addedAt')
  })
})

describe('supportedStrategyFor', () => {
  test('keeps a strategy the source can honour', () => {
    expect(supportedStrategyFor('youtube', 'artist')).toBe('artist')
  })

  test('keeps every strategy on Spotify', () => {
    for (const s of STRATEGIES) expect(supportedStrategyFor('spotify', s.id)).toBe(s.id)
  })

  // Left selected, a disabled strategy renders pressed and disabled at once,
  // still orders the preview, and cannot be cleared — the only control that
  // would clear it is the disabled row itself.
  test('substitutes a strategy the source cannot honour', () => {
    for (const id of ['addedAt', 'releaseDate', 'popularity']) {
      const chosen = supportedStrategyFor('youtube', id)
      expect(chosen).not.toBe(id)
      expect(unsupportedReason('youtube', chosen)).toBeNull()
    }
  })

  test('whatever it returns is always a real, supported strategy', () => {
    const ids = new Set(STRATEGIES.map((s) => s.id))
    for (const s of STRATEGIES) {
      for (const source of ['spotify', 'youtube']) {
        const chosen = supportedStrategyFor(source, s.id)
        expect(ids).toContain(chosen)
        expect(unsupportedReason(source, chosen)).toBeNull()
      }
    }
  })

  // The CSV order is not in the strategy registry, and no source rules it
  // out — it reorders tracks already in hand. It must survive a source
  // switch rather than being swapped for a sort the user did not ask for.
  test('leaves an id outside the registry alone', () => {
    expect(supportedStrategyFor('youtube', 'csv')).toBe('csv')
  })

  test('leaves an unknown source fully capable', () => {
    expect(supportedStrategyFor('something-else', 'addedAt')).toBe('addedAt')
  })
})
