# Simplification audit

**Run:** 2026-10-05 · **At commit:** `8d92c46` (branch `youtube-matching-2b`) · **Tool:** `/ponytail:ponytail-audit`

A whole-repo pass for over-engineering only: dead code, wrappers with one
caller, options nobody sets, duplicated logic, hand-rolled stdlib. Bugs,
security and performance were out of scope.

**Nothing here has been applied.** Total if everything is cut: about **−490
lines** (≈400 source, ≈90 test), **−2 files**, **−2 dev dependencies**.

---

## Before cutting anything

- **Line numbers are from `8d92c46` and will drift.** Every item names its
  symbol. Find it by name, not by line.
- **Re-grep before every `delete`.** Each one was confirmed with a whole-tree
  grep (src, proxy, tests, fixtures, string references) on the audit date.
  Code added since may have introduced a caller.
- **Run both suites after each item:** `npm test` and
  `python -m pytest proxy`. `npm run lint` too.
- **Items are independent unless noted** under *Order and overlaps*, so they
  can be picked off one at a time ("do 3 and 17").

### Tags

| Tag | Meaning |
|---|---|
| `delete` | Dead code or unused flexibility. Replaced by nothing. |
| `stdlib` | Hand-rolled thing the standard library ships. |
| `native` | Code or dependency doing what the platform already does. |
| `reuse` | Duplicates a helper that already lives in this repo. |
| `yagni` | Abstraction with one implementation, option no caller sets, wrapper with one caller. |
| `shrink` | Same logic, fewer lines. |

---

## Summary

Ranked by lines saved.

| # | Tag | Cut | Lines | Risk |
|---|---|---|--:|---|
| 1 | shrink | One word list for the two variant-tail regexes | −69 | Low |
| 2 | delete | YouTube auth-status path and spare CORS options | −67 | **Check README** |
| 3 | delete | Eight functions with no callers | −46 | Low |
| 4 | yagni | Error subclasses nothing `instanceof`-checks | −42 | **Check AuthError plan** |
| 5 | yagni | Fold `writer.js` into `mutations.js` | −38 | Low |
| 6 | shrink | Merge repeated rule bodies in `board.css` | −38 | Visual check |
| 7 | yagni | Options and parameters no caller passes | −20 | Low |
| 8 | reuse | Duplication across Sort, Playlists, Progress screens | −19 | Low |
| 9 | reuse | `.peek-*` classes duplicate `.row-*` | −15 | **Mobile line-height** |
| 10 | yagni | Dissolve `endpoints.js` | −12 | Low |
| 11 | reuse | Row heights read from `--row-h`, drop resize listeners | −12 | Visual check |
| 12 | yagni | Unused props and wrappers in `chrome.jsx` | −12 | Low |
| 13 | native | BOM stripping PapaParse already does | −11 | Low |
| 14 | shrink | Parse the query string once in `App.jsx` | −10 | Low |
| 15 | shrink | Redundant CSS declarations | −10 | Visual check |
| 16 | delete | `Track.explicit` and the CSV Album dropdown | −10 | Low |
| 17 | stdlib | `parseBody` → `r.json().catch(() => null)` | −9 | Low |
| 18 | shrink | `EMPTY_ALBUM` and its ternary | −8 | Low |
| 19 | yagni | Snapshot fields only the dead serializer read | −6 | Do with #3 |
| 20 | reuse | Test factory's `precisionOf` duplicates `inferPrecision` | −6 | Low |
| 21 | delete | Unreachable unavailable-track bucket in artist sort | −6 | Low |
| 22 | delete | Three dead CSS rules and tokens | −6 | Low |
| 23 | delete | `typeof window` guards | −5 | Low |
| 24 | native | API log toggle → `<details>` | −5 | Low |
| 25 | stdlib | `Map.groupBy`, `Set.prototype.isSubsetOf` | −4 | Low |
| 26 | yagni | `demoRef`, double `setBusy`, misplaced `fileInput` ref | −4 | Low |
| 27 | reuse | Call `normalizePlaylistItems` instead of repeating it | ±0 | Do instead of deleting it |
| 28 | delete | `@types/react`, `@types/react-dom` | −2 deps | Low |

