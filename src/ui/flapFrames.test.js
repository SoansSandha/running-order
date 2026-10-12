import { describe, expect, test } from 'vitest'
import { flapFrames } from './flapFrames.js'

const value = (text) => Number(text.replace(/,/g, ''))

describe('flapFrames', () => {
  test('a step of one is a single frame', () => {
    expect(flapFrames('120', '121')).toEqual(['121'])
  })

  test('passes through every number between, never one outside', () => {
    // Stepping each digit on its own would flash 39 on the way from 28 to 31.
    expect(flapFrames('28', '31')).toEqual(['29', '30', '31'])
  })

  test('a long jump shows a few evenly spaced numbers on the way', () => {
    expect(flapFrames('3', '47')).toEqual(['14', '25', '36', '47'])
  })

  test('counts down as well as up', () => {
    expect(flapFrames('10', '7')).toEqual(['9', '8', '7'])
  })

  test('keeps the thousands separator the target uses', () => {
    expect(flapFrames('998', '1,002')).toEqual(['999', '1,000', '1,001', '1,002'])
  })

  test('anything that is not a whole number lands at once', () => {
    expect(flapFrames('—', '12')).toEqual(['12'])
    expect(flapFrames('12', 'Read only')).toEqual(['Read only'])
    expect(flapFrames('5', '5')).toEqual(['5'])
  })

  test('every frame lies between the two values, in order, and ends on the target', () => {
    for (let i = 0; i < 200; i++) {
      const from = Math.floor(Math.random() * 1500)
      const to = Math.floor(Math.random() * 1500)
      const frames = flapFrames(String(from), String(to))
      expect(frames.at(-1)).toBe(String(to))
      const numbers = frames.map(value)
      for (const n of numbers) {
        expect(n).toBeGreaterThanOrEqual(Math.min(from, to))
        expect(n).toBeLessThanOrEqual(Math.max(from, to))
      }
      const sorted = [...numbers].sort((a, b) => (to >= from ? a - b : b - a))
      expect(numbers).toEqual(sorted)
      expect(frames.length).toBeLessThanOrEqual(4)
    }
  })
})
