/**
 * The flap character cell.
 *
 * When its value changes it cycles through intermediate characters before
 * landing, the way a split-flap module runs through the alphabet to reach
 * the letter it wants. Stepped, never eased. Under reduced-motion it swaps
 * straight to the new value.
 */

import { useEffect, useRef, useState } from 'react'

const GLYPHS = '0123456789'
const TICK_MS = 55
const TICKS = 4

function scramble(target) {
  return String(target)
    .split('')
    .map((character) =>
      /\d/.test(character) ? GLYPHS[Math.floor(Math.random() * GLYPHS.length)] : character,
    )
    .join('')
}

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
    if (landed.current === value) return
    landed.current = value

    if (prefersReducedMotion()) {
      setDisplay(value)
      return
    }

    setCycling(true)
    let tick = 0
    const timer = setInterval(() => {
      tick += 1
      if (tick >= TICKS) {
        clearInterval(timer)
        setDisplay(value)
        setCycling(false)
      } else {
        setDisplay(scramble(value))
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
