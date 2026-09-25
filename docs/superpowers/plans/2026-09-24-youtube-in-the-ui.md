# YouTube Music in the UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pick YouTube Music in the app, see your YouTube playlists beside your Spotify ones, open one, and sort it — with the strategies YouTube cannot support visibly disabled rather than quietly wrong.

**Architecture:** The read path already works end to end (proxy → client → normalizer, verified live against a 383-track playlist). Nothing in `src/ui/` imports it. This plan adds a `source` to the app state, branches the two loading functions on it, adds a source toggle, and gates the sort strategies each service can actually honour.

**Tech Stack:** React 19, Vite 8, JavaScript (ES modules, **not** TypeScript), Vitest, Oxlint.

**Spec:** [`docs/2026-09-18-youtube-mirror-design.md`](../../2026-09-18-youtube-mirror-design.md) — §1 (the three modes), §6, D20 (capability registry).

## Global Constraints

- **JavaScript, not TypeScript.** JSDoc only. No new runtime dependencies.
- **`npm test` starts at 323 passing** and must pass at the end of every task. `npm run lint` clean — two pre-existing warnings in `Flap.jsx` and `useAuth.js` are expected and not yours to fix.
- **Spotify behaviour must not change.** Every existing screen, sort and write path behaves exactly as before. The source defaults to Spotify.
- **A dead or absent proxy must never break Spotify use** (D14). YouTube failures stay inside the YouTube branch.
- **Pure layers stay pure.** `src/model/`, `src/sort/`, `src/csv/`, `src/plan/` perform no network I/O.
- **Never invent metadata.** A strategy YouTube cannot support is disabled with the reason shown — never silently reordered to something else (Product Principle 4).

## A gap to be honest about

Tasks 1 and 2 are pure functions and are fully tested. **Tasks 3 and 4 are not
tested at all**, because this repo has no component-test infrastructure — no
testing-library, no jsdom — and `src/ui/` carries no tests today. Adding that
framework is a larger change than this feature.

So the gate for the UI layer is Task 4's end-to-end verification against the
real library, run by hand. That is weaker than a test, it does not run in CI,
and it will not catch a regression later. It is stated here rather than
implied so nobody reads "339 passing" as covering the wiring.

The mitigation is that the two pieces carrying real logic — the playlist
adapter and the capability table — are pure and tested, so the untested part
is wiring rather than judgment.

## Facts this plan is built on

Measured live on 2026-09-24, not assumed:

| Fact | Value |
|---|---|
| `GET /playlists` returns | `{id, title, count}` — `count` is `null` for `LM` and `SE` |
| The user's YouTube library | `LM` (Liked Music), `PLT8…` (punjabi songs, 386), `SE` (Episodes for Later) |
| The playlist shape the UI renders | `{id, name, trackCount, owner: {displayName}, editable}` — see `Playlists.jsx:117-128` |
| Sorts that work on YouTube | artist, title, duration, shuffle, reverse |
| Sorts that cannot | date added, release date, popularity — YouTube returns none of those fields |
| The artist sort's default inner order | `addedAt` — which YouTube lacks, so the default must change per source |

---

## Task 1: Adapt YouTube playlists to the shape the UI renders

**Files:**
- Create: `src/services/youtube/playlists.js`
- Test: `src/services/youtube/playlists.test.js`

**Interfaces:**
- Consumes: `createYouTubeClient(...).listPlaylists()` → `[{id, title, count}]`
- Produces: `toAppPlaylists(rawPlaylists)` → the same shape `src/services/spotify/playlists.js` produces:

```js
{ id, name, trackCount, owner: { id, displayName }, isPublic, snapshotId, editable, source }
```

- [ ] **Step 1: Write the failing test**

Create `src/services/youtube/playlists.test.js`:

