import { describe, expect, test } from 'vitest'
import { STRATEGIES, defaultOptionsFor } from '../sort/index.js'
import { ALBUM_ORDERS } from '../sort/albumGrouped.js'
import {
  UNSUPPORTED_BY_SOURCE,
  UNSUPPORTED_OPTION_VALUES,
  defaultStrategyOptionsFor,
  supportedStrategyFor,
  unsupportedOptionReason,
  unsupportedReason,
  writeUnsupportedReason,
} from './capabilities.js'

/** Every (source, strategy, option, choice) the registry and table describe. */
function everyChoice() {
  const rows = []
  for (const source of ['spotify', 'youtube']) {
    for (const strategy of STRATEGIES) {
      for (const option of strategy.options) {
        for (const choice of option.choices ?? []) {
          rows.push({ source, strategy, option, choice })
        }
      }
    }
  }
  return rows
}

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

describe('unsupportedOptionReason', () => {
  test('Spotify honours every choice of every option', () => {
    for (const { source, strategy, option, choice } of everyChoice()) {
      if (source !== 'spotify') continue
      expect(unsupportedOptionReason(source, strategy.id, option.id, choice.value)).toBeNull()
    }
  })

  // The artist sort itself runs on YouTube — only some of the fields it can
  // be ordered by are missing. A table keyed on strategy ids alone cannot
  // say that, which is why this lookup exists.
  test("names the artist sort's inner orders YouTube cannot honour", () => {
    expect(unsupportedReason('youtube', 'artist')).toBeNull()
    for (const value of ['addedAt', 'releaseDate']) {
      expect(unsupportedOptionReason('youtube', 'artist', 'innerOrder', value)).toMatch(/YouTube/)
    }
  })

  test("leaves the artist sort's inner orders YouTube can honour alone", () => {
    for (const value of ['album', 'title']) {
      expect(unsupportedOptionReason('youtube', 'artist', 'innerOrder', value)).toBeNull()
    }
  })

  // Every YouTube album ties at a null release date, so the sort silently
  // falls through to album-name order under a "Release date" label.
  test('names the release-date album order YouTube cannot honour', () => {
    expect(unsupportedReason('youtube', 'album')).toBeNull()
    expect(
      unsupportedOptionReason('youtube', 'album', 'albumOrder', ALBUM_ORDERS.releaseDate),
    ).toMatch(/YouTube/)
    expect(unsupportedOptionReason('youtube', 'album', 'albumOrder', ALBUM_ORDERS.name)).toBeNull()
  })

  // The value is keyed under the strategy that owns the option, so the same
  // value under the same key on another strategy is a different question.
  test('rules a value out only on the strategy that owns that option', () => {
    expect(unsupportedOptionReason('youtube', 'title', 'innerOrder', 'addedAt')).toBeNull()
    expect(unsupportedOptionReason('youtube', 'artist', 'albumOrder', 'releaseDate')).toBeNull()
  })

  test('treats an unknown source, strategy, option or value as honoured', () => {
    expect(unsupportedOptionReason('something-else', 'artist', 'innerOrder', 'addedAt')).toBeNull()
    expect(unsupportedOptionReason('youtube', 'nope', 'innerOrder', 'addedAt')).toBeNull()
    expect(unsupportedOptionReason('youtube', 'artist', 'nope', 'addedAt')).toBeNull()
    expect(unsupportedOptionReason('youtube', 'artist', 'innerOrder', 'nope')).toBeNull()
  })

  // A plain property read would find Object.prototype.constructor here and
  // report a real choice as unavailable.
  test('does not mistake a prototype key for a table entry', () => {
    expect(unsupportedOptionReason('youtube', 'artist', 'innerOrder', 'constructor')).toBeNull()
    expect(unsupportedOptionReason('youtube', 'artist', 'innerOrder', 'toString')).toBeNull()
  })

  // A typo anywhere in the four levels disables nothing, or disables
  // something that does not exist. Both fail quietly, so assert it is real.
  test('every strategy, option and value in the table is real', () => {
    const byId = new Map(STRATEGIES.map((s) => [s.id, s]))
    for (const [, byStrategy] of Object.entries(UNSUPPORTED_OPTION_VALUES)) {
      for (const [strategyId, byOption] of Object.entries(byStrategy)) {
        const strategy = byId.get(strategyId)
        expect(strategy).toBeDefined()
        for (const [optionId, byValue] of Object.entries(byOption)) {
          const option = strategy.options.find((o) => o.id === optionId)
          expect(option).toBeDefined()
          const values = option.choices.map((c) => c.value)
          for (const [value, reason] of Object.entries(byValue)) {
            expect(values).toContain(value)
            expect(typeof reason).toBe('string')
            expect(reason.length).toBeGreaterThan(0)
          }
        }
      }
    }
  })
})

