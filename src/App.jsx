/**
 * Placeholder shell.
 *
 * The real screens (Connect / Playlists / Sort / Preview / Progress) are the
 * next piece of work — see docs/STATUS.md. This exists so `npm run dev`
 * serves something honest while the logic layers are built and tested
 * underneath it.
 */

import { STRATEGIES } from './sort/index.js'

const layers = [
  { name: 'model/', role: 'Track normalization', done: true },
  { name: 'sort/', role: 'Sort strategies', done: true },
  { name: 'plan/', role: 'Reorder diff algorithm', done: true },
  { name: 'api/', role: 'Spotify read and write calls', done: true },
  { name: 'auth/', role: 'PKCE handshake and tokens', done: true },
  { name: 'csv/', role: 'CSV parsing and matching', done: false },
  { name: 'ui/', role: 'The five screens', done: false },
]

export default function App() {
  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>Spotify Playlist Sorter</h1>
        <p style={styles.subtitle}>
          Logic layers built and tested. The interface is not built yet.
        </p>
      </header>

      <section style={styles.section}>
        <h2 style={styles.heading}>Layers</h2>
        <ul style={styles.list}>
          {layers.map((layer) => (
            <li key={layer.name} style={styles.row}>
              <span style={{ ...styles.dot, background: layer.done ? '#1db954' : '#3a3a3a' }} />
              <code style={styles.code}>{layer.name}</code>
              <span style={styles.role}>{layer.role}</span>
              <span style={styles.state}>{layer.done ? 'tested' : 'not started'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section style={styles.section}>
        <h2 style={styles.heading}>Sort strategies available</h2>
        <ul style={styles.list}>
          {STRATEGIES.map((strategy) => (
            <li key={strategy.id} style={styles.row}>
              <span style={styles.strategyName}>{strategy.label}</span>
              <span style={styles.role}>{strategy.description}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

const styles = {
  page: {
    maxWidth: '46rem',
    margin: '0 auto',
    padding: '4rem 1.5rem',
    font: '15px/1.6 ui-sans-serif, system-ui, sans-serif',
    color: '#e8e8e8',
  },
  header: { marginBottom: '3rem' },
  title: { margin: 0, fontSize: '1.6rem', fontWeight: 600, color: '#fff', letterSpacing: '-0.02em' },
  subtitle: { margin: '0.5rem 0 0', color: '#9a9a9a' },
  section: { marginBottom: '2.5rem' },
  heading: {
    margin: '0 0 1rem',
    fontSize: '0.75rem',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#8a8a8a',
  },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.6rem' },
  row: { display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' },
  dot: { width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0 },
  code: { fontFamily: 'ui-monospace, monospace', color: '#fff', minWidth: '4.5rem' },
  strategyName: { color: '#fff', minWidth: '8rem' },
  role: { color: '#9a9a9a', flex: 1, minWidth: '12rem' },
  state: { color: '#6a6a6a', fontSize: '0.8rem' },
}
