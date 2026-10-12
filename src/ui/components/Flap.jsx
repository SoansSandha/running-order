/**
 * The flap character cell.
 *
 * When its number changes it rolls through the numbers in between before
 * landing, the way a split-flap counter turns over to reach the figure it
 * wants: a step of one flips once, and it never shows a number it is not
 * passing through (flapFrames). Stepped, never eased. Under reduced-motion
 * it swaps straight to the new value.
 */

import { useEffect, useRef, useState } from 'react'
import { flapFrames } from '../flapFrames.js'

const TICK_MS = 55
const TICKS = 4

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}

export function FlapText({ value, className = '' }) {
  const [display, setDisplay] = useState(value)
  const [cycling, setCycling] = useState(false)
  const landed = useRef(value)

  useEffect(() => {
    const from = landed.current
    if (from === value) return
    landed.current = value

    if (prefersReducedMotion()) {
      setDisplay(value)
      return
    }

    const frames = flapFrames(from, value, TICKS)
    setCycling(true)
    let tick = 0
    const timer = setInterval(() => {
      tick += 1
      setDisplay(frames[tick - 1])
      if (tick >= frames.length) {
        clearInterval(timer)
        setCycling(false)
      }
    }, TICK_MS)

    return () => clearInterval(timer)
  }, [value])

  return (
    <span className={`flap-cell num ${cycling ? 'is-cycling' : ''} ${className}`.trim()}>
      {display}
    </span>
  )
}
