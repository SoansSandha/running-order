# Spotify Write Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the Spotify write path against the live API, then introduce the service seam — a writer interface and a service-neutral move operation — so a second service can be added without touching the sort, plan or CSV layers.

**Architecture:** `plan/execute.js` and `plan/clone.js` currently import `api/mutations.js` directly, which hardwires Spotify into the planner. This plan replaces those imports with an injected **writer** object, and teaches `plan/diff.js` to emit each move in a second, index-free form (`{ key, beforeKey }`) alongside the existing Spotify index form. No behaviour changes; the same 291 tests must pass at every step.

**Tech Stack:** React 19, Vite 8, JavaScript (ES modules, **not** TypeScript), Vitest, Oxlint. Node v24.11.1.

**Spec:** [`docs/2026-09-18-youtube-mirror-design.md`](../../2026-09-18-youtube-mirror-design.md) — §4 (the service boundary), §13 (why Task 1 comes first).

## Global Constraints

- **JavaScript, not TypeScript.** No `.ts` files, no type annotations. JSDoc comments only.
- **No new runtime dependencies.** This plan adds none.
- **All 291 existing tests must pass at the end of every task.** Run `npm test`. A task is not done with a red suite.
- **`npm run lint` must pass** (Oxlint over `src`).
- **Pure layers stay pure.** `src/model/`, `src/sort/`, `src/csv/` and `src/plan/` must not import anything that performs network I/O. `plan/` may accept an injected writer; it may not import one.
- **Preserve `added_at`.** Never use `replaceTracks` for in-place sorting (design D4).
- **Commit after every task**, using the message given in the task's final step.

---

## Task 1: Prove the Spotify write path (human checkpoint)

**This task is not agentic.** It requires a live OAuth session in a browser, which only the repo owner can drive. An agent executing this plan must **stop here and hand back to the user**, then resume at Task 2 once the user reports the outcome.

**Why it is first:** `executeReorder` has never completed against the live API, and clone-and-sort returned `403`. Tasks 2–6 refactor exactly that code. A bug proven now is a bug fixed once; a bug found after the refactor is a bug in two services with a refactor in between obscuring it.

**Files:** none changed unless a defect is found.

**Interfaces:**
- Consumes: nothing
- Produces: a verified-working `reorderTrack` and `createPlaylist`, or a defect report

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Open `http://127.0.0.1:5173/?debug=1`. The `?debug=1` flag shows the request log — every call beside its response. **Do not skip it**; all three previously-diagnosed live failures were found in that log rather than by reading code.

- [ ] **Step 2: Connect and pick a small test playlist**

Paste the Spotify Client ID and connect. Choose (or create in Spotify) a playlist of **10–20 tracks** — not the 414-track one. A small playlist makes a wrong result obvious and a bad write cheap to repair.

- [ ] **Step 3: Run an in-place reorder**

Pick any sort strategy that visibly changes the order (Title A–Z is a good choice), preview it, and execute.

Expected: each move returns `200` with a fresh `snapshot_id`, progress reaches 100%, and the playlist in the Spotify client shows the new order.

Record in the request log: the HTTP method, the path, and the status of the first write.

- [ ] **Step 4: Verify `added_at` survived**

In Spotify, sort the playlist's *view* by "Date added". The dates must be the original ones, **not** today.

This is the single most important assertion in the whole project: if `added_at` was reset, the date-added sort is destroyed permanently and D4 has been violated. If the dates are today, **stop and report** — do not continue to Task 2.

- [ ] **Step 5: Run clone-and-sort**

Use clone-and-sort on the same playlist.

Expected: a new playlist appears. Previously this returned `403`. `createPlaylist` now tries `POST /me/playlists` first and falls back to `POST /users/{id}/playlists` — the request log shows which answered.

- [ ] **Step 6: Report the outcome**

Report to the user, quoting the request log:
- Did the reorder complete? How many writes, what statuses?
- Did `added_at` survive?
- Did the clone succeed, and via which endpoint?

**If anything failed:** do not guess at a fix. Invoke `superpowers:systematic-debugging` and diagnose from the request log. Fix, re-run steps 3–5, and commit the fix before proceeding to Task 2.

---

## Task 2: Move Spotify modules under `src/services/spotify/`

Mechanical relocation, done before any behavioural change so later diffs read as logic rather than as renames.

