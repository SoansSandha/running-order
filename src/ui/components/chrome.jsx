/**
 * Board furniture.
 *
 * Every control here is part of the board object — nothing is a stock
 * widget wearing the palette.
 */

import { useState } from 'react'
import { FlapText } from './Flap.jsx'

export function Frame({ children, fill = false }) {
  return (
    <div className="frame" data-fill={fill ? 'true' : 'false'}>
      <div className="frame-inner">{children}</div>
    </div>
  )
}

/**
 * The head rule: destination on the left at display scale, tally on the
 * right. Composed as one object, not a toolbar above a list.
 */
export function Head({ back, title, tally = [] }) {
  return (
    <header className="head">
      <div className="head-id">
        {back ? (
          <button type="button" className="head-back" onClick={back.onClick}>
            <span aria-hidden="true">&lsaquo;</span> {back.label}
          </button>
        ) : null}
        <h1 className="destination">{title}</h1>
      </div>
      {tally.length > 0 ? (
        <div className="tally">
          {tally.map((cell) => (
            <div className="tally-cell" key={cell.label}>
              <span className="col-label">{cell.label}</span>
              <span className="tally-value num" data-tone={cell.tone}>
                {cell.flap ? <FlapText value={String(cell.value)} /> : cell.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </header>
  )
}

export function Lever({ children, ...props }) {
  return (
    <button type="button" className="lever" {...props}>
      {children}
    </button>
  )
}

export function QuietLever({ children, ...props }) {
  return (
    <button type="button" className="lever-quiet" {...props}>
      {children}
    </button>
  )
}

export function LeverRow({ children }) {
  return <div className="lever-row">{children}</div>
}

export function Chip({ tone, children }) {
  return (
    <span className="chip" data-tone={tone}>
      {children}
    </span>
  )
}

export function Notice({ tone = 'amber', title, children }) {
  return (
    <div className="notice" data-tone={tone} role={tone === 'red' ? 'alert' : undefined}>
      {title ? <p className="notice-title">{title}</p> : null}
      <div className="prose">{children}</div>
    </div>
  )
}

export function BoardEmpty({ title, children }) {
  return (
    <div className="board-empty">
      <p className="board-heading">{title}</p>
      <div className="prose" style={{ margin: '0 auto' }}>
        {children}
      </div>
    </div>
  )
}

/** A value the user must paste somewhere else, with a copy action. */
export function CopyStrip({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="copy-strip">
      <code>{value}</code>
      <button type="button" onClick={copy}>
        {copied ? 'Copied' : label}
      </button>
    </div>
  )
}

/** A segmented control, rendered as adjacent flap keys. */
export function OptionRow({ value, onChange, choices, label }) {
  return (
    <div>
      {label ? <span className="field-label">{label}</span> : null}
      <div className="option-row" role="group" aria-label={label}>
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className="option"
            aria-pressed={value === choice.value}
            onClick={() => onChange(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Meter({ done, total }) {
  const fraction = total > 0 ? Math.min(1, done / total) : 0
  return (
    <div
      className="track-meter"
      role="progressbar"
      aria-valuenow={done}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      <div className="track-meter-fill" style={{ transform: `scaleX(${fraction})` }} />
    </div>
  )
}
