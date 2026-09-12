/**
 * A short record of what the app actually sent and received.
 *
 * Off unless `?debug=1`. Spotify's own error messages are often a single word
 * — "Forbidden" tells you nothing about which request failed or why — so this
 * keeps the request, the status, and the response body where they can be
 * read without a devtools round trip.
 */

const MAX_EVENTS = 12
const events = []
let enabled = false
const listeners = new Set()

export function enableApiLog(on) {
  enabled = on
}

export function isApiLogEnabled() {
  return enabled
}

export function recordApiEvent(event) {
  if (!enabled) return
  events.unshift({ ...event, at: new Date().toISOString() })
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS
  for (const listener of listeners) listener(readApiLog())
}

export function readApiLog() {
  return [...events]
}

export function subscribeApiLog(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Trim a body down to something readable on screen. */
export function summarizeBody(body) {
  if (body === null || body === undefined) return 'null'
  if (Array.isArray(body)) return JSON.stringify(body.slice(0, 1), null, 2)
  if (typeof body === 'object' && Array.isArray(body.items)) {
    return JSON.stringify(
      { ...body, items: body.items.slice(0, 1) },
      null,
      2,
    )
  }
  return JSON.stringify(body, null, 2)
}
