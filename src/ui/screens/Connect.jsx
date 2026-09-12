/**
 * Connect: the only screen a stranger would ever see, and there are no
 * strangers — this is a personal tool, so the setup notes stay terse.
 *
 * The redirect URI is shown with a copy action because a mismatch is the
 * single most common setup failure, and Spotify reports it on its own error
 * page where this app never gets a chance to explain.
 */

import { currentRedirectUri } from '../../auth/spotifyAuth.js'
import { CopyStrip, Frame, Head, Lever, LeverRow, Notice } from '../components/chrome.jsx'

export function ConnectScreen({ auth }) {
  const { clientId, setClientId, connect, status, error } = auth
  const connecting = status === 'connecting' || status === 'restoring'

  return (
    <Frame fill>
      <Head
        title="Playlist Sorter"
        tally={[{ label: 'Service', value: status === 'restoring' ? 'RESUMING' : 'AWAITING' }]}
      />

      <div className="section-centred">
      <div className="split">
        <div className="prose">
          <p>
            Reorders a Spotify playlist in place, or into a sorted copy. It moves
            tracks rather than replacing them, so <strong>date added survives</strong> and
            the same playlist can be sorted again later.
          </p>
          <p>
            Nothing is written until you have seen the change. There is no server:
            your credentials stay in this browser.
          </p>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            connect()
          }}
        >
          <div style={{ marginBottom: 22 }}>
            <label className="field-label" htmlFor="client-id">
              Client ID
            </label>
            <input
              id="client-id"
              className="field"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="32-character id from your Spotify app"
              autoComplete="off"
              spellCheck="false"
            />
          </div>

          <div style={{ marginBottom: 22 }}>
            <span className="field-label">Redirect URI to register</span>
            <CopyStrip value={currentRedirectUri()} />
            <p className="prose" style={{ fontSize: 'var(--fs-sub)', marginTop: 8 }}>
              Paste this into your app's settings exactly, trailing slash included.
              Spotify rejects <code>localhost</code>, so the loopback address is not
              interchangeable with it.
            </p>
          </div>

          {error ? (
            <div style={{ marginBottom: 22 }}>
              <Notice tone="red" title="Not connected">
                {error}
              </Notice>
            </div>
          ) : null}

          <LeverRow>
            <Lever type="submit" disabled={!clientId.trim() || connecting}>
              {connecting ? 'Connecting' : 'Connect'}
            </Lever>
          </LeverRow>
        </form>
      </div>
      </div>
    </Frame>
  )
}