describe('defaultStrategyOptionsFor, generalised beyond innerOrder', () => {
  // The album sort defaults to release order, which every YouTube album
  // ties on — so it fell through to album-name order while the option row
  // still read "Release date".
  test("replaces the album sort's release-date order on YouTube", () => {
    const out = defaultStrategyOptionsFor('youtube', 'album', {
      albumOrder: ALBUM_ORDERS.releaseDate,
    })
    expect(out.albumOrder).toBe(ALBUM_ORDERS.name)
  })

  test('leaves the album sort alone on Spotify', () => {
    const base = { albumOrder: ALBUM_ORDERS.releaseDate }
    expect(defaultStrategyOptionsFor('spotify', 'album', base)).toEqual(base)
  })

  test('keeps an album order YouTube can honour', () => {
    const out = defaultStrategyOptionsFor('youtube', 'album', { albumOrder: ALBUM_ORDERS.name })
    expect(out.albumOrder).toBe(ALBUM_ORDERS.name)
  })

  test('rewrites whichever unhonourable value the option holds', () => {
    for (const value of ['addedAt', 'releaseDate']) {
      expect(
        defaultStrategyOptionsFor('youtube', 'artist', { innerOrder: value }).innerOrder,
      ).toBe('title')
    }
  })

  test('does not invent keys the caller did not pass', () => {
    expect(defaultStrategyOptionsFor('youtube', 'album', {})).toEqual({})
  })

  // The property that actually matters: whatever a source is handed, what
  // comes back can be honoured. This is what stops a strategy default
  // drifting out of step with the table again.
  test('every strategy default comes back honourable on every source', () => {
    for (const source of ['spotify', 'youtube']) {
      for (const strategy of STRATEGIES) {
        const out = defaultStrategyOptionsFor(source, strategy.id, defaultOptionsFor(strategy.id))
        for (const [optionId, value] of Object.entries(out)) {
          expect(unsupportedOptionReason(source, strategy.id, optionId, value)).toBeNull()
        }
      }
    }
  })

  test('every replacement it can reach is a real choice of that option', () => {
    for (const { source, strategy, option, choice } of everyChoice()) {
      const out = defaultStrategyOptionsFor(source, strategy.id, { [option.id]: choice.value })
      const values = option.choices.map((c) => c.value)
      expect(values).toContain(out[option.id])
      expect(unsupportedOptionReason(source, strategy.id, option.id, out[option.id])).toBeNull()
    }
  })
})

describe('writeUnsupportedReason', () => {
  test('Spotify can be written to', () => {
    expect(writeUnsupportedReason('spotify')).toBeNull()
  })

  // Apply, dry run, clone and undo all go through the Spotify client. On a
  // source with no writer they do not fail politely: two send a YouTube id
  // to Spotify's API and clone creates a real empty playlist in the user's
  // Spotify account before it finds nothing to put in it.
  test('YouTube cannot, and says when it will be able to', () => {
    const reason = writeUnsupportedReason('youtube')
    expect(reason).toMatch(/YouTube Music/)
    expect(reason).toMatch(/later deliverable/)
  })

  // A Spotify playlist carries no `source` field at all, so the value this
  // is asked about is routinely undefined. It must not read as unwritable.
  test('an absent or unknown source is writable', () => {
    expect(writeUnsupportedReason(undefined)).toBeNull()
    expect(writeUnsupportedReason(null)).toBeNull()
    expect(writeUnsupportedReason('something-else')).toBeNull()
  })

  test('is a separate question from whether a sort can be honoured', () => {
    // YouTube can run the artist sort and still not be written to.
    expect(unsupportedReason('youtube', 'artist')).toBeNull()
    expect(writeUnsupportedReason('youtube')).not.toBeNull()
  })
})
