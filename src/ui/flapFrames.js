/**
 * The values a flap counter shows on its way from one number to the next
 * (src/ui/components/Flap.jsx).
 *
 * Real numbers between the two, evenly spaced and ending on the target, so
 * a counter only ever shows a number it is passing through. A step of one
 * is a single frame. Anything that is not a whole number lands at once.
 */

import { formatCount } from './format.js'

/**
 * @param {string} from the value shown now
 * @param {string} to the value to land on
 * @param {number} [maxFrames] the most frames a change may take
 * @returns {string[]} the frames, the last of which is `to`
 */
export function flapFrames(from, to, maxFrames = 4) {
  const start = wholeNumber(from)
  const end = wholeNumber(to)
  if (start === null || end === null || start === end) return [to]

  const steps = Math.min(maxFrames, Math.abs(end - start))
  const grouped = to.includes(',')
  const frames = []
  for (let step = 1; step < steps; step++) {
    const number = start + Math.round(((end - start) * step) / steps)
    frames.push(grouped ? formatCount(number) : String(number))
  }
  return [...frames, to]
}

/** The whole number a counter's text shows, thousands separators allowed; null for anything else. */
function wholeNumber(text) {
  const digits = String(text ?? '').replace(/,/g, '')
  return /^\d+$/.test(digits) ? Number(digits) : null
}