```js
import { describe, expect, test } from 'vitest'
import { toAppPlaylists } from './playlists.js'

const RAW = [
  { id: 'LM', title: 'Liked Music', count: null },
  { id: 'PL123', title: 'punjabi songs', count: 386 },
  { id: 'SE', title: 'Episodes for Later', count: null },
]

describe('toAppPlaylists', () => {
  test('maps a real playlist onto the shape the UI renders', () => {
    const [pl] = toAppPlaylists([RAW[1]])
    expect(pl.id).toBe('PL123')
    expect(pl.name).toBe('punjabi songs')
    expect(pl.trackCount).toBe(386)
    expect(pl.editable).toBe(true)
    expect(pl.source).toBe('youtube')
  })

  test('carries an owner so the UI does not read undefined', () => {
    // Playlists.jsx renders item.owner.displayName unguarded.
    const [pl] = toAppPlaylists([RAW[1]])
    expect(pl.owner).toEqual({ id: null, displayName: 'YouTube Music' })
  })

  test('drops the system pseudo-playlists', () => {
    // LM and SE are YouTube's own lists. They cannot be reordered, and
    // showing them as "Clone only" would promise a clone we cannot perform.
    expect(toAppPlaylists(RAW).map((p) => p.id)).toEqual(['PL123'])
  })

  test('has no snapshot id, because YouTube has no such concept', () => {
    expect(toAppPlaylists([RAW[1]])[0].snapshotId).toBeNull()
  })

  test('survives a null count on a non-system playlist', () => {
    const [pl] = toAppPlaylists([{ id: 'PL9', title: 'x', count: null }])
    expect(pl.trackCount).toBe(0)
  })

  test('returns an empty array for no input', () => {
    expect(toAppPlaylists(null)).toEqual([])
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

```bash
npx vitest run src/services/youtube/playlists.test.js
```

Expected: FAIL — cannot resolve `./playlists.js`.

- [ ] **Step 3: Write the adapter**

Create `src/services/youtube/playlists.js`:

```js
/**
 * Adapts the proxy's playlist list to the shape the UI already renders for
 * Spotify, so the playlists screen needs no knowledge of which service a row
 * came from.
 *
 * Pure module: no network. The client fetches; this maps.
 */

/**
 * YouTube's own lists. `LM` is Liked Music and `SE` is Episodes for Later —
 * neither is a real playlist and neither can be reordered, so they are left
 * out rather than shown as something the app cannot act on.
 */
const SYSTEM_PLAYLIST_IDS = new Set(['LM', 'SE'])

/**
 * @param {Array<{id: string, title: string, count: number|null}>} rawPlaylists
 * @returns {Array<object>} playlists in the app's shared shape
 */
export function toAppPlaylists(rawPlaylists) {
  return (rawPlaylists ?? [])
    .filter((raw) => raw?.id && !SYSTEM_PLAYLIST_IDS.has(raw.id))
    .map((raw) => ({
      id: raw.id,
      name: raw.title ?? '',
      trackCount: raw.count ?? 0,
      // The screen reads owner.displayName unguarded. YouTube's listing names
      // no owner, and everything it returns is the signed-in user's own.
      owner: { id: null, displayName: 'YouTube Music' },
      isPublic: false,
      // No snapshot id exists; the pre-write guard re-fetches and compares
      // contents instead. See spec §11.
      snapshotId: null,
      editable: true,
      source: 'youtube',
    }))
}
```

- [ ] **Step 4: Run the suite**

```bash
npm test && npm run lint
```

Expected: `329 passed` (323 + 6), lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/services/youtube/
git commit -m "Adapt YouTube playlists to the shape the UI renders"
```

---

## Task 2: Declare what each service can sort by

Spec D20. YouTube returns no date added, release year or popularity, so three strategies cannot work there. They must be disabled with the reason shown, never silently reordered into something else.

**Files:**
- Create: `src/services/capabilities.js`
- Test: `src/services/capabilities.test.js`

**Interfaces:**
- Consumes: `STRATEGIES` from `src/sort/index.js` (for the test only)
- Produces:
  - `unsupportedReason(source, strategyId)` → a string reason, or `null` when supported
  - `defaultStrategyOptionsFor(source, strategyId, baseOptions)` → options with any unsupported choice replaced
  - `UNSUPPORTED_BY_SOURCE` — the table itself, exported so the test can assert every id in it is a real strategy

- [ ] **Step 1: Write the failing test**

Create `src/services/capabilities.test.js`:

```js
import { describe, expect, test } from 'vitest'
import { STRATEGIES } from '../sort/index.js'
import {
  UNSUPPORTED_BY_SOURCE,
  defaultStrategyOptionsFor,
  unsupportedReason,
} from './capabilities.js'

describe('unsupportedReason', () => {
  test('Spotify supports every strategy', () => {
    for (const s of STRATEGIES) expect(unsupportedReason('spotify', s.id)).toBeNull()
  })

  test('YouTube cannot sort by the three fields it does not return', () => {
    for (const id of ['addedAt', 'releaseDate', 'popularity']) {
      expect(unsupportedReason('youtube', id)).toMatch(/YouTube/)
    }
  })

  test('YouTube supports the rest', () => {
    for (const id of ['artist', 'album', 'title', 'duration', 'shuffle', 'reverse']) {
      expect(unsupportedReason('youtube', id)).toBeNull()
    }
  })

  test('an unknown source is treated as fully capable rather than crashing', () => {
    expect(unsupportedReason('something-else', 'addedAt')).toBeNull()
  })

  // A typo in the table would silently disable nothing, or disable a strategy
  // that does not exist. Both fail quietly, so assert the table is real.
  test('every id in the table is a real strategy id', () => {
    const ids = new Set(STRATEGIES.map((s) => s.id))
    for (const [, reasons] of Object.entries(UNSUPPORTED_BY_SOURCE)) {
      for (const id of Object.keys(reasons)) expect(ids).toContain(id)
    }
  })
})

describe('defaultStrategyOptionsFor', () => {
  test('leaves Spotify options alone', () => {
    const base = { innerOrder: 'addedAt' }
    expect(defaultStrategyOptionsFor('spotify', 'artist', base)).toEqual(base)
  })

  test("replaces the artist sort's date-added inner order on YouTube", () => {
    // The default inner order is date added, which YouTube does not have.
    // Leaving it would make the most-used sort quietly do something else.
    const out = defaultStrategyOptionsFor('youtube', 'artist', { innerOrder: 'addedAt' })
    expect(out.innerOrder).toBe('title')
  })

  test('replaces the release-date inner order on YouTube too', () => {
    const out = defaultStrategyOptionsFor('youtube', 'artist', { innerOrder: 'releaseDate' })
    expect(out.innerOrder).toBe('title')
  })

  test('keeps an inner order YouTube can honour', () => {
    const out = defaultStrategyOptionsFor('youtube', 'artist', { innerOrder: 'album' })
    expect(out.innerOrder).toBe('album')
  })

  test('passes through options for strategies with no inner order', () => {
    expect(defaultStrategyOptionsFor('youtube', 'title', { direction: 'desc' }))
      .toEqual({ direction: 'desc' })
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

```bash
npx vitest run src/services/capabilities.test.js
```

Expected: FAIL — cannot resolve `./capabilities.js`.

- [ ] **Step 3: Write the capability table**

Create `src/services/capabilities.js`:

```js
/**
 * What each service can actually sort by.
 *
 * YouTube Music returns no date added, no release year and no popularity —
 * measured against a real library, not inferred. A control that quietly does
 * nothing is worse than one that is visibly unavailable, so these are stated
 * rather than hidden (Product Principle 4, spec D20).
 *
 * Pure module: a table and two lookups.
 */

const YOUTUBE_MISSING = 'YouTube Music does not provide this'

export const UNSUPPORTED_BY_SOURCE = {
  youtube: {
    addedAt: `${YOUTUBE_MISSING} — it returns no date added`,
    releaseDate: `${YOUTUBE_MISSING} — it returns no release year`,
    popularity: `${YOUTUBE_MISSING} — it has no popularity score`,
  },
}

/** Inner orders of the artist sort, in the same terms. */
const UNSUPPORTED_INNER_ORDERS = {
  youtube: new Set(['addedAt', 'releaseDate']),
}

/** Used when a source cannot honour the configured inner order. */
const FALLBACK_INNER_ORDER = 'title'

/**
 * @returns {string|null} why this strategy is unavailable, or null if it works
 */
export function unsupportedReason(source, strategyId) {
  return UNSUPPORTED_BY_SOURCE[source]?.[strategyId] ?? null
}

/**
 * Replace any option value the source cannot honour.
 *
 * The artist sort defaults to ordering by date added, which YouTube lacks —
 * left alone, the most-used sort would silently do something other than its
 * label says.
 */
