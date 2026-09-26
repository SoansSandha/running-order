/**
 * Board furniture.
 *
 * Every control here is part of the board object — nothing is a stock
 * widget wearing the palette.
 */

import { useState } from 'react'
import { FlapText } from './Flap.jsx'

/** Authored rather than a glyph: one stroke weight, sized to the label. */
function Chevron() {
  return (
    <svg
      className="chevron"
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M7.5 2.5 3.5 6l4 3.5" />
    </svg>
  )
}

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
            <Chevron />
            {back.label}
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

export function LeverRow({ children, sticky = false }) {
  return (
    <div className="lever-row" data-sticky={sticky ? 'true' : 'false'}>
      {children}
    </div>
  )
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

/**
 * A segmented control, rendered as adjacent flap keys.
 *
 * `disabled` holds the whole row — for a control that is merely busy.
 *
 * `reasonFor` is asked about each choice separately. A non-null answer seats
 * that key unlit and prints why beneath the row. An unavailable choice is
 * never dropped from the row: the row would then silently offer a different
 * set on each service, and a control that has gone missing is harder to
 * understand than one that says what it cannot do.
 */
export function OptionRow({
  value,
  onChange,
  choices,
  label,
  disabled = false,
  reasonFor,
  /* Hide the caption but keep naming the group for screen readers. Used
     where the choices already say what they are and a caption would make
     the control taller than the buttons beside it. */
  labelHidden = false,
  className = '',
}) {
  const keys = choices.map((choice) => ({
    choice,
    reason: reasonFor ? (reasonFor(choice.value) ?? null) : null,
  }))
  const unavailable = keys.filter((key) => key.reason)

  return (
    <div>
      {label && !labelHidden ? <span className="field-label">{label}</span> : null}
      <div className={`option-row ${className}`.trim()} role="group" aria-label={label}>
        {keys.map(({ choice, reason }) => (
          <button
            key={choice.value}
            type="button"
            className="option"
            aria-pressed={value === choice.value}
            disabled={disabled || Boolean(reason)}
            onClick={() => onChange(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
      {unavailable.map(({ choice, reason }) => (
        <p className="option-reason" key={choice.value}>
          {choice.label} — {reason}
        </p>
      ))}
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
