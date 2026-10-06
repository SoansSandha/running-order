# Match Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A review screen where one Spotify playlist is matched against a YouTube Music playlist the user picks, and every pairing decision is kept in a local match book.

**Architecture:** Two pure modules carry the logic. `src/match/matchBook.js` stores decisions. `src/match/pairTracks.js` is split into a slow `scoreCandidates`, run once per review, and a cheap `settlePairs`, rerun after every click. A thin React hook (`useMatchReview`) sequences them, and one new screen (`Review.jsx`) renders the board. Nothing writes to Spotify or YouTube.

**Tech Stack:** React 19 (JavaScript, not TypeScript), Vite 8, Vitest 3, Oxlint. The existing YouTube proxy client and `normalizeYouTubeTracks` are reused.

**Spec:** [docs/2026-10-05-match-review-design.md](../../2026-10-05-match-review-design.md). It builds on [docs/2026-09-18-youtube-mirror-design.md](../../2026-09-18-youtube-mirror-design.md) §7–§9. Read both before starting.

## Global Constraints

- **Read-only.** No code in this plan may write to Spotify or YouTube: no writer, no `addTracks`, no new proxy route.
- **No new dependencies.** `package.json` does not change.
- The match book's storage key is exactly `playlist-sorter:match-book`.
- `npm run lint` currently reports exactly two warnings, in `src/ui/components/Flap.jsx` and `src/auth/useAuth.js`. It must report no others.
- **DESIGN.md rules:**
  - Colour only states a fact: amber is pending, green is committed/settled, red is an error (the Quarantined Colour Rule).
  - Every numeral is in a `.num` element.
  - Corners are square everywhere.
  - No new shadows.
  - Condensed uppercase is for labels, controls and headings only; prose is sentence case.
  - Each screen declares its board grid once per breakpoint, on its `.board-*` class.
- **Never stage the owner's uncommitted files:** the simplification-audit link line in `docs/STATUS.md`, and `docs/2026-10-05-simplification-audit.md`. Always `git add` explicit paths, never `git add -A` or `git add .`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commands: `npm test` (all JavaScript tests), `python -m pytest proxy` (proxy tests, which must stay at 18 passing), `npm run lint`, `npm run build`.

## Review Focus

The ways this most likely breaks for a real user, each pinned by a test in the task that owns it:

1. **A local-file Spotify song (no `id`, only a `spotify:local:…` URI).** Its decisions must be found. Pinned in Task 1 (`spotifyKeyOf`) and Task 2 (settling by URI).
2. **A match book that is corrupted, or from an older shape.** The review must open with an empty book, not crash. Pinned in Task 1.
3. **Rejecting a pair whose YouTube track another Spotify song also wanted.** The freed track goes to the next claimant. Pinned in Task 2.
4. **The same song listed twice on Spotify, after one copy was confirmed.** One pair forms and the other copy is unmatched. Pinned in Task 2.
5. **Choosing a second YouTube playlist while the first is still loading.** The board must show the second playlist, never the first one's late result. The hook has no unit-test harness in this repo, so this is a step in the Task 4 walkthrough, and the guard is written into Task 3's hook.

---

### Task 1: The match book

**Files:**
- Create: `src/match/matchBook.js`
- Test: `src/match/matchBook.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `spotifyKeyOf(track) → string|null`: the track's `id`, else its `uri`.
  - `loadMatchBook(storage?) → Decision[]`
  - `saveMatchBook(book, storage?) → boolean`: false when the store refuses.
  - `recordDecision(book, { spotifyKey, youtubeVideoId, verdict }, decidedAt?) → Decision[]`: replaces any earlier decision for that pair, and never mutates `book`.
  - `forgetDecision(book, spotifyKey, youtubeVideoId) → Decision[]`
  - `verdictLookup(book) → (spotifyKey, youtubeVideoId) => 'same'|'different'|null`
  - `Decision` is `{ spotifyKey: string, youtubeVideoId: string, verdict: 'same'|'different', decidedAt: number }`.

- [ ] **Step 1: Write the failing tests**

Create `src/match/matchBook.test.js`:

```js
import { describe, expect, test } from 'vitest'
import {
  forgetDecision,
  loadMatchBook,
  recordDecision,
  saveMatchBook,
  spotifyKeyOf,
  verdictLookup,
} from './matchBook.js'

function memoryStorage() {
  const store = new Map()
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: (key) => store.delete(key),
    store,
  }
}

const blockedStorage = {
  getItem() {
    throw new Error('blocked')
  },
  setItem() {
    throw new Error('blocked')
  },
  removeItem() {
    throw new Error('blocked')
  },
}

// Verbatim from the live Spotify export: a local file carries no id.
const LOCAL_URI = 'spotify:local:Alfaaz%3B+Yo+Yo+Honey+Singh:Boy+Next+Door:Haye+Mera+Dil:203'

const same = (spotifyKey, youtubeVideoId) => ({ spotifyKey, youtubeVideoId, verdict: 'same' })