---

## Findings

### Domain logic: match, csv, sort, plan, model

- [ ] **1. shrink — one word list for the variant-tail regexes** (−14 src, −55 test)
  - **Where:** `src/match/scorePair.js` — `PIPE_VARIANT_TAIL` and `VARIANT_TAIL` (≈97–112, 136–137).
  - **Cut:** the hand-maintained superset invariant comment (≈97–109); in
    `scorePair.test.js` the `alternatives` / `isBalanced` helpers (≈30–63) and
    the superset test (≈596–615). Then stop exporting both regexes.
  - **Replace with:** one source list, so the superset rule holds by construction:
    ```js
    const PIPE_WORDS = String.raw`live|remix(?:e[sd])?|…|sad` // existing alternatives
    const PIPE_VARIANT_TAIL = new RegExp(String.raw`\b(${PIPE_WORDS})\b`, 'i')
    const VARIANT_TAIL = new RegExp(String.raw`\b(${PIPE_WORDS}|female|male)\b`, 'i')
    ```
  - **Check:** both regexes are only referenced in `scorePair.js` and its
    test; the test reads `.source` only for the superset check.

- [ ] **3. delete — functions with no callers** (−46 total, includes items in other layers)
  - `src/plan/undo.js` — `serializeSnapshot` (≈87–90): zero references anywhere.
  - `src/plan/undo.js` — `clearSnapshot` (≈79–85): referenced only by `undo.test.js`. Delete its test too.
  - `src/sort/comparators.js` — `byArtistName` (≈29): zero references.
  - `src/test/factory.js` — `resetFactory` (≈13–15): zero references.
  - `src/services/spotify/mutations.js` — `replaceTracks` (≈42–55): zero references, not even a test.
  - `src/ui/format.js` — `formatRunTime` (≈11–18): zero references.
  - `src/ui/apiLog.js` — `isApiLogEnabled` (≈19–21): zero references.
  - `src/ui/useSorterApp.js` — `setError`, `setOutcome` in the returned object (≈462, 484): no consumer.
  - **Note:** do **not** delete `normalizePlaylistItems` — see #27.

- [ ] **13. native — BOM stripping PapaParse already does** (−11)
  - **Where:** `src/csv/parse.js` — `stripByteOrderMark` (≈15, 31–37) and the padding loop (≈22–26).
  - **Cut:** `stripByteOrderMark`. PapaParse 5.7.0 strips a leading U+FEFF
    from string input itself (`stripBom`, `node_modules/papaparse/papaparse.js` ≈94, called ≈157).
  - **Replace the padding loop with:**
    ```js
    const rows = data.map((row) => Array.from({ length: width }, (_, i) => (row[i] ?? '').trim()))
    ```
    With `header: false` and no `dynamicTyping`, every cell is already a string.
  - **Check:** the existing BOM test (`parse.test.js` ≈28) must still pass.
    If PapaParse is ever upgraded, re-confirm `stripBom` survives.

- [ ] **16. delete — `Track.explicit` and the CSV Album dropdown** (−10)
  - **`explicit`:** written at `src/model/track.js` ≈71, `src/services/youtube/track.js` ≈62,
    `src/test/factory.js` ≈29/46, `src/ui/demoData.js` ≈71, and requested in the
    Spotify field projection (`src/services/spotify/playlists.js` ≈22). Nothing reads it.
  - **CSV album column:** `src/csv/detectColumns.js` detects `album` (≈31–34, and
    `album` in `EMPTY`), and `src/ui/screens/Sort.jsx` ≈31 shows it as a mapping
    dropdown — but `readRow` in `src/csv/match.js` (≈129–141) reads only uri, isrc,
    title and artist. The dropdown does nothing. Keep `'album'` in the other
    fields' reject lists so album columns aren't mistaken for titles.

- [ ] **19. yagni — snapshot fields nothing reads** (−6) · *do together with #3*
  - **Where:** `src/plan/undo.js` ≈10, 18, 20–22, 26.
  - **Cut:** `SNAPSHOT_VERSION` and the snapshot fields `version`, `playlistName`,
    `snapshotId`, `trackCount`, `createdAt`. Their only reader was `serializeSnapshot`.
  - **Check:** non-test code reads only `snapshot.uris` and `snapshot.playlistId`.
    Adjust `undo.test.js` (≈33, 42–47, 130–131).

