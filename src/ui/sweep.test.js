import { describe, expect, test, vi } from 'vitest'
import { sweepHalf } from './sweep.js'

class Fatal extends Error {}

function handlers(over = {}) {
  return {
    find: vi.fn(async (song) => ({ candidates: [song], nearMisses: [] })),
    live: () => true,
    onFound: vi.fn(),
    onFailed: vi.fn(),
    onStopped: vi.fn(),
    isFatal: (failure) => failure instanceof Fatal,
    ...over,
  }
}

describe('sweepHalf', () => {
  test('searches every song in turn and reports each find', async () => {
    const h = handlers()
    await sweepHalf(['a', 'b'], h)
    expect(h.find.mock.calls).toEqual([['a'], ['b']])
    expect(h.onFound.mock.calls.map(([song]) => song)).toEqual(['a', 'b'])
  })

  test('once stopped, it searches nothing more and drops the result in flight', async () => {
    let live = true
    const h = handlers({
      live: () => live,
      find: vi.fn(async (song) => {
        live = false // Stop is pressed while this search is in flight.
        return { candidates: [song], nearMisses: [] }
      }),
    })
    await sweepHalf(['a', 'b'], h)
    expect(h.find).toHaveBeenCalledTimes(1)
    expect(h.onFound).not.toHaveBeenCalled()
  })

  test('a fatal failure ends the half and is reported once', async () => {
    const h = handlers({ find: vi.fn(async () => Promise.reject(new Fatal('The YouTube proxy is not running.'))) })
    await sweepHalf(['a', 'b'], h)
    expect(h.find).toHaveBeenCalledTimes(1)
    expect(h.onStopped.mock.calls.map(([failure]) => failure.message)).toEqual(['The YouTube proxy is not running.'])
    expect(h.onFailed).not.toHaveBeenCalled()
  })

  test('any other failure skips that song and carries on', async () => {
    const h = handlers({
      find: vi.fn(async (song) => {
        if (song === 'a') throw new Error('YouTube proxy returned 502 for /search')
        return { candidates: [song], nearMisses: [] }
      }),
    })
    await sweepHalf(['a', 'b'], h)
    expect(h.onFailed.mock.calls.map(([song]) => song)).toEqual(['a'])
    expect(h.onFound.mock.calls.map(([song]) => song)).toEqual(['b'])
  })
})
