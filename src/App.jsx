import { useAuth } from './auth/useAuth.js'
import { ConnectScreen } from './ui/screens/Connect.jsx'
import { PlaylistsScreen } from './ui/screens/Playlists.jsx'
import { PreviewScreen } from './ui/screens/Preview.jsx'
import { ProgressScreen } from './ui/screens/Progress.jsx'
import { SortScreen } from './ui/screens/Sort.jsx'
import { loadDemo } from './ui/demoData.js'
import { useSorterApp } from './ui/useSorterApp.js'

// Dev-only synthetic data, so the board can be designed against realistic
// content without a Spotify connection. Tree-shaken from production builds.
const demo = import.meta.env.DEV ? loadDemo() : null

export default function App() {
  const auth = useAuth()
  const app = useSorterApp(auth, demo)

  if (!auth.isConnected && !demo) return <ConnectScreen auth={auth} />

  if (app.screen === 'sort') return <SortScreen app={app} />
  if (app.screen === 'preview') return <PreviewScreen app={app} />
  if (app.screen === 'progress') return <ProgressScreen app={app} />
  return <PlaylistsScreen app={app} auth={auth} />
}