- [ ] **20. reuse — `precisionOf` in the test factory** (−6)
  - **Where:** `src/test/factory.js` — `precisionOf` (≈96–100), used ≈55–56.
  - **Replace with:** `release_date_precision: releaseDatePrecision ?? null`.
    `padReleaseDate` already runs `inferPrecision` (`src/model/normalize.js` ≈43–48) when precision is null.

- [ ] **21. delete — unreachable unavailable-track bucket** (−6)
  - **Where:** `src/sort/artistGrouped.js` ≈44, 47, 56–58.
  - **Why dead:** its only production caller is `sortTracks` (`src/sort/index.js`),
    which filters out `isUnavailable` tracks first (≈150–157).
  - **Also:** `run: (t, o) => artistGrouped(t, o)` → `run: artistGrouped`, same for
    `albumGrouped` (`src/sort/index.js` ≈54, 66).
  - **Check:** `artistGrouped.test.js` ≈183–203 exercises this branch and goes with it.

- [ ] **25. stdlib — `Map.groupBy` and `isSubsetOf`** (−4)
  - `src/plan/undo.js` ≈39–44: `const available = Map.groupBy(currentTracks.keys(), (i) => currentTracks[i].uri)`.
  - `src/match/scorePair.js` ≈255: `[...left].every((n) => right.has(n))` → `left.isSubsetOf(right)`. Readability only.
  - Both need Node 22+ and an evergreen browser, which this project already assumes.

### Services, auth, proxy

- [ ] **2. delete — YouTube auth-status path** (−37 src, −30 test)
  - **Where:**
    - `src/services/youtube/client.js` — `authStatus()` (≈57–68)
    - `proxy/app.py` — `GET /auth/status` (≈51–64) and `POST /auth/status` (≈81–89)
    - `proxy/app.py` CORS (≈25–26): drop `allow_methods=[…]` and `allow_headers=["*"]`, keep `allow_origins=[VITE_ORIGIN]`.
      There is no PATCH route; POST exists only for the route being removed; the client makes bare GETs.
  - **Keep:** `session_alive()` — `/playlists` uses it (≈108).
  - **Tests:** move the CORS test (`test_app.py` ≈24–30) and the cache-reset test
    (≈141–146) onto `GET /playlists`; drop the five status tests.
  - **⚠ Decide first:** `proxy/README.md` ≈41–43 documents both routes as a
    manual "are my credentials alive" check. If that check is still used by hand,
    keep `POST /auth/status` and its README lines, and cut only the JS side.

- [ ] **4. yagni — error subclasses nothing checks** (−42)
  - **Where:**
    - `src/services/spotify/client.js` ≈16–41: `ApiError`, `AuthError`, `RateLimitError`, and fields `retryAfterMs`, `body`, `url`.
    - `src/services/youtube/client.js` ≈11–37: two error classes.
    - `src/plan/execute.js` ≈11–24: `ReorderFailure`.
  - **Why:** no non-test `instanceof` anywhere. The UI reads only `.message`
    (`useSorterApp.js`, `useAuth.js`). The only field read is `.status`
    (`mutations.js` ≈74) and `failure.applied` (`useSorterApp.js` ≈347–348).
  - **Replace with:**
    ```js
    throw Object.assign(new Error(msg, { cause }), { status })    // clients
    throw Object.assign(new Error(msg, { cause }), { applied })   // execute.js
    ```
    Keep every branch and every message string.
  - **Tests:** `toBeInstanceOf(X)` → match on message or `status`.
  - **⚠ Decide first:** a comment at `spotify/client.js` ≈26 says the UI should
    send the user back to Connect on an expired session. That isn't built. If
    it's planned, keep `AuthError` and cut the rest.

