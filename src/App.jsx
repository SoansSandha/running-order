import { useAuth } from './auth/useAuth.js'
import { ConnectScreen } from './ui/screens/Connect.jsx'
import { PlaylistsScreen } from './ui/screens/Playlists.jsx'
import { PreviewScreen } from './ui/screens/Preview.jsx'
import { ProgressScreen } from './ui/screens/Progress.jsx'
import { ReviewScreen } from './ui/screens/Review.jsx'
import { SortScreen } from './ui/screens/Sort.jsx'
import { setFieldProjection } from './services/spotify/playlists.js'
import { enableApiLog } from './ui/apiLog.js'
import { ApiLog } from './ui/components/ApiLog.jsx'
import { loadDemo } from './ui/demoData.js'
import { useRoute } from './ui/route.js'
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
  const [route, navigate] = useRoute()
  const app = useSorterApp(auth, route, navigate, demo)
  // D46: a running write shows Progress whatever the URL says, for the moment
  // before the sync step puts the URL back, so no other screen's lever is on
  // screen mid-write.
  // Mirror run §7, the same hold: the review stays mounted while it writes,
  // so the run keeps its screen and its Stop.
  const view = app.run ? 'progress' : app.mirrorBusy ? 'review' : route.view

  // Connect is a gate, not a route (D45): signed out, it shows at any URL.
  const screen = !auth.isConnected && !demo
    ? <ConnectScreen auth={auth} />
    : view === 'sort'
      ? <SortScreen app={app} />
      : view === 'preview'
        ? <PreviewScreen app={app} />
        : view === 'progress'
          ? <ProgressScreen app={app} />
          : view === 'review'
            ? <ReviewScreen app={app} />
            : <PlaylistsScreen app={app} auth={auth} />

  return (
    <>
      {screen}
      {debugging ? <ApiLog /> : null}
    </>
  )
}
