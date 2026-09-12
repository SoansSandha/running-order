import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Spotify refuses http://localhost as a redirect URI but accepts the
    // loopback literal, and the app derives its redirect from the origin it
    // is served on — so these have to be the same address.
    host: '127.0.0.1',
    port: 5173,
    // A silent fallback to 5174 would change the origin and break the match.
    strictPort: true,
  },
})