- [ ] **5. yagni — fold `writer.js` into `mutations.js`** (−38, −1 file) · *after #3 removes `replaceTracks`*
  - **Where:** `src/services/spotify/writer.js` (44 lines) only forwards to
    `mutations.js` and repeats its defaults (`description=''`, `isPublic=false`).
  - **Replace with,** at the end of `mutations.js`:
    ```js
    export const createSpotifyWriter = (client) => ({
      reorder: (id, op, rev) => reorderTrack(client, id, op, rev),
      createPlaylist: (owner, opts) => createPlaylist(client, owner, opts),
      addTracks: (id, tracks, opts) => addTracksInChunks(client, id, tracks.map((t) => t.uri), opts),
      canWrite: (track) => Boolean(track.uri),
    })
    ```
  - Keep the writer object itself; the planner tests pass fake writers through it.
  - Update imports in `src/ui/useSorterApp.js` ≈24 and `writer.test.js`.

- [ ] **7. yagni — options and parameters no caller passes** (−20)
  - `src/services/spotify/client.js`: returned `request` and `delete` (≈127, 131),
    the `signal` option (≈51, 68), `maxAttempts` (≈48).
  - `src/services/youtube/client.js` ≈39: `baseUrl` (only the test sets it, to the default).
  - `proxy/app.py` ≈34: `YTM_BROWSER_JSON` environment override (undocumented; tests monkeypatch the function).
  - `src/csv/order.js` ≈18, 20, 47: `withReport` — return `order` directly. Only `order.test.js` ≈78 passes it.
  - `src/plan/clone.js`: `skipped.names` (≈25, 30, 33; read only by `clone.test.js` ≈137),
    the `isPublic` parameter (≈20, 52; writer already defaults to false), and
    inline the one-caller `formatToday`.
  - `src/ui/components/TrackBoard.jsx`: `emptyTitle` / `emptyBody` (≈27, 70) — both callers
    pass identical strings, so hardcode them; `turningKeys` Set → scalar `turningKey`
    (only caller wraps one key, `Progress.jsx` ≈32).

- [ ] **10. yagni — dissolve `endpoints.js`** (−12, −1 file) · *pairs with #5*
  - **Where:** `src/services/spotify/endpoints.js`.
  - `playlistTrackCount` has one caller (`playlists.js` ≈87): inline `item.items?.total ?? item.tracks?.total ?? 0`.
  - Move `playlistItemsPath` into `playlists.js`; `mutations.js` imports it from there.

- [ ] **17. stdlib — `parseBody`** (−9)
  - **Where:** `src/services/spotify/client.js` ≈146–155.
  - **Replace with:** `const parseBody = (r) => r.json().catch(() => null)`.
    `Response.json()` rejects on 204, empty and non-JSON bodies, so every `null`
    case still returns `null`. `spotifyAuth.js` ≈97 already uses this idiom.

- [ ] **18. shrink — `EMPTY_ALBUM`** (−8)
  - **Where:** `src/services/youtube/track.js` ≈15–20, 39–41.
  - **Replace with:**
    `album: { id: raw.album?.id ?? null, name: raw.album?.name ?? '', releaseDate: null, releaseDatePrecision: null }`

- [ ] **27. reuse — call `normalizePlaylistItems`** (±0)
  - **Where:** `src/services/spotify/playlists.js` ≈110 repeats
    `normalizePlaylistItems` from `src/model/track.js` ≈93 inline.
  - **Replace with:** `return normalizePlaylistItems(items)`. This gives the
    helper its first production caller. Do this *instead of* deleting the helper.

- [ ] **28. delete — `@types/react`, `@types/react-dom`** (−2 dev deps)
  - No TypeScript anywhere: no `tsconfig`/`jsconfig`, no `.ts`/`.tsx`, no `@ts-check`.
    Vite, Vitest and oxlint never read them; VS Code fetches JS editor types on its own.

### UI

