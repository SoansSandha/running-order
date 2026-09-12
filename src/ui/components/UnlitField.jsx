/**
 * The rest of the board: unlit flaps.
 *
 * A board does not run out into dark page, so whatever frame the seated rows
 * do not fill is carried by blank flaps. This is a real grid rather than a
 * painted background, because an unlit flap still occupies its column module
 * — the hard vertical rules have to continue through it, and a gradient
 * cannot know where the grid tracks fall.
 */

export function UnlitField({ cells }) {
  return (
    <div className="unlit-field" aria-hidden="true">
      {Array.from({ length: cells }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  )
}