export function defaultStrategyOptionsFor(source, strategyId, baseOptions) {
  const options = { ...baseOptions }
  if (UNSUPPORTED_INNER_ORDERS[source]?.has(options.innerOrder)) {
    options.innerOrder = FALLBACK_INNER_ORDER
  }
  return options
}
```

- [ ] **Step 4: Run the suite**

```bash
npm test && npm run lint
```

Expected: `339 passed` (329 + 10), lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/services/capabilities.js src/services/capabilities.test.js
git commit -m "Declare which sorts each service can honour"
```

---

## Task 3: Give the app a source, and load from it

**Files:**
- Modify: `src/ui/useSorterApp.js`

**Interfaces:**
- Consumes: `toAppPlaylists` (Task 1), `defaultStrategyOptionsFor` (Task 2), `createYouTubeClient` and `normalizeYouTubeTracks` from `src/services/youtube/`
- Produces: the hook's returned object gains `source` (`'spotify' | 'youtube'`) and `setSource(next)`. Everything already returned keeps its name and meaning.

- [ ] **Step 1: Read the file first**

Read `src/ui/useSorterApp.js` in full before editing. You are threading a new dimension through existing state; know what is there.

- [ ] **Step 2: Add the imports and the source state**

Add beside the existing imports:

```js
import { defaultStrategyOptionsFor } from '../services/capabilities.js'
import { createYouTubeClient } from '../services/youtube/client.js'
import { toAppPlaylists } from '../services/youtube/playlists.js'
import { normalizeYouTubeTracks } from '../services/youtube/track.js'
```

Then, beside the other `useState` calls:

```js
const [source, setSource] = useState(demo?.source ?? 'spotify')
const youtube = useMemo(() => createYouTubeClient({}), [])
```

- [ ] **Step 3: Branch `loadPlaylists` on the source**

Replace the body of the `try` block in `loadPlaylists` so the YouTube branch never calls Spotify:

```js
      if (source === 'youtube') {
        setBusy({ label: 'Reading your YouTube library', done: 0, total: 0 })
        setPlaylists(toAppPlaylists(await youtube.listPlaylists()))
        return
      }
      const profile = await getCurrentUser(client)
      setMe(profile)
      const found = await listEditablePlaylists(client, profile.id, {
        onProgress: (done, total) => setBusy({ label: 'Reading your library', done, total }),
      })
      setPlaylists(found)
```

Add `source` and `youtube` to the dependency array.

- [ ] **Step 4: Branch `openPlaylist` on the source**

In `openPlaylist`, after the demo short-circuit, add the YouTube branch before the Spotify fetch:

```js
      setBusy({ label: `Reading ${chosen.name}`, done: 0, total: chosen.trackCount })
      try {
        if (chosen.source === 'youtube') {
          const fetched = await youtube.fetchPlaylist(chosen.id)
          setTracks(normalizeYouTubeTracks(fetched.tracks))
          return
        }
        const loaded = await fetchPlaylistTracks(client, chosen.id, {
          onProgress: (done, total) =>
            setBusy({ label: `Reading ${chosen.name}`, done, total }),
        })
        setTracks(loaded)
      } catch (failure) {
        setError(failure.message)
      } finally {
        setBusy(null)
      }
```

Branch on `chosen.source`, **not** on the `source` state: the user may switch the toggle while a playlist is open, and the open playlist's own service is what decides how to read it.

Add `youtube` to the dependency array.

- [ ] **Step 5: Make the strategy options respect the source**

In `chooseStrategy`, run the chosen defaults through the capability filter:

```js
  const chooseStrategy = useCallback(
    (id) => {
      setStrategyId(id)
      setOptions(id === CSV_STRATEGY ? {} : defaultStrategyOptionsFor(source, id, defaultOptionsFor(id)))
    },
    [source],
  )
```

- [ ] **Step 6: Reset the library when the source changes**

Add this beside the other callbacks, so switching services cannot leave the previous service's playlists on screen:

```js
  const changeSource = useCallback((next) => {
    setSource(next)
    setPlaylists([])
    setPlaylist(null)
    setTracks([])
    setError(null)
    setScreen('playlists')
  }, [])
```

- [ ] **Step 7: Return the new values**

Add `source` and `setSource: changeSource` to the object the hook returns, beside the existing entries.

- [ ] **Step 8: Verify nothing regressed**

```bash
npm test && npm run lint
```

