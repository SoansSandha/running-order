import { useAuth } from './auth/useAuth.js'
import { ConnectScreen } from './ui/screens/Connect.jsx'
import { PlaylistsScreen } from './ui/screens/Playlists.jsx'
import { PreviewScreen } from './ui/screens/Preview.jsx'
import { ProgressScreen } from './ui/screens/Progress.jsx'
import { SortScreen } from './ui/screens/Sort.jsx'
import { setFieldProjection } from './services/spotify/playlists.js'
import { enableApiLog } from './ui/apiLog.js'
import { ApiLog } from './ui/components/ApiLog.jsx'
import { loadDemo } from './ui/demoData.js'
import { useSorterApp } from './ui/useSorterApp.js'

// Dev-only synthetic data, so the board can be designed against realistic
// content without a Spotify connection. Tree-shaken from production builds.
const demo = import.meta.env.DEV ? loadDemo() : null

// ?debug=1 records what the app sends and receives, so a bare "Forbidden"
// can be traced to a request. Dev only.
const debugging =
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('debug')
enableApiLog(debugging)

// ?raw=1 drops the field projection, so the request log shows an item's real
// shape rather than only the fields the projection happened to name.
if (
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('raw')
) {
  setFieldProjection(false)
}

export default function App() {
  const auth = useAuth()
  const app = useSorterApp(auth, demo)

  const screen = !auth.isConnected && !demo
    ? <ConnectScreen auth={auth} />
    : app.screen === 'sort'
      ? <SortScreen app={app} />
      : app.screen === 'preview'
        ? <PreviewScreen app={app} />
        : app.screen === 'progress'
          ? <ProgressScreen app={app} />
          : <PlaylistsScreen app={app} auth={auth} />

  return (
    <>
      {screen}
      {debugging ? <ApiLog /> : null}
    </>
  )
}