describe('spotifyKeyOf', () => {
  test('a catalogue track is filed under its id', () => {
    expect(spotifyKeyOf({ id: '4uLU6hMCjMI75M1A2tKUQC', uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC' })).toBe(
      '4uLU6hMCjMI75M1A2tKUQC',
    )
  })

  test('a local file, which has no id, is filed under its URI', () => {
    expect(spotifyKeyOf({ id: null, uri: LOCAL_URI })).toBe(LOCAL_URI)
  })
})

describe('the match book', () => {
  test('a recorded decision is found again', () => {
    const book = recordDecision([], same('s1', 'y1'), 1)
    expect(verdictLookup(book)('s1', 'y1')).toBe('same')
  })

  test('an undecided pair has no verdict', () => {
    const book = recordDecision([], same('s1', 'y1'), 1)
    expect(verdictLookup(book)('s1', 'y2')).toBeNull()
  })

  test('deciding a pair again replaces the earlier decision', () => {
    const first = recordDecision([], same('s1', 'y1'), 1)
    const second = recordDecision(first, { spotifyKey: 's1', youtubeVideoId: 'y1', verdict: 'different' }, 2)
    expect(second).toEqual([{ spotifyKey: 's1', youtubeVideoId: 'y1', verdict: 'different', decidedAt: 2 }])
  })

  test('forgetting a pair removes only that pair', () => {
    const book = recordDecision(recordDecision([], same('s1', 'y1'), 1), same('s2', 'y2'), 2)
    const lookup = verdictLookup(forgetDecision(book, 's1', 'y1'))
    expect(lookup('s1', 'y1')).toBeNull()
    expect(lookup('s2', 'y2')).toBe('same')
  })

  test('recording does not change the book it was given', () => {
    const book = Object.freeze([{ spotifyKey: 's1', youtubeVideoId: 'y1', verdict: 'same', decidedAt: 1 }])
    recordDecision(book, { spotifyKey: 's1', youtubeVideoId: 'y1', verdict: 'different' }, 2)
    expect(book[0].verdict).toBe('same')
  })

  test('a decision about a local file is found by its URI', () => {
    const book = recordDecision([], same(LOCAL_URI, 'y1'), 1)
    expect(verdictLookup(book)(spotifyKeyOf({ id: null, uri: LOCAL_URI }), 'y1')).toBe('same')
  })
})

describe('storing the match book', () => {
  test('a saved book loads back unchanged', () => {
    const storage = memoryStorage()
    const book = recordDecision([], same('s1', 'y1'), 1)
    expect(saveMatchBook(book, storage)).toBe(true)
    expect(loadMatchBook(storage)).toEqual(book)
  })

  test('it is stored under the playlist-sorter prefix', () => {
    const storage = memoryStorage()
    saveMatchBook([], storage)
    expect([...storage.store.keys()]).toEqual(['playlist-sorter:match-book'])
  })

  test('an empty store is an empty book', () => {
    expect(loadMatchBook(memoryStorage())).toEqual([])
  })

  test.each([['not json'], ['{"spotifyKey":"s1"}'], ['null']])(
    'a store holding %s is an empty book, not a crash',
    (raw) => {
      const storage = memoryStorage()
      storage.setItem('playlist-sorter:match-book', raw)
      expect(loadMatchBook(storage)).toEqual([])
    },
  )

  test('entries that are not decisions are dropped on load', () => {
    const storage = memoryStorage()
    const good = { spotifyKey: 's1', youtubeVideoId: 'y1', verdict: 'same', decidedAt: 1 }
    storage.setItem(
      'playlist-sorter:match-book',
      JSON.stringify([good, { spotifyKey: 's2', youtubeVideoId: 'y2', verdict: 'maybe' }, { spotifyKey: 3 }, null]),
    )
    expect(loadMatchBook(storage)).toEqual([good])
  })

  test('a store that refuses to be read is an empty book', () => {
    expect(loadMatchBook(blockedStorage)).toEqual([])
  })

  test('a store that refuses to be written says so', () => {
    expect(saveMatchBook([], blockedStorage)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/match/matchBook.test.js`
Expected: FAIL, because `./matchBook.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/match/matchBook.js`:

```js
/**
 * The match book: every pairing decision the user has made, kept so the same
 * pair is never asked about twice (mirror design §8, D16).
 *
 * Pure apart from the storage it is handed, which is injected exactly as the
 * undo snapshots' is (src/plan/undo.js), so it tests without a browser. See
 * docs/2026-10-05-match-review-design.md §4.
 */

const KEY = 'playlist-sorter:match-book'
const VERDICTS = new Set(['same', 'different'])

/**
 * The key a Spotify track's decisions are filed under: its id, or for a local
 * file — which has none — its `spotify:local:…` URI.
 */
export function spotifyKeyOf(track) {
  return track?.id ?? track?.uri ?? null
}

/** Every stored decision. A missing, blocked or unreadable store is an empty book. */
export function loadMatchBook(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isDecision) : []
  } catch {
    return []
  }
}

/**
 * Store the book. False when the browser refuses — private browsing, blocked
 * site data — in which case the session still works and simply does not
 * persist.
 */
export function saveMatchBook(book, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(book))
    return true
  } catch {
    return false
  }
}

/** The book with this pair's decision set, replacing any earlier one. */
export function recordDecision(book, { spotifyKey, youtubeVideoId, verdict }, decidedAt = Date.now()) {
  return [...forgetDecision(book, spotifyKey, youtubeVideoId), { spotifyKey, youtubeVideoId, verdict, decidedAt }]
}

/** The book without this pair's decision. */
export function forgetDecision(book, spotifyKey, youtubeVideoId) {
  return book.filter((entry) => entry.spotifyKey !== spotifyKey || entry.youtubeVideoId !== youtubeVideoId)
}

/**
 * A constant-time lookup for pairing's `verdictFor`, built once per book.
 * Settling asks it about every Spotify-by-YouTube pair — 160,930 times for
 * the live playlists — so a scan of the book per question is not an option.
 */
export function verdictLookup(book) {
  const verdicts = new Map(book.map((entry) => [pairKey(entry.spotifyKey, entry.youtubeVideoId), entry.verdict]))
  return (spotifyKey, youtubeVideoId) => verdicts.get(pairKey(spotifyKey, youtubeVideoId)) ?? null
}

function pairKey(spotifyKey, youtubeVideoId) {
  return `${spotifyKey}\u0000${youtubeVideoId}`
}

function isDecision(entry) {
  return (
    typeof entry?.spotifyKey === 'string' &&
    typeof entry?.youtubeVideoId === 'string' &&
    VERDICTS.has(entry?.verdict)
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/match/matchBook.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Run the whole suite and the lint**

Run: `npm test` and `npm run lint`.
Expected: all tests pass. The lint shows only the two existing warnings.

- [ ] **Step 6: Commit**

```bash
git add src/match/matchBook.js src/match/matchBook.test.js
git commit -m "Keep pairing decisions in a match book

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Split pairing into scoring and settling

**Files:**
- Modify: `src/match/pairTracks.js` (the whole file is restructured; the sort comparator and claiming loop move unchanged into `settlePairs`)
- Modify: `src/match/scorePair.js`: export the existing `foldTitle` (change `function foldTitle` to `export function foldTitle`, nothing else)
- Test: `src/match/pairTracks.test.js` (append)

**Interfaces:**
- Consumes: `spotifyKeyOf` from Task 1; `scorePair`, `videoTypeRank` and `foldTitle` from `scorePair.js`; `diceCoefficient` from `src/csv/match.js`.
- Produces:
  - `scoreCandidates(spotifyTracks, youtubeTracks) → Candidate[]`: every non-null `scorePair` result as `{ spotify, youtube, tier, durationDeltaMs, reason }`. Slow.
  - `settlePairs(spotifyTracks, youtubeTracks, scored, { verdictFor }?) → { pairs, unmatchedSpotify, unmatchedYoutube, counts }`: the same shape `pairTracks` returns today. Never calls `scorePair`.
  - `pairTracks(spotifyTracks, youtubeTracks, options?)`: unchanged signature and behaviour, now `settlePairs(…, scoreCandidates(…), options)`.
  - `closestTitles(track, candidates) → Track[]`: candidates by title similarity to `track`, most similar first; ties keep input order; the input is not mutated.
  - `verdictFor` is now called as `verdictFor(spotifyKeyOf(spotifyTrack), youtubeTrack.id)`. Before, it received `spotifyTrack.id`, which is `null` for a local file.

- [ ] **Step 1: Write the failing tests**

Change the import at the top of `src/match/pairTracks.test.js` to:

```js
import { closestTitles, pairTracks, settlePairs } from './pairTracks.js'
```

Then append, inside the existing `describe('pairTracks', …)` block, before its closing `})`:

```js
  test('settling uses the scored candidates it is given, without rescoring', () => {
    // scorePair rejects this pair outright (different artist, 112s apart), so
    // the only way it can come back paired is from the list handed in.
    const s = sp('s1', 'Antidote', 'Karan Aujla', 188000)
    const y = yt('y1', 'Something Else Entirely', 'Nobody', 300000)
    const scored = [{ spotify: s, youtube: y, tier: 'strong', durationDeltaMs: 0, reason: 'handed in' }]
    const result = settlePairs([s], [y], scored)
    expect(result.pairs.map((pair) => pair.reason)).toEqual(['handed in'])
  })

  test('a rejected pair re-pairs the Spotify song with its next-best match', () => {
    const s1 = sp('s1', 'Antidote', 'Karan Aujla', 188000)
    const y1 = yt('y1', 'Antidote', 'Karan Aujla', 188000)
    const y2 = yt('y2', 'Antidote', 'Karan Aujla', 191000)
    const verdictFor = (key, videoId) => (key === 's1' && videoId === 'y1' ? 'different' : null)
    const result = pairTracks([s1], [y1, y2], { verdictFor })
    expect(result.pairs.map((pair) => [pair.spotify.id, pair.youtube.id, pair.tier])).toEqual([['s1', 'y2', 'likely']])
    expect(result.unmatchedYoutube.map((track) => track.id)).toEqual(['y1'])
  })

  test('a rejected pair frees its YouTube track for the next Spotify song that wanted it', () => {
    const s1 = sp('s1', 'Antidote', 'Karan Aujla', 188000)
    const s2 = sp('s2', 'Antidote', 'Karan Aujla', 191000)
    const y1 = yt('y1', 'Antidote', 'Karan Aujla', 188000)
    const verdictFor = (key, videoId) => (key === 's1' && videoId === 'y1' ? 'different' : null)
    const result = pairTracks([s1, s2], [y1], { verdictFor })
    expect(result.pairs.map((pair) => [pair.spotify.id, pair.youtube.id, pair.tier])).toEqual([['s2', 'y1', 'likely']])
    expect(result.unmatchedSpotify.map((track) => track.id)).toEqual(['s1'])
  })

  test('a pair made by hand is certain even where the matcher proposes nothing', () => {
    // Verbatim from the live libraries: a label-channel upload, credited to
    // the label, which scorePair deliberately never pairs (root cause 8).
    const s = sp('s1', 'No Need', 'Karan Aujla', 189000)
    const y = yt(
      'y1',
      'No Need (Full Video) Karan Aujla | Deep Jandu | Rupan Bal | Latest Punjabi song 2019',
      'Rehaan Records',
      189000,
    )
    expect(pairTracks([s], [y]).pairs).toHaveLength(0)
    const result = pairTracks([s], [y], { verdictFor: () => 'same' })
    expect(result.pairs.map((pair) => pair.tier)).toEqual(['certain'])
  })

  test('a pair made by hand takes its YouTube track ahead of the matcher', () => {
    const s1 = sp('s1', 'Antidote', 'Karan Aujla', 188000)
    const s2 = sp('s2', 'Intro', 'Karan Aujla', 60000)
    const y1 = yt('y1', 'Antidote', 'Karan Aujla', 188000)
    const verdictFor = (key, videoId) => (key === 's2' && videoId === 'y1' ? 'same' : null)
    const result = pairTracks([s1, s2], [y1], { verdictFor })
    expect(result.pairs.map((pair) => [pair.spotify.id, pair.youtube.id, pair.tier])).toEqual([['s2', 'y1', 'certain']])
    expect(result.unmatchedSpotify.map((track) => track.id)).toEqual(['s1'])
  })

  test('a decision about a local file is found by its URI', () => {
    // Verbatim from the live libraries: a local file (no id) that the matcher
    // pairs as likely, 7s and one spelling apart.
    const local = {
      ...sp(null, 'Haye Mera Dil', 'Alfaaz; Yo Yo Honey Singh', 203000),
      uri: 'spotify:local:Alfaaz%3B+Yo+Yo+Honey+Singh:Boy+Next+Door:Haye+Mera+Dil:203',
      isLocal: true,
    }
    const y = yt('y1', 'Hai Mera Dil', 'Alfaaz', 210000)
    expect(pairTracks([local], [y]).pairs).toHaveLength(1)
    const verdictFor = (key, videoId) => (key === local.uri && videoId === 'y1' ? 'different' : null)
    expect(pairTracks([local], [y], { verdictFor }).pairs).toHaveLength(0)
  })

  test('the same song listed twice on Spotify claims one YouTube copy once', () => {
    const first = sp('s1', 'Antidote', 'Karan Aujla', 188000)
    const again = sp('s1', 'Antidote', 'Karan Aujla', 188000)
    const y = yt('y1', 'Antidote', 'Karan Aujla', 188000)
    const result = pairTracks([first, again], [y], { verdictFor: () => 'same' })
    expect(result.pairs).toHaveLength(1)
    expect(result.unmatchedSpotify).toHaveLength(1)
  })

  test('candidates for pairing by hand come most similar title first', () => {
    const target = sp('s1', 'Maar Sutya', 'Amrinder Gill', 239106)
    const options = [
      yt('y1', 'Antidote', 'Karan Aujla', 188000),
      yt('y2', 'Maar Sutiya', 'Amrinder Gill', 237000),
      yt('y3', 'Hai Mera Dil', 'Alfaaz', 210000),
    ]
    expect(closestTitles(target, options)[0].id).toBe('y2')
    expect(options.map((track) => track.id)).toEqual(['y1', 'y2', 'y3'])
  })

  test('candidates with equally dissimilar titles keep their playlist order', () => {
    const target = sp('s1', 'Abc', 'Someone', 1000)
    const options = [yt('y1', 'Qqq', 'Other', 1000), yt('y2', 'Zzz', 'Other', 1000)]
    expect(closestTitles(target, options).map((track) => track.id)).toEqual(['y1', 'y2'])
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/match/pairTracks.test.js`
Expected: FAIL. `settlePairs` and `closestTitles` are not exported, and the local-file test fails because `verdictFor` receives `null` for a local file.

- [ ] **Step 3: Export `foldTitle`**

In `src/match/scorePair.js`, change the line `function foldTitle(text) {` to `export function foldTitle(text) {`. Change nothing else in that file.

- [ ] **Step 4: Restructure `src/match/pairTracks.js`**

Replace the file's contents with the following. The sort comparator and the claiming loop are the existing code, moved verbatim. The two changes are that the tie-break and the verdict lookup use `spotifyKeyOf`.

```js
/**
 * Pairs a Spotify playlist against a YouTube playlist.
 *
 * Pure module: no network, no storage, no React. The match book is injected
 * as `verdictFor` so this never learns where a verdict is kept (M4).
 *
 * Every pair this returns is a PROPOSAL. Only a verdict of 'same' — a human
 * having already confirmed that exact pair — comes back as certain (D15).
 *
 * Split in two for the match review: scoring is the slow half and runs once
 * per review; settling applies decisions and claims pairs, and reruns after
 * every click. See docs/2026-10-05-match-review-design.md §5.
 */

import { diceCoefficient } from '../csv/match.js'
import { spotifyKeyOf } from './matchBook.js'
import { foldTitle, scorePair, videoTypeRank } from './scorePair.js'

const TIER_RANK = { certain: 3, strong: 2, likely: 1 }

/**
 * Every pair scorePair proposes, before any decision is applied. The slow
 * half: 160,930 scorePair calls, about 0.35s, for the live playlists.
 */
export function scoreCandidates(spotifyTracks, youtubeTracks) {
  const candidates = []
  for (const left of spotifyTracks ?? []) {
    for (const right of youtubeTracks ?? []) {
      const scored = scorePair(left, right)
      if (scored) candidates.push({ spotify: left, youtube: right, ...scored })
    }
  }
  return candidates
}

/**
 * Apply the user's decisions to scored candidates and claim pairs. Never
 * calls scorePair, so it is cheap enough to rerun after every decision.
 *
 * Decisions are looked up by spotifyKeyOf, not by id: a local file has none.
 *
 * @param {Array} spotifyTracks
 * @param {Array} youtubeTracks
 * @param {Array} scored what scoreCandidates returned for these two lists
 * @param {{verdictFor?: (spotifyKey: string, youtubeVideoId: string) => string|null}} [options]
 */
export function settlePairs(spotifyTracks, youtubeTracks, scored, { verdictFor } = {}) {
  const spotify = spotifyTracks ?? []
  const youtube = youtubeTracks ?? []
  const verdictOf = (left, right) => verdictFor?.(spotifyKeyOf(left), right?.id) ?? null

  const candidates = []
  // A confirmed pair is certain whether or not the matcher proposed it, which
  // is what makes pairing by hand work (D25). Looking every pair up is cheap;
  // scoring them is the part that is not.
  if (verdictFor) {
    for (const left of spotify) {
      for (const right of youtube) {
        if (verdictOf(left, right) !== 'same') continue
        candidates.push({
          spotify: left,
          youtube: right,
          tier: 'certain',
          durationDeltaMs: (right?.durationMs ?? 0) - (left?.durationMs ?? 0),
          reason: 'You confirmed this pair before',
        })
      }
    }
  }
  // A dismissed pair is gone for good, not re-proposed every sync (D16); a
  // confirmed one is already in the list above.
  for (const candidate of scored ?? []) {
    if (verdictOf(candidate.spotify, candidate.youtube) === null) candidates.push(candidate)
  }

  candidates.sort((a, b) => {
    const byTier = TIER_RANK[b.tier] - TIER_RANK[a.tier]
    if (byTier !== 0) return byTier
    const byDrift = Math.abs(a.durationDeltaMs) - Math.abs(b.durationDeltaMs)
    if (byDrift !== 0) return byDrift
    // M3: only ever a tie-break, never a reason to promote or reject.
    const byVideoType = videoTypeRank(b.youtube) - videoTypeRank(a.youtube)
    if (byVideoType !== 0) return byVideoType
    // C-1: tier, drift and videoTypeRank can ALL tie — two Spotify tracks
    // sitting equally close to the same YouTube track, say. Array.prototype.sort
    // is stable, so without a further tie-break the outcome silently falls back
    // to insertion order, i.e. input order. That is not a total order: reversing
    // one of the input arrays could then pick a different winner for a
    // contested track and drop a real match. Break the remaining tie on the
    // keys themselves so the ordering never depends on array position. The
    // Spotify key, not the id: two local files both have a null id.
    //
    // Plain `<` here, not `localeCompare`: localeCompare with no locale
    // argument is ICU- and host-locale-dependent BY SPECIFICATION, so it can
    // order the same two ids differently on different machines (e.g. mixed
    // case ids like real Spotify ids sort differently under ICU collation
    // than under code-unit order). That would reintroduce exactly the
    // environment-dependent outcome this tie-break exists to remove. Plain
    // relational comparison on strings is a UTF-16 code-unit comparison,
    // which is spec-guaranteed and has no locale or ICU dependency — do not
    // "simplify" this back to localeCompare.
    const aSpotifyKey = String(spotifyKeyOf(a.spotify) ?? '')
    const bSpotifyKey = String(spotifyKeyOf(b.spotify) ?? '')
    if (aSpotifyKey !== bSpotifyKey) return aSpotifyKey < bSpotifyKey ? -1 : 1
    const aYoutubeId = String(a.youtube?.id ?? '')
    const bYoutubeId = String(b.youtube?.id ?? '')
    if (aYoutubeId !== bYoutubeId) return aYoutubeId < bYoutubeId ? -1 : 1
    return 0
  })

  const pairs = []
  const claimedSpotify = new Set()
  const claimedYoutube = new Set()
  // I-1: this pass is greedy by confidence, not a cardinality-optimal
  // assignment. With s1=188000ms, s2=191000ms against y1=188000ms, y2=185000ms,
  // s1 ties strong with y1 (0s drift) while s1-y2 and s2-y1 are only likely
  // (3s drift each). The optimal ASSIGNMENT pairs s1-y2 and s2-y1 (2 matches),
  // but greedy claims the strongest candidate first (s1-y1) and starves s2, so
  // this returns only 1 pair. That is a deliberate trade-off, not a bug: a
  // wrong pair puts a wrong track in a real playlist, while an unmatched track
  // merely falls through to a later search — so confidence wins over count.
  for (const candidate of candidates) {
    if (claimedSpotify.has(candidate.spotify) || claimedYoutube.has(candidate.youtube)) continue
    claimedSpotify.add(candidate.spotify)
    claimedYoutube.add(candidate.youtube)
    pairs.push(candidate)
  }

  const unmatchedSpotify = spotify.filter((track) => !claimedSpotify.has(track))
  const unmatchedYoutube = youtube.filter((track) => !claimedYoutube.has(track))

  return {
    pairs,
    unmatchedSpotify,
    unmatchedYoutube,
    counts: {
      certain: pairs.filter((pair) => pair.tier === 'certain').length,
      strong: pairs.filter((pair) => pair.tier === 'strong').length,
      likely: pairs.filter((pair) => pair.tier === 'likely').length,
      unmatchedSpotify: unmatchedSpotify.length,
      unmatchedYoutube: unmatchedYoutube.length,
    },
  }
}

/**
 * @param {Array} spotifyTracks
 * @param {Array} youtubeTracks
 * @param {{verdictFor?: (spotifyKey: string, youtubeVideoId: string) => string|null}} [options]
 */
export function pairTracks(spotifyTracks, youtubeTracks, options) {
  return settlePairs(spotifyTracks, youtubeTracks, scoreCandidates(spotifyTracks, youtubeTracks), options)
}

/**
 * Candidates for pairing a track by hand, most similar title first (D25).
 * Ties keep their playlist order; the input array is not changed.
 */
export function closestTitles(track, candidates) {
  const title = foldTitle(track?.name)
  const similarity = new Map(candidates.map((candidate) => [candidate, diceCoefficient(title, foldTitle(candidate?.name))]))
  return candidates.toSorted((a, b) => similarity.get(b) - similarity.get(a))
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/match/pairTracks.test.js src/match/scorePair.test.js`
Expected: PASS, every existing test and every new one.

- [ ] **Step 6: The real-library gate**

The spec requires the split to reproduce today's counts exactly on the exported live playlists before any screen work. Both data files are in the session scratchpad. Run from the repo root in Git Bash:

```bash
S="C:/Users/Soans/AppData/Local/Temp/claude/c--Users-Soans-Desktop-Work-spotify-playlist-sorter/d63bac51-2544-4f35-a048-82166c97cc23/scratchpad"
node --input-type=module -e "
import { readFileSync } from 'node:fs'
const { scoreCandidates, settlePairs } = await import('./src/match/pairTracks.js')
const sp = JSON.parse(readFileSync('$S/spotify-playlist.json', 'utf8')).tracks
const yt = JSON.parse(readFileSync('$S/real-youtube-library-fresh.json', 'utf8')).map((t, i) => ({ id: 'yt' + i, name: t.title, artists: t.artists.map((name) => ({ id: null, name })), primaryArtist: { id: null, name: t.artists[0] }, durationMs: t.durationSeconds * 1000, videoType: t.videoType, album: { id: null, name: t.album ?? '' } }))
let t = performance.now(); const scored = scoreCandidates(sp, yt); const scoreMs = performance.now() - t
t = performance.now(); const result = settlePairs(sp, yt, scored, { verdictFor: () => null }); const settleMs = performance.now() - t
console.log(JSON.stringify(result.counts), 'score', Math.round(scoreMs) + 'ms', 'settle', Math.round(settleMs) + 'ms')
"
```

Expected: `{"certain":0,"strong":244,"likely":63,"unmatchedSpotify":111,"unmatchedYoutube":78}`, with settling at least ten times faster than scoring. If the counts differ, stop and report. Do not adjust anything to make them match.

- [ ] **Step 7: Run the whole suite and the lint**

Run: `npm test` and `npm run lint`.
Expected: all tests pass. The lint shows only the two existing warnings.

- [ ] **Step 8: Commit**

```bash
git add src/match/pairTracks.js src/match/pairTracks.test.js src/match/scorePair.js
git commit -m "Split pairing into scoring once and settling per decision

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The review screen

**Files:**
- Modify: `src/ui/format.js` (add `formatDelta`)
- Create: `src/ui/format.test.js`
- Create: `src/ui/useMatchReview.js`
- Create: `src/ui/screens/Review.jsx`
- Modify: `src/ui/useSorterApp.js`: add `youtube` to the returned object (the client already exists there as `const youtube = useMemo(() => createYouTubeClient({}), [])`)
- Modify: `src/App.jsx`: route `screen === 'review'` to the new screen
- Modify: `src/ui/screens/Sort.jsx`: add the "Match to YouTube" button
- Modify: `src/ui/board.css`: the review board's grid and its few new elements

**Interfaces:**
- Consumes:
  - from Task 1: `loadMatchBook`, `saveMatchBook`, `recordDecision`, `forgetDecision`, `verdictLookup`, `spotifyKeyOf`;
  - from Task 2: `scoreCandidates`, `settlePairs`, `closestTitles`;
  - existing: `youtube.listPlaylists()`, `youtube.fetchPlaylist(id) → {counted, readable, tracks}`, `toAppPlaylists`, `normalizeYouTubeTracks`, and from `chrome.jsx` `Frame`, `Head`, `Lever`, `LeverRow`, `Meter`, `Notice`, `QuietLever`, plus `UnlitField`.
- Produces: `formatDelta(ms) → string`; `useMatchReview({ youtube, spotifyTracks, storage? })`; `ReviewScreen({ app })`; the app screen id `'review'`.

- [ ] **Step 1: Write the failing test for `formatDelta`**

Create `src/ui/format.test.js`:

```js
import { expect, test } from 'vitest'
import { formatDelta } from './format.js'

test.each([
  [7118, '+7s'],
  [-2106, '−2s'],
  [29750, '+30s'],
  [22, '0s'],
  [-400, '0s'],
])('a duration difference of %ims reads %s', (ms, expected) => {
  expect(formatDelta(ms)).toBe(expected)
})
```

Run: `npx vitest run src/ui/format.test.js`
Expected: FAIL, because `formatDelta` is not exported.

- [ ] **Step 2: Implement `formatDelta`**

Append to `src/ui/format.js`:

```js
/**
 * A signed duration difference in whole seconds: "+7s", "−2s", "0s". The sign
 * is the point — it says which side runs longer — so it uses a true minus.
 */
export function formatDelta(ms) {
  const seconds = Math.round((ms ?? 0) / 1000)
  if (seconds === 0) return '0s'
  return `${seconds > 0 ? '+' : '−'}${Math.abs(seconds)}s`
}
```

Run: `npx vitest run src/ui/format.test.js`
Expected: PASS.

- [ ] **Step 3: Create the hook**

Create `src/ui/useMatchReview.js`:

```js
/**
 * The match review: one Spotify playlist against a YouTube playlist the user
 * picks, with every decision kept in the match book.
 *
 * Read-only towards both services. Scoring is the slow half and runs once per
 * chosen playlist; settling reruns after every decision. See
 * docs/2026-10-05-match-review-design.md.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  forgetDecision,
  loadMatchBook,
  recordDecision,
  saveMatchBook,
  spotifyKeyOf,
  verdictLookup,
} from '../match/matchBook.js'
import { scoreCandidates, settlePairs } from '../match/pairTracks.js'
import { toAppPlaylists } from '../services/youtube/playlists.js'
import { normalizeYouTubeTracks } from '../services/youtube/track.js'

export function useMatchReview({ youtube, spotifyTracks, storage = globalThis.localStorage }) {
  const [youtubePlaylists, setYoutubePlaylists] = useState([])
  const [chosenId, setChosenId] = useState(null)
  const [youtubeTracks, setYoutubeTracks] = useState([])
  const [scored, setScored] = useState(null)
  const [unavailable, setUnavailable] = useState(0)
  const [book, setBook] = useState(() => loadMatchBook(storage))
  const [remembered, setRemembered] = useState(true)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const latest = useRef(0)

  useEffect(() => {
    let live = true
    youtube
      .listPlaylists()
      .then((raw) => live && setYoutubePlaylists(toAppPlaylists(raw)))
      .catch((failure) => live && setError(failure.message))
    return () => {
      live = false
    }
  }, [youtube])

  const choose = useCallback(
    async (playlistId) => {
      // Only the latest choice may land: a slow first playlist resolving after
      // a second was chosen must never overwrite the second.
      const ticket = ++latest.current
      setChosenId(playlistId || null)
      setScored(null)
      setYoutubeTracks([])
      setUnavailable(0)
      setError(null)
      if (!playlistId) return
      try {
        setBusy('Reading the YouTube playlist')
        const fetched = await youtube.fetchPlaylist(playlistId)
        if (ticket !== latest.current) return
        const tracks = normalizeYouTubeTracks(fetched.tracks)
        setBusy('Matching')
        // Let the meter paint before ~0.35s of synchronous scoring.
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (ticket !== latest.current) return
        const candidates = scoreCandidates(spotifyTracks, tracks)
        setYoutubeTracks(tracks)
        setUnavailable(Math.max(0, (fetched.counted ?? 0) - (fetched.readable ?? 0)))
        setScored(candidates)
      } catch (failure) {
        if (ticket === latest.current) setError(failure.message)
      } finally {
        if (ticket === latest.current) setBusy(null)
      }
    },
    [youtube, spotifyTracks],
  )

  const result = useMemo(
    () => (scored ? settlePairs(spotifyTracks, youtubeTracks, scored, { verdictFor: verdictLookup(book) }) : null),
    [spotifyTracks, youtubeTracks, scored, book],
  )

  const commit = useCallback(
    (next) => {
      setBook(next)
      setRemembered(saveMatchBook(next, storage))
    },
    [storage],
  )

  const decide = useCallback(
    (spotifyTrack, youtubeTrack, verdict) =>
      commit(
        recordDecision(book, { spotifyKey: spotifyKeyOf(spotifyTrack), youtubeVideoId: youtubeTrack.id, verdict }),
      ),
    [book, commit],
  )

  // One save for the whole group, not one per pair.
  const confirmAll = useCallback(
    (pairs) =>
      commit(
        pairs.reduce(
          (next, pair) =>
            recordDecision(next, {
              spotifyKey: spotifyKeyOf(pair.spotify),
              youtubeVideoId: pair.youtube.id,
              verdict: 'same',
            }),
          book,
        ),
      ),
    [book, commit],
  )

  const undo = useCallback(
    (pair) => commit(forgetDecision(book, spotifyKeyOf(pair.spotify), pair.youtube.id)),
    [book, commit],
  )

  return { youtubePlaylists, chosenId, choose, result, unavailable, busy, error, remembered, decide, confirmAll, undo }
}
```

- [ ] **Step 4: Create the screen**

Create `src/ui/screens/Review.jsx`:

```jsx
/**
 * Match review: which Spotify track is which YouTube track.
 *
 * Read-only. Decisions go to the match book; nothing is written to Spotify or
 * YouTube. Likely rows warm amber (pending) and settled rows take the green
 * seat (committed), reusing the board's data-moves and data-written states.
 * See docs/2026-10-05-match-review-design.md §3.
 */

import { closestTitles } from '../../match/pairTracks.js'
import { artistsOf, formatCount, formatDelta, titleOf } from '../format.js'
import { useMatchReview } from '../useMatchReview.js'
import { Frame, Head, Lever, LeverRow, Meter, Notice, QuietLever } from '../components/chrome.jsx'
import { UnlitField } from '../components/UnlitField.jsx'

export function ReviewScreen({ app }) {
  const { playlist, tracks, youtube, setScreen } = app
  const review = useMatchReview({ youtube, spotifyTracks: tracks })
  const { result } = review
  const tier = (name) => result?.pairs.filter((pair) => pair.tier === name) ?? []
  const likely = tier('likely')
  const strong = tier('strong')
  const settled = tier('certain')

  return (
    <Frame fill>
      <Head
        back={{ label: 'Back to sorting', onClick: () => setScreen('sort') }}
        title={playlist?.name ?? 'Playlist'}
        tally={
          result
            ? [
                { label: 'Strong', value: formatCount(strong.length) },
                { label: 'Likely', value: formatCount(likely.length), tone: likely.length ? 'amber' : undefined },
                { label: 'Settled', value: formatCount(settled.length), tone: settled.length ? 'green' : undefined },
                { label: 'Only Spotify', value: formatCount(result.unmatchedSpotify.length) },
                { label: 'Only YouTube', value: formatCount(result.unmatchedYoutube.length) },
              ]
            : []
        }
      />

      <div className="section">
        <label className="field-label" htmlFor="review-youtube">
          Match against
        </label>
        <select
          id="review-youtube"
          className="field"
          value={review.chosenId ?? ''}
          onChange={(event) => review.choose(event.target.value)}
        >
          <option value="">Choose a YouTube Music playlist</option>
          {review.youtubePlaylists.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({formatCount(item.trackCount)})
            </option>
          ))}
        </select>
        {review.unavailable > 0 ? (
          <p className="row-sub" style={{ marginTop: 8 }}>
            <span className="num">{formatCount(review.unavailable)}</span> unavailable on YouTube
          </p>
        ) : null}
      </div>

      {review.busy ? (
        <div className="section">
          <p className="col-label" style={{ marginBottom: 8 }}>
            {review.busy}
          </p>
          <Meter done={0} total={1} />
        </div>
      ) : null}

      {review.error ? (
        <div className="section">
          <Notice tone="red" title="Could not read YouTube Music">
            {review.error}
          </Notice>
        </div>
      ) : null}

      {review.remembered ? null : (
        <div className="section">
          <Notice tone="amber" title="Decisions will not be remembered">
            This browser is blocking storage for the page, so these decisions last only until the tab closes.
          </Notice>
        </div>
      )}

      {result ? (
        <div className="board board-review">
          <div className="board-cols" role="row">
            <span className="col-label">Spotify</span>
            <span className="col-label">YouTube Music</span>
            <span className="col-label">Length</span>
            <span className="col-label col-why">Why</span>
            <span className="col-label" />
          </div>

          <div className="board-scroll" role="table" aria-label="Matches">
            <GroupHeading count={likely.length}>Likely — check each one</GroupHeading>
            {likely.map((pair) => (
              <PairRow key={`l${pair.spotify.originalIndex}`} pair={pair} state="pending">
                <DecisionLevers pair={pair} review={review} />
              </PairRow>
            ))}

            <GroupHeading count={strong.length}>Strong</GroupHeading>
            {strong.map((pair) => (
              <PairRow key={`s${pair.spotify.originalIndex}`} pair={pair}>
                <DecisionLevers pair={pair} review={review} />
              </PairRow>
            ))}

            <GroupHeading count={result.unmatchedSpotify.length}>Only on Spotify</GroupHeading>
            {result.unmatchedSpotify.map((track) => (
              <OnlySpotifyRow
                key={`o${track.originalIndex}`}
                track={track}
                options={closestTitles(track, result.unmatchedYoutube)}
                onPair={(chosen) => review.decide(track, chosen, 'same')}
              />
            ))}

            <GroupHeading count={result.unmatchedYoutube.length}>Only on YouTube</GroupHeading>
            {result.unmatchedYoutube.map((track) => (
              <div className="board-row" role="row" key={`y${track.originalIndex}`}>
                <span role="cell" />
                <TrackCell track={track} href={youtubeHref(track)} />
                <span role="cell" />
                <span role="cell" className="col-why" />
                <span role="cell" />
              </div>
            ))}

            <details className="review-settled">
              <summary className="review-group col-label">
                Settled (<span className="num">{formatCount(settled.length)}</span>)
              </summary>
              {settled.map((pair) => (
                <PairRow key={`c${pair.spotify.originalIndex}`} pair={pair} state="settled">
                  <QuietLever className="lever-quiet is-compact" onClick={() => review.undo(pair)}>
                    Undo
                  </QuietLever>
                </PairRow>
              ))}
            </details>

            <UnlitField />
          </div>
        </div>
      ) : null}

      <LeverRow>
        <span className="spacer" />
        <Lever disabled={strong.length === 0} onClick={() => review.confirmAll(strong)}>
          Confirm all {formatCount(strong.length)} strong
        </Lever>
      </LeverRow>
    </Frame>
  )
}

function GroupHeading({ count, children }) {
  return (
    <p className="review-group col-label">
      {children} (<span className="num">{formatCount(count)}</span>)
    </p>
  )
}

function DecisionLevers({ pair, review }) {
  return (
    <>
      <QuietLever className="lever-quiet is-compact" onClick={() => review.decide(pair.spotify, pair.youtube, 'same')}>
        Confirm
      </QuietLever>
      <QuietLever
        className="lever-quiet is-compact"
        onClick={() => review.decide(pair.spotify, pair.youtube, 'different')}
      >
        Reject
      </QuietLever>
    </>
  )
}

function PairRow({ pair, state, children }) {
  return (
    <div
      className="board-row"
      role="row"
      data-moves={state === 'pending' ? 'true' : undefined}
      data-written={state === 'settled' ? 'true' : undefined}
    >
      <TrackCell track={pair.spotify} href={spotifyHref(pair.spotify)} />
      <TrackCell track={pair.youtube} href={youtubeHref(pair.youtube)} />
      <span className="cell-end" role="cell">
        <span className="row-meta num">{formatDelta(pair.durationDeltaMs)}</span>
      </span>
      <span className="row-sub col-why" role="cell">
        {pair.reason}
      </span>
      <span className="cell-end review-levers" role="cell">
        {children}
      </span>
    </div>
  )
}

function OnlySpotifyRow({ track, options, onPair }) {
  return (
    <div className="board-row" role="row">
      <TrackCell track={track} href={spotifyHref(track)} />
      <span role="cell">
        <select
          className="field field-compact"
          value=""
          aria-label={`Pair ${titleOf(track)} with a YouTube track`}
          onChange={(event) => {
            const chosen = options[Number(event.target.value)]
            if (chosen) onPair(chosen)
          }}
        >
          <option value="">Pair with…</option>
          {options.map((option, index) => (
            <option key={`${option.originalIndex}`} value={index}>
              {titleOf(option)} — {artistsOf(option)}
            </option>
          ))}
        </select>
      </span>
      <span role="cell" />
      <span role="cell" className="col-why" />
      <span role="cell" />
    </div>
  )
}

function TrackCell({ track, href }) {
  return (
    <span className="cell-stack" role="cell">
      <span className="row-title">{titleOf(track)}</span>
      <span className="row-sub">
        {artistsOf(track)}
        {href ? (
          <>
            {' · '}
            <a className="row-play" href={href} target="_blank" rel="noreferrer">
              Play
            </a>
          </>
        ) : null}
      </span>
    </span>
  )
}

// A local file has no id and nothing to link to.
const spotifyHref = (track) => (track?.id ? `https://open.spotify.com/track/${track.id}` : null)
const youtubeHref = (track) => (track?.id ? `https://music.youtube.com/watch?v=${track.id}` : null)
```

- [ ] **Step 5: Wire the screen into the app**

In `src/ui/useSorterApp.js`, add `youtube,` to the object the hook returns (place it on the line after `setSource: changeSource,`).

In `src/App.jsx`, add `import { ReviewScreen } from './ui/screens/Review.jsx'` beside the other screen imports. Then extend the screen choice so that `app.screen === 'review'` renders `<ReviewScreen app={app} />`, placed after the `'progress'` branch:

```jsx
        : app.screen === 'progress'
          ? <ProgressScreen app={app} />
          : app.screen === 'review'
            ? <ReviewScreen app={app} />
            : <PlaylistsScreen app={app} auth={auth} />
```

In `src/ui/screens/Sort.jsx`, inside the existing `<LeverRow sticky>`, put the button before `<span className="spacer" />`. Only a Spotify playlist offers it:

```jsx
        {capabilitySource === 'spotify' ? (
          <QuietLever onClick={() => setScreen('review')} disabled={!ready}>
            Match to YouTube
          </QuietLever>
        ) : null}
```

`capabilitySource`, `setScreen`, `ready` and `QuietLever` are already in scope in that file.

- [ ] **Step 6: Style the review board**

Append to `src/ui/board.css`:

```css
/* ---- Match review board ---------------------------------------------- */

/* Spotify | YouTube | length | why | actions. Declared once per breakpoint
   (the Single Grid Declaration Rule). */
.board-review {
  --cols: minmax(0, 1fr) minmax(0, 1fr) 9ch minmax(0, 0.8fr) 24ch;
}

.review-group {
  padding: 18px clamp(10px, 1.4vw, 18px) 8px;
  border-bottom: 1px solid var(--rule);
}

.review-settled > summary {
  cursor: pointer;
}

.review-settled > summary::marker {
  color: var(--flap-dim);
}

.review-levers {
  gap: 6px;
}

.lever-quiet.is-compact {
  padding: 5px 12px;
}

.field-compact {
  padding: 5px 8px;
  font-size: var(--fs-sub);
}

.row-play {
  color: var(--flap);
}

@media (max-width: 680px) {
  .board-review {
    --cols: minmax(0, 1fr) minmax(0, 1fr) 7ch 20ch;
  }

  .board-review .col-why {
    display: none;
  }
}
```

- [ ] **Step 7: Verify**

Run: `npm test`, `npm run lint` and `npm run build`.
Expected: all tests pass; the lint shows only the two existing warnings; the build is clean.

- [ ] **Step 8: Commit**

```bash
git add src/ui/format.js src/ui/format.test.js src/ui/useMatchReview.js src/ui/screens/Review.jsx src/ui/useSorterApp.js src/App.jsx src/ui/screens/Sort.jsx src/ui/board.css
git commit -m "Add the match review screen, reached from a Spotify playlist

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The walkthrough gate, then the record

This repo has no component-test infrastructure, so the spec makes a manual walkthrough the gate. **The owner runs it in the browser.** Plan A is not done until every step below matches. The controller prepares it, hands it over, and waits.

**Files:**
- Modify: `docs/STATUS.md` (the 2b section)
- Modify: `docs/2026-09-18-youtube-mirror-design.md` (§8: export and import are deferred)

- [ ] **Step 1: Prepare**

Run `npm test`, `python -m pytest proxy`, `npm run lint` and `npm run build`. All must pass. Confirm the proxy has a live session: `curl -s -X POST http://127.0.0.1:8787/auth/status` must answer `{"authenticated":true}`. If it does not, the owner refreshes `proxy/browser.json` first (see `proxy/README.md`).

- [ ] **Step 2: The owner's walkthrough**

With `npm start` running, at http://127.0.0.1:5173:

1. Open the Spotify playlist **Punjabi Songs**. On its Sort screen, **Match to YouTube** shows in the lever row.
2. Click it. The review screen opens with the dropdown and no board.
3. Choose **punjabi songs**. The meter shows "Reading the YouTube playlist", then "Matching", then the board. The header reads **Strong 244 · Likely 63 · Settled 0 · Only Spotify 111 · Only YouTube 78**, and "4 unavailable on YouTube" sits under the dropdown.
4. **Confirm** one likely pair. Likely drops by one, Settled rises by one, and the row appears under Settled with the green seat.
5. **Reject** one strong pair. It leaves Strong. Its Spotify song either reappears paired with another YouTube track or shows under Only on Spotify.
6. Under Only on Spotify, find **No Need**. Its **Pair with…** list includes the `No Need (Full Video) Karan Aujla | …` upload near the top. Pick it, and the pair moves to Settled.
7. Expand **Settled**, then **Undo** one. It returns to its group.
8. Click **Confirm all … strong**. Strong becomes 0 and Settled rises by the same number.
9. Choose a different YouTube playlist, then immediately choose **punjabi songs** again. The board shows punjabi songs, not the other playlist (Review Focus 5).
10. **Reload the page,** reopen Punjabi Songs, then Match to YouTube, then choose punjabi songs. Every decision from steps 4–8 is still settled.
11. Click a **Play** link on each side. Spotify and YouTube Music open on that track.

If any step differs, stop, report it to the controller, and fix it before going on.

- [ ] **Step 3: Record it**

In `docs/STATUS.md`, add to the end of the "YouTube Music: 2b matcher, audited" section:

```markdown
### Match review (Plan A) — done 2026-10-DD

A Spotify playlist's Sort screen opens a review against a YouTube Music
playlist: likely pairs first, then strong (with one-click Confirm all),
both unmatched lists, and settled pairs collapsed. Decisions are kept in
the match book (`localStorage`, `playlist-sorter:match-book`), keyed by
Spotify id or a local file's URI, so a reload keeps them. Pairing is
scored once per review and settled per click. Read-only: nothing is
written to either service. Walkthrough passed by the owner on the live
libraries.
```

Replace `DD` with the date the walkthrough passed. In `docs/2026-09-18-youtube-mirror-design.md` §8, after the sentence ending "so it survives a cleared browser.", add the line: `*Deferred (2026-10-05): export and import wait until the book holds real work; see the match review design §8.*`

`docs/STATUS.md` carries an uncommitted line from the owner (the simplification-audit link). Stage only your own change. If you cannot stage it without that line, stop and ask the controller.

- [ ] **Step 4: Commit**

```bash
git add docs/2026-09-18-youtube-mirror-design.md docs/STATUS.md
git commit -m "Record the match review as done

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