- [ ] **6. shrink — repeated rule bodies in `board.css`** (−38)
  - Seam `::after` written 4× (≈233–241, 421–428, 672–680, 927–935).
  - `> * { position: relative; z-index: 1 }` written 3× (≈228–231, 664–670, 922–925).
  - `border-left: 1px solid var(--rule-soft)` 2× (≈153–156, 212–214).
  - The flap-card gradient literal 6× → one `--flap-card` token.
  - `.col-label` split between `theme.css` ≈159–166 and `board.css` ≈323–325: move `white-space: nowrap` into `theme.css`.
  - **Shape:**
    ```css
    .board-row::after, .lever:disabled::after, .strategy::after, .peek-row::after {
      content: ''; position: absolute; inset-inline: 0; top: 50%;
      height: 1px; background: var(--seam); pointer-events: none;
    }
    .board-row > *, .peek-row > *, .strategy > * { position: relative; z-index: 1; }
    ```
  - **Check:** screenshot each screen before and after; selector specificity can shift.

- [ ] **8. reuse — duplication across screens** (−19)
  - `src/ui/screens/Sort.jsx` ≈119–129: the CSV button copies the strategy-button
    markup. Map over `[...STRATEGIES, { id: CSV_STRATEGY, label: 'From a CSV', description: '…' }]`.
    `unsupportedReason(src, 'csv')` is always null (no `csv` key in `capabilities.js` ≈21).
  - Busy label + meter block written 3× (`Sort.jsx` ≈78–85, `Playlists.jsx` ≈135–142,
    `Progress.jsx` ≈50–57). Give `Meter` a `label` prop and move the `|| 1` inside it.
  - `Sort.jsx` ≈58 `STRATEGIES.find(...)` → `strategyById` (`src/sort/index.js` ≈122).
  - `Sort.jsx` ≈68–73 re-derives `accessLabel` from `Playlists.jsx` ≈26–38 (same rule, same comment twice). Export it once.
  - `Playlists.jsx` ≈116–119 repeats `SOURCE_LABELS` (≈24): `Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))`.

- [ ] **9. reuse — `.peek-title` / `.peek-artist`** (−15)
  - **Where:** `board.css` ≈942–956 match `.row-title` / `.row-sub` (≈300–315) property for property.
  - **Replace:** use the row classes at `Sort.jsx` ≈181–182 and 363–364; delete the peek rules.
  - **⚠ Check:** at ≤680px the peek rows would inherit `.row-title { line-height: 1.25 }`. Look at it on a phone width before keeping the change.

- [ ] **11. reuse — row height from `--row-h`** (−12)
  - **Where:** `src/ui/components/TrackBoard.jsx` ≈18–25, 29, 37 hardcode 46/58px and
    `innerWidth <= 680`, duplicating `--row-h` (`board.css` ≈120, 835) and the 680px query.
  - **Replace:** inside `measure`, `parseFloat(getComputedStyle(element).getPropertyValue('--row-h'))`.
    Also makes DESIGN.md's "measured row height" literally true.
  - Drop the window `resize` listeners (`TrackBoard.jsx` ≈48, 53; `UnlitField.jsx` ≈35, 39):
    the ResizeObserver on the same element already fires on viewport width changes.
  - **Check:** resize across 680px and confirm the windowed rows re-measure.

- [ ] **12. yagni — `chrome.jsx` props and wrappers** (−12)
  - `Chip` (≈95–101): one call site (`Playlists.jsx` ≈196). Inline `<span className="chip">`, as `Sort.jsx` ≈374 already does.
  - `CopyStrip` `label` prop (≈124): never passed.
  - `Head` `tally = []` default and `tally.length > 0` guard (≈43, 55): all 5 callers pass a non-empty tally.
  - `Notice` `tone='amber'` default and `title ?` guard: all 15 callers pass both.

- [ ] **14. shrink — query string parsed twice** (−10)
  - **Where:** `src/App.jsx` ≈19–33.
  - **Replace with:**
    ```js
    const params = import.meta.env.DEV ? new URLSearchParams(location.search) : null
    const debugging = Boolean(params?.has('debug'))
    enableApiLog(debugging)
    if (params?.has('raw')) setFieldProjection(false)
    ```