**Files:**
- Move: `src/api/client.js`, `src/api/endpoints.js`, `src/api/mutations.js`, `src/api/playlists.js` (and their `*.test.js` siblings) → `src/services/spotify/`
- Move: `src/auth/spotifyAuth.js` (and `spotifyAuth.test.js`) → `src/services/spotify/`
- **Leave alone:** `src/auth/pkce.js` and `src/auth/useAuth.js`. `pkce.js` is imported by `useAuth.js`, not by `spotifyAuth.js` — it sits at the app's auth layer, not inside the Spotify service. Moving it would break that, not improve it.
- Modify: the importers listed in Step 2

**Interfaces:**
- Consumes: nothing
- Produces: `src/services/spotify/{client,endpoints,mutations,playlists,spotifyAuth}.js` — all exports unchanged, only their paths move

- [ ] **Step 1: Confirm the suite is green before touching anything**

```bash
npm test
```

Expected: `Tests 291 passed (291)`. If it is not green, stop — you are not starting from a known-good state.

- [ ] **Step 2: List every import that will break**

```bash
grep -rn "from '.*\(api/\|auth/spotifyAuth\)" src --include=*.js --include=*.jsx
```

Keep this list. Every path it prints must be updated in Step 4.

- [ ] **Step 3: Move the files with git**

```bash
mkdir -p src/services/spotify
git mv src/api/client.js src/api/client.test.js src/services/spotify/
git mv src/api/endpoints.js src/services/spotify/
git mv src/api/mutations.js src/api/mutations.test.js src/services/spotify/
git mv src/api/playlists.js src/api/playlists.test.js src/services/spotify/
git mv src/auth/spotifyAuth.js src/auth/spotifyAuth.test.js src/services/spotify/
```

This list was checked against the working tree on 2026-09-20 and is complete: `src/api/` holds exactly these seven files (`endpoints.js` has no test), and `src/auth/` keeps `pkce.js` and `useAuth.js`. After the moves, `src/api/` should be empty and can be removed.

- [ ] **Step 4: Update every import path**

Work through the Step 2 list. Within `src/services/spotify/`, sibling imports become `./x.js`. From `src/plan/`, `../api/mutations.js` becomes `../services/spotify/mutations.js`. From `src/auth/useAuth.js`, `./spotifyAuth.js` becomes `../services/spotify/spotifyAuth.js`.

- [ ] **Step 5: Verify nothing still points at the old paths**

```bash
grep -rn "api/mutations\|api/playlists\|api/client\|api/endpoints\|auth/spotifyAuth" src --include=*.js --include=*.jsx
```

Expected: only paths beginning `services/spotify/`. Any bare `../api/...` is a miss.

- [ ] **Step 6: Run the suite and the linter**

```bash
npm test && npm run lint
```

Expected: `291 passed`, lint clean. A module-resolution error here means a path in Step 4 was missed.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Move Spotify modules under src/services/spotify"
```

---

## Task 3: Emit a service-neutral form of each move op

Spotify expresses a move as *"take the range at index N, insert it before index M"*, with `M` in pre-removal indexing. YouTube expresses it as *"move item A before item B"*, both by opaque id. `buildMoveOps` already computes the second form internally — it anchors each track to the one that precedes it in the target — and then converts to indices. This task exposes that form instead of discarding it.

**Files:**
- Modify: `src/plan/diff.js:88-92` (the `ops.push` call) and its JSDoc at `src/plan/diff.js:30-34`
- Test: `src/plan/diff.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `buildMoveOps(current, target)` returns ops carrying **two extra fields** alongside the existing three:
  - `key` — the key being moved (one of the values from `current`)
  - `beforeKey` — the key this one must land immediately in front of, or `null` meaning "to the end of the list"

  The existing `rangeStart`, `insertBefore` and `rangeLength` are **unchanged**. `applyMoveOps` continues to read only the index fields. Task 4's Spotify writer keeps using the index fields; the future YouTube writer will use `key`/`beforeKey`.

- [ ] **Step 1: Write the failing test**

Add to `src/plan/diff.test.js`:

```js
describe('neutral move ops', () => {
  test('names the key being moved and the key it lands in front of', () => {
    const ops = buildMoveOps(['A', 'B', 'C'], ['C', 'A', 'B'])
    expect(ops).toHaveLength(1)
    expect(ops[0].key).toBe('C')
    expect(ops[0].beforeKey).toBe('A')
  })

  test('beforeKey is null when a track moves to the end', () => {
    const ops = buildMoveOps(['A', 'B', 'C'], ['B', 'C', 'A'])
    expect(ops).toHaveLength(1)
    expect(ops[0].key).toBe('A')
    expect(ops[0].beforeKey).toBeNull()
  })

  // The index ops are already verified by randomised replay. This asserts the
  // neutral fields describe the SAME move, over the same random permutations,
  // by replaying them independently with splice-before-key semantics.
  test('replaying neutral ops reproduces the target, over 300 permutations', () => {
    const applyNeutral = (items, ops) => {
      const model = [...items]
      for (const { key, beforeKey } of ops) {
        model.splice(model.indexOf(key), 1)
        const at = beforeKey === null ? model.length : model.indexOf(beforeKey)
        model.splice(at, 0, key)
      }
      return model
    }

    let seed = 7
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648

    for (let round = 0; round < 300; round++) {
      const size = 2 + Math.floor(random() * 30)
      const current = Array.from({ length: size }, (_, i) => `k${i}`)
      const target = [...current]
      for (let i = size - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[target[i], target[j]] = [target[j], target[i]]
      }
      expect(applyNeutral(current, buildMoveOps(current, target))).toEqual(target)
    }
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

```bash
npx vitest run src/plan/diff.test.js -t "neutral move ops"
```

Expected: FAIL — `ops[0].key` is `undefined`, because `buildMoveOps` does not yet emit it.

- [ ] **Step 3: Emit the neutral fields**

In `src/plan/diff.js`, replace the `ops.push({...})` block and the two `model.splice` lines that follow it (currently lines 88–95) with:

```js
    const [moved] = model.splice(from, 1)
    model.splice(to, 0, moved)

    ops.push({
      rangeStart: from,
      insertBefore: to > from ? to + 1 : to,
      rangeLength: 1,
      // The same move, stated without indices: YouTube's edit_playlist takes
      // "move this item before that item" natively, and index arithmetic is
      // the thing most likely to be subtly wrong across two services.
      key,
      beforeKey: to + 1 < model.length ? model[to + 1] : null,
    })
```

Note the splices now happen **before** the push — `beforeKey` is read off the model in its post-move state, which is what makes it correct by construction rather than by a second calculation.

- [ ] **Step 4: Update the JSDoc**

Replace the `@returns` line at `src/plan/diff.js:33`:

```js
 * @returns {Array<{rangeStart: number, insertBefore: number, rangeLength: number, key: *, beforeKey: *}>}
 *   `rangeStart`/`insertBefore`/`rangeLength` are Spotify's form, with
 *   `insertBefore` in PRE-removal indexing. `key`/`beforeKey` are the same
 *   move stated without indices, for services that move by item identity.
 *   `beforeKey === null` means "to the end".
```

- [ ] **Step 5: Run the full suite**

```bash
npm test
```

Expected: `291 + 3 = 294 passed`. The pre-existing randomised replay test must still pass — if it does not, the splice reorder in Step 3 changed the index arithmetic, which it must not.

- [ ] **Step 6: Commit**

```bash
git add src/plan/diff.js src/plan/diff.test.js
git commit -m "Emit each move op in a service-neutral form as well"
```

---

## Task 4: Define the writer contract and a Spotify writer

**Files:**
- Create: `src/services/spotify/writer.js`
- Test: `src/services/spotify/writer.test.js`

**Interfaces:**
- Consumes: `reorderTrack`, `addTracksInChunks`, `createPlaylist` from `./mutations.js` (unchanged)
- Produces: `createSpotifyWriter(client)` returning an object with exactly this shape, which Tasks 5 and 6 depend on:

```js
{
  // Applies one move. Returns the new revision token, or null if the service
  // has none. `op` carries both op forms from Task 3; this writer reads the
  // index fields.
  reorder(playlistId, op, revision): Promise<string|null>

  // Creates a playlist and returns it. `ownerId` is ignored by services that
  // do not need it.
  createPlaylist(ownerId, { name, description, isPublic }): Promise<object>

  // Appends tracks in service-appropriate batches, in the order given.
  addTracks(playlistId, tracks, { onProgress }): Promise<void>
}
```

`addTracks` takes **normalized Tracks, not URIs** — a URI is a Spotify concept, and the YouTube writer will need `videoId` from the same argument.

- [ ] **Step 1: Write the failing test**

Create `src/services/spotify/writer.test.js`:

```js
import { describe, expect, test, vi } from 'vitest'
import { makeTracks } from '../../test/factory.js'
import { createSpotifyWriter } from './writer.js'