Expected: `339 passed`, lint clean. The count does not change — this task adds no tests; Task 4 exercises the wiring through the UI.

- [ ] **Step 9: Commit**

```bash
git add src/ui/useSorterApp.js
git commit -m "Give the app a source and load playlists from it"
```

---

## Task 4: The source toggle, and disabled sorts with their reason

**Files:**
- Modify: `src/ui/screens/Playlists.jsx`
- Modify: `src/ui/screens/Sort.jsx`
- Modify: `src/App.jsx` — only if the screens need `app.source` passed through; check first

**Interfaces:**
- Consumes: `app.source`, `app.setSource` (Task 3), `unsupportedReason` (Task 2)
- Produces: the finished feature

- [ ] **Step 1: Read both screens first**

Read `src/ui/screens/Playlists.jsx` and `src/ui/screens/Sort.jsx` in full. Match their existing component vocabulary — this codebase has a deliberate visual language (a split-flap departure board) and a bolted-on control will look wrong. Reuse the components already in those files rather than introducing new markup patterns.

- [ ] **Step 2: Add the source toggle to the playlists screen**

Put it near the existing Disconnect control. Two options, Spotify and YouTube Music, with the current one marked. Use the same lever/button component the screen already uses.

Wire it to `app.setSource`. When `app.source === 'youtube'`, the screen's heading should say so, so it is never ambiguous which library is on screen.

- [ ] **Step 3: Handle the YouTube-specific empty and error states**

When the source is YouTube and the list is empty, the reason matters and the screen must not just show nothing:

- If the error mentions the proxy being unavailable, say the proxy is not running and that `npm start` runs it.
- Otherwise show the ordinary empty state.

The existing `error` state already carries the message; `ProxyUnavailableError`'s text already names `npm start`, so displaying `app.error` satisfies this. Confirm it renders rather than assuming it does.

- [ ] **Step 4: Disable the unsupported strategies in the sort screen**

In `Sort.jsx`, the strategy list is `STRATEGIES.map(...)` around line 94. For each, call `unsupportedReason(app.source, item.id)`. When it returns a string:

- mark the control disabled so it cannot be chosen
- show the reason next to the label

Do not filter them out of the list. A missing control tells the user nothing; a disabled one with a reason tells them why (Product Principle 4).

- [ ] **Step 5: Verify the suite still passes**

```bash
npm test && npm run lint
```

Expected: `339 passed`, lint clean.

- [ ] **Step 6: Verify it end to end, against the real library**

This is the deliverable, and it cannot be proved by unit tests. Start both processes:

```bash
npm start
```

Then, at `http://127.0.0.1:5173/?debug=1`:

1. Connect to Spotify as usual. Confirm the Spotify playlists appear **exactly as before** — this task must not change them.
2. Switch the source to YouTube Music. Expect **one playlist: `punjabi songs`, 386 tracks.** `LM` and `SE` are filtered out by design.
3. Open it. Expect roughly **383 tracks** to load (YouTube counts 386 but returns 383 — three are counted and never returned).
4. On the sort screen, confirm **Date added, Release date and Popularity are disabled with a reason shown**, and the others are selectable.
5. Choose **Title A–Z** and go to the preview. Confirm a plan is produced.
6. **Do not execute.** There is no YouTube write path — that is deliverable 2c. Stop at the preview.
7. Switch back to Spotify and confirm its playlists load again.

Record what you actually saw at each step, including the track count. If a step differs from the expectation, report it rather than adjusting the expectation — these numbers are measurements from 2026-09-24 and a change is information.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Show YouTube playlists and gate the sorts it cannot honour"
```

---

## Done when

- `npm test` reports 339 passing and `npm run lint` is clean
- Switching to YouTube Music lists `punjabi songs` and opening it loads ~383 tracks
- Date added, Release date and Popularity are disabled, with the reason visible
- Spotify behaves exactly as it did before

## Not in this plan

| | Why not here |
|---|---|
| Writing to YouTube | Deliverable 2c. The preview is the end of this road |
| Cross-service matching, the sync mode | Deliverables 2b and 2c |
| The `isUnavailable` semantics decision | Now has a UI to be tested against, but it changes proven Spotify sorting code and deserves its own plan. Recorded in spec §14 |
| The album sort putting album-less rows first | Same — a real defect, its own change |
