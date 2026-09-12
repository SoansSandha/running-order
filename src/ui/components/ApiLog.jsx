/**
 * Dev-only traffic log, shown when the app is opened with `?debug=1`.
 *
 * Exists because Spotify's error messages are frequently one word. Seeing the
 * exact URL beside the exact response body is the difference between fixing a
 * problem and guessing at it.
 */

import { useEffect, useState } from 'react'
import { readApiLog, subscribeApiLog, summarizeBody } from '../apiLog.js'

export function ApiLog() {
  const [events, setEvents] = useState(readApiLog)
  const [open, setOpen] = useState(true)

  useEffect(() => subscribeApiLog(setEvents), [])

  return (
    <aside className="api-log" data-open={open ? 'true' : 'false'}>
      <button type="button" className="api-log-toggle" onClick={() => setOpen(!open)}>
        Request log · {events.length}
      </button>

      {open ? (
        <div className="api-log-body">
          {events.length === 0 ? <p className="api-log-empty">No requests yet.</p> : null}
          {events.map((event, index) => (
            <details key={`${event.at}-${index}`} open={event.status >= 400}>
              <summary>
                <span className="api-log-status" data-bad={event.status >= 400 ? 'true' : 'false'}>
                  {event.status}
                </span>
                {event.method} {event.url.replace('https://api.spotify.com/v1', '')}
              </summary>
              <pre>{summarizeBody(event.body)}</pre>
            </details>
          ))}
        </div>
      ) : null}
    </aside>
  )
}
