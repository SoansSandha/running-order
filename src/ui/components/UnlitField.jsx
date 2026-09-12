/**
 * The rest of the board: unlit flaps.
 *
 * A board does not run out into dark page, so whatever frame the seated rows
 * do not fill is carried by blank flaps. This is a real grid rather than a
 * painted background, because an unlit flap still occupies its column module
 * — the hard vertical rules have to continue through it, and a gradient
 * cannot know where the grid tracks fall.
 *
 * The module count is read off the resolved grid rather than passed in: a
 * literal goes stale the moment a breakpoint changes the column count, and
 * the field then draws rules no seated row has.
 */

import { useLayoutEffect, useRef, useState } from 'react'

export function UnlitField() {
  const field = useRef(null)
  const [cells, setCells] = useState(1)

  useLayoutEffect(() => {
    const element = field.current
    if (!element) return

    const measure = () => {
      const tracks = getComputedStyle(element)
        .gridTemplateColumns.split(' ')
        .filter(Boolean).length
      setCells(tracks || 1)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener('resize', measure)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  return (
    <div className="unlit-field" ref={field} aria-hidden="true">
      {Array.from({ length: cells }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  )
}