- [ ] **15. shrink — redundant CSS declarations** (−10)
  - `min-height: 100vh` before `100dvh` (`theme.css` ≈75, `board.css` ≈14).
  - `font-feature-settings: 'tnum' 1` repeating `font-variant-numeric: tabular-nums` (`theme.css` ≈132).
  - Mobile rules restating base values (`board.css` ≈840, 862, 890).
  - Declarations set to their default (`board.css` ≈139–140, 354, 726).
  - `var(--cols, …)` / `var(--row-h, 46px)` fallbacks (`board.css` ≈138, 187, 191, 219): `.board` always defines both.

- [ ] **22. delete — dead CSS** (−6)
  - `board.css` ≈799–801 `.pl-row:disabled`: the only `.pl-row` (`Playlists.jsx` ≈168) is never disabled.
  - `board.css` ≈109 `.tally-value[data-tone='red']`: tally tones are only green, amber or unset.
  - `theme.css` ≈50 `--step`: zero `var(--step)` reads.

- [ ] **23. delete — `typeof window` guards** (−5)
  - `App.jsx` ≈21, 29; `Flap.jsx` ≈27; `TrackBoard.jsx` ≈23; `demoData.js` ≈133; plus `matchMedia?.`.
  - Browser-only SPA, no SSR, and no test imports `src/ui` or `App.jsx`.
  - **Check:** if a UI test is ever added under a Node environment, these come back.

- [ ] **24. native — API log toggle → `<details>`** (−5)
  - **Where:** `src/ui/components/ApiLog.jsx` ≈14, 19–24, 39: `open` state + toggle button + conditional render.
  - **Replace with:** `<details className="api-log" open><summary className="api-log-toggle">…</summary>…</details>`,
    the same pattern its inner rows already use. `data-open` has no CSS and goes too.

- [ ] **26. yagni — small hook and ref leftovers** (−4)
  - `src/ui/useSorterApp.js` ≈50: `demoRef = useRef(demo)` wraps a module constant (`App.jsx` ≈15); use `demo`.
  - `useSorterApp.js` ≈152–155: `setBusy` called twice on the YouTube path; one call with a ternary label.
  - `src/ui/screens/Sort.jsx` ≈56, 137, 243: `fileInput` ref created in `SortScreen` only to pass to `CsvPanel`; create it in `CsvPanel`.

---

## Order and overlaps

| Do | Before / with | Why |
|---|---|---|
| #3 | before #5 | removes the dead `replaceTracks` first, so the fold only moves live code |
| #3 | with #19 | the snapshot fields only existed for `serializeSnapshot` |
| #5 | with #10 | both reshuffle `src/services/spotify` imports |
| #27 | instead of deleting `normalizePlaylistItems` | the helper earns a caller rather than dying |
| #4 | covers `ReorderFailure` | same plain-`Error` pattern in `execute.js` |
| #6, #9, #11, #15, #22 | together, with screenshots | all touch `board.css`; one visual pass covers them |

Quick wins to start with (all low risk, no decisions needed): **3, 17, 13, 22, 28**.

---

## Deliberately not cut

| What | Why it stays |
|---|---|
| `::-webkit-scrollbar` rules (`theme.css` ≈97–114, −18 if cut) | Chromium 121+ and Firefox ignore them once `scrollbar-color` is set; only Safari uses them. DESIGN.md ≈272 names the thumb, so this is a design call. |
| `keyOf` (`execute.js`), `key` / `beforeKey` (`diff.js` ≈51–53, 105–109) | No caller yet, but STATUS.md records them as groundwork for YouTube writes (phase 2c). Cut (~15 lines) only if 2c is shelved. |
| `pairTracks.js` | No production caller *yet* — the YouTube matcher isn't wired into the app. Work in progress. |
| `concurrently` | npm has no cross-platform way to run web and proxy in parallel on Windows; Vite's proxy can't start uvicorn. |
| Auth / PKCE / token handling | Security; out of scope. |
| `diff.js` LIS, `shuffle.js` seeded RNG | Needed. JS has no seeded random. |
| Green/red chip tones, `--green-deep` / `--red-deep` | Unused today but documented chip states in DESIGN.md. |
| Long comments in `scorePair.js` | They record measured decisions from the tier-gate runs. |

Exports with no outside importer, which can become private at no line cost:
`SPELLING_FLOOR`, `extractTrackId`, `INNER_ORDERS`, `makeItem`.