function fakeClient() {
  const calls = []
  return {
    calls,
    put: vi.fn(async (path, options) => {
      calls.push({ method: 'PUT', path, body: options.body })
      return { snapshot_id: 'snap-next' }
    }),
    post: vi.fn(async (path, options) => {
      calls.push({ method: 'POST', path, body: options.body })
      return { id: 'new-playlist' }
    }),
  }
}

describe('createSpotifyWriter', () => {
  test('reorder sends the index form and returns the new snapshot id', async () => {
    const client = fakeClient()
    const writer = createSpotifyWriter(client)
    const revision = await writer.reorder(
      'p1',
      { rangeStart: 3, insertBefore: 0, rangeLength: 1, key: 'k3', beforeKey: 'k0' },
      'snap-0',
    )
    expect(revision).toBe('snap-next')
    expect(client.calls[0].body).toMatchObject({
      range_start: 3,
      insert_before: 0,
      range_length: 1,
      snapshot_id: 'snap-0',
    })
  })

  test('reorder ignores the neutral fields', async () => {
    const client = fakeClient()
    await createSpotifyWriter(client).reorder(
      'p1',
      { rangeStart: 1, insertBefore: 4, rangeLength: 1, key: 'k1', beforeKey: null },
      'snap-0',
    )
    expect(client.calls[0].body).not.toHaveProperty('key')
    expect(client.calls[0].body).not.toHaveProperty('beforeKey')
  })

  test('addTracks maps Tracks to URIs before sending', async () => {
    const client = fakeClient()
    const tracks = makeTracks([{ name: 'one' }, { name: 'two' }])
    await createSpotifyWriter(client).addTracks('p1', tracks, {})
    expect(client.calls[0].body.uris).toEqual(tracks.map((t) => t.uri))
  })

  test('createPlaylist returns the created playlist', async () => {
    const client = fakeClient()
    const playlist = await createSpotifyWriter(client).createPlaylist('user-1', {
      name: 'Sorted',
      description: 'd',
      isPublic: false,
    })
    expect(playlist).toEqual({ id: 'new-playlist' })
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

```bash
npx vitest run src/services/spotify/writer.test.js
```

Expected: FAIL — cannot resolve `./writer.js`.

- [ ] **Step 3: Write the writer**

Create `src/services/spotify/writer.js`:

```js
/**
 * Spotify's implementation of the writer contract the planner depends on.
 *
 * The planner (plan/execute.js, plan/clone.js) knows this shape and nothing
 * else about Spotify, so a second service is a second writer rather than a
 * second planner. See docs/2026-09-18-youtube-mirror-design.md §4.
 */

import { addTracksInChunks, createPlaylist, reorderTrack } from './mutations.js'

export function createSpotifyWriter(client) {
  return {
    /** Spotify moves by index; `op`'s neutral fields are ignored here. */
    reorder(playlistId, op, revision) {
      return reorderTrack(client, playlistId, op, revision)
    },

    createPlaylist(ownerId, { name, description = '', isPublic = false }) {
      return createPlaylist(client, ownerId, { name, description, isPublic })
    },

    /**
     * Takes Tracks rather than URIs: a URI is Spotify's identifier, and the
     * planner must not have to know which identifier a service uses.
     */
    addTracks(playlistId, tracks, { onProgress } = {}) {
      return addTracksInChunks(
        client,
        playlistId,
        tracks.map((track) => track.uri),
        { onProgress },
      )
    },
  }
}
```

- [ ] **Step 4: Run the suite**

```bash
npm test
```

Expected: `294 + 4 = 298 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/services/spotify/writer.js src/services/spotify/writer.test.js
git commit -m "Add a writer contract with a Spotify implementation"
```

---

## Task 5: `executeReorder` takes a writer instead of importing Spotify

**Files:**
- Modify: `src/plan/execute.js` — remove the import at line 9, rename the `client` parameter, change the call at line 80
- Modify: `src/plan/execute.test.js` — the fake client becomes a fake writer
- Modify: every caller of `executeReorder` (find them in Step 1)

**Interfaces:**
- Consumes: the writer shape from Task 4
- Produces: `executeReorder({ writer, playlistId, currentTracks, targetTracks, snapshotId, onProgress, signal, dryRun })` — the `client` argument is **replaced by** `writer`. Return shape is unchanged: `{ ops, applied, snapshotId, cancelled, finalOrder }`.

- [ ] **Step 1: Confirm the caller list**

```bash
grep -rn "executeReorder" src --include=*.js --include=*.jsx
```

Expected: `src/plan/execute.js`, `src/plan/execute.test.js`, and **`src/ui/useSorterApp.js` at two call sites** (around lines 256 and 337 — the sort run and the re-sort after a refetch). That is the whole list as of 2026-09-20. If grep shows more, update those too.

- [ ] **Step 2: Update the test to pass a writer**

In `src/plan/execute.test.js`, replace `fakeClient` with:

```js
function fakeWriter({ failAt = -1 } = {}) {
  const calls = []
  return {
    calls,
    reorder: vi.fn(async (playlistId, op, revision) => {
      calls.push({ playlistId, op, revision })
      if (calls.length === failAt) throw new Error('Spotify said no')
      return `snap-${calls.length}`
    }),
  }
}
```

Then, throughout the file: `const client = fakeClient(...)` becomes `const writer = fakeWriter(...)`, `client,` in each `executeReorder({...})` call becomes `writer,`, and `client.calls` becomes `writer.calls`.

Assertions that read `calls[i].body` must now read `calls[i].op`. For example an assertion of the form:

```js
expect(client.calls[0].body).toMatchObject({ range_start: 3, insert_before: 0 })
```

becomes:

```js
expect(writer.calls[0].op).toMatchObject({ rangeStart: 3, insertBefore: 0 })
```

- [ ] **Step 3: Run the test and verify it fails**

```bash
npx vitest run src/plan/execute.test.js
```

Expected: FAIL — `executeReorder` still destructures `client`, so `writer` is undefined and `reorderTrack` is called with `undefined`.

- [ ] **Step 4: Change `execute.js`**

Delete line 9 (`import { reorderTrack } from '../api/mutations.js'` — after Task 2, `'../services/spotify/mutations.js'`).

In the parameter list, replace `client,` with `writer,`. Update the JSDoc line for the parameter:

```js
 * @param {object} args.writer        service writer (see services/spotify/writer.js)
```

Replace the call at line 80:

```js
      const next = await writer.reorder(playlistId, op, liveSnapshot)
```

- [ ] **Step 5: Update `src/ui/useSorterApp.js`**

Add the import beside the existing ones near line 20:

```js
import { createSpotifyWriter } from '../services/spotify/writer.js'
```

Build the writer once, next to where `client` is unpacked (around line 29). `useMemo` matters here: a new writer object on every render would change the identity of every `useCallback` that depends on it.

```js
const { client } = auth
const writer = useMemo(() => createSpotifyWriter(client), [client])
```

If `useMemo` is not already imported from `react` at the top of the file, add it.

At **both** `executeReorder({ ... })` call sites, replace the line `client,` with `writer,`. Leave every other argument untouched.

`client` is still needed in those same callbacks for `getPlaylistSnapshot` and `fetchPlaylistTracks`, so do **not** remove it. Add `writer` to the dependency array of each affected `useCallback` — the arrays currently ending `[client, playlist, tracks, targetTracks, ops, movedKeys]` and `[client, playlist]` become `[client, writer, playlist, ...]` with the rest unchanged.

- [ ] **Step 6: Verify `plan/` no longer imports a service**

```bash
grep -rn "services/spotify" src/plan
```

Expected: **no output from `execute.js`.** (`clone.js` still imports it until Task 6.)

- [ ] **Step 7: Run the suite and the linter**

```bash
npm test && npm run lint
```

Expected: `298 passed`, lint clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Take a writer in executeReorder instead of importing Spotify"
```

---

## Task 6: `executeClone` takes a writer

**Files:**
- Modify: `src/plan/clone.js` — remove the import at line 14, replace `client` with `writer`, change the calls at lines 51 and 57
- Modify: `src/plan/clone.test.js`
- Modify: every caller of `executeClone` (find them in Step 1)

**Interfaces:**
- Consumes: the writer shape from Task 4
- Produces: `executeClone({ writer, userId, sourcePlaylist, targetTracks, strategyLabel, isPublic, onProgress, dryRun })`. Return shape unchanged: `{ playlist, requested, added, wouldAdd, skipped }`.

- [ ] **Step 1: Confirm the caller list**

```bash
grep -rn "executeClone" src --include=*.js --include=*.jsx
```

Expected: `src/plan/clone.js`, `src/plan/clone.test.js`, and **`src/ui/useSorterApp.js` at one call site** (around line 302). That is the whole list as of 2026-09-20.

- [ ] **Step 2: Update the test to pass a writer**

In `src/plan/clone.test.js`, replace the fake client with:

```js
function fakeWriter() {
  const added = []
  return {
    added,
    createPlaylist: vi.fn(async (ownerId, { name, description, isPublic }) => ({
      id: 'clone-1',
      name,
      description,
      public: isPublic,
    })),
    addTracks: vi.fn(async (playlistId, tracks) => {
      added.push(...tracks)
    }),
  }
}
```

Replace `client` with `writer` in each `executeClone({...})` call. Assertions about which URIs were sent now read from the Tracks the writer received — for example:

```js
expect(writer.added.map((track) => track.uri)).toEqual(expectedUris)
```

- [ ] **Step 3: Run the test and verify it fails**

```bash
npx vitest run src/plan/clone.test.js
```

Expected: FAIL — `clone.js` still destructures `client`.

- [ ] **Step 4: Change `clone.js`**

Delete line 14 (the `import { addTracksInChunks, createPlaylist } from ...`).

Replace `client,` with `writer,` in the parameter list. Replace the two call sites:

```js
  const playlist = await writer.createPlaylist(userId, {
    name: `${sourcePlaylist.name} (sorted by ${strategyLabel})`,
    description: `Sorted copy of "${sourcePlaylist.name}" by ${strategyLabel}, ${formatToday()}.`,
    isPublic,
  })

  await writer.addTracks(playlist.id, cloneable, { onProgress })
```

Note `cloneable` is passed whole — the `.map((track) => track.uri)` moves into the Spotify writer, where it belongs. The local-file and unavailable filtering above it stays in `clone.js`: that is a product rule (design D-clone), not a Spotify detail.

- [ ] **Step 5: Update `src/ui/useSorterApp.js`**

The `writer` built in Task 5 is already in scope, so no new import is needed — confirm this line is present near line 29:

```js
const writer = useMemo(() => createSpotifyWriter(client), [client])
```

At the `executeClone({ ... })` call site (around line 302), replace the line `client,` with `writer,`. Leave `userId`, `sourcePlaylist`, `targetTracks`, `strategyLabel`, `isPublic` and `onProgress` untouched.

Add `writer` to that `useCallback`'s dependency array: `[client, playlist, me, targetTracks, strategyLabel]` becomes `[client, writer, playlist, me, targetTracks, strategyLabel]`. Keep `client` — it is still used elsewhere in the callback.

- [ ] **Step 6: Verify `plan/` imports no service at all**

```bash
grep -rn "services/spotify\|api/mutations" src/plan
```

Expected: **no output.** This is the deliverable of the whole plan — the planner is now service-agnostic.

- [ ] **Step 7: Run the suite and the linter**

```bash
npm test && npm run lint
```

Expected: `298 passed`, lint clean.

- [ ] **Step 8: Verify the app still works end to end**

```bash
npm run dev
```

Open `http://127.0.0.1:5173/?demo=1&screen=preview&playlist=2` and confirm the preview board renders. Then `/?demo=1&screen=progress&playlist=2&progress=running` for the progress view. Neither should error in the console.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Take a writer in executeClone; plan/ no longer imports a service"
```

---

## Done when

- `grep -rn "services/spotify\|api/mutations" src/plan` prints nothing
- `npm test` reports 298 passing
- `npm run lint` is clean
- The live reorder from Task 1 completed and `added_at` survived

## Not in this plan

Deliberately deferred, each with its own reason:

| | Why not here |
|---|---|
| `services/registry.js` | A registry with one entry is scaffolding for a user that does not exist yet. It arrives in Plan 2 with YouTube, which is the thing that makes it mean something |
| The Python proxy, Google OAuth, YouTube read | Plan 2 |
| Capability registry and YouTube-only sorting | Plan 2 |
| Matching, match book, confirmation surface | Plan 3 |
| Fill and order execution, undo | Plan 4 |
