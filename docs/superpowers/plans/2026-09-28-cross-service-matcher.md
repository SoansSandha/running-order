# Cross-Service Matcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Given a Spotify playlist and a YouTube playlist, decide which tracks are the same track — and be honest about how confident each answer is.

**Architecture:** Pure functions only. No network, no UI, no storage. `scorePair` judges one candidate pair; `pairTracks` runs the whole cross product greedily so a stronger match always wins a contested track. The match book arrives in a later plan and is injected here as a callback, so this module never learns where verdicts are stored.

**Tech Stack:** JavaScript (ES modules, **not** TypeScript), Vitest, Oxlint.

**Spec:** [`docs/2026-09-18-youtube-mirror-design.md`](../../2026-09-18-youtube-mirror-design.md) — §7 (matching), D15 (nothing auto-applies except a prior human confirmation).

## Global Constraints

- **JavaScript, not TypeScript.** JSDoc only. No new runtime dependencies.
- **`npm test` starts at 372 passing** and must pass at the end of every task. `npm run lint` clean — two pre-existing warnings in `Flap.jsx` and `useAuth.js` are expected and not yours to fix.
- **Pure module.** `src/match/` must not import anything performing network I/O, touching storage, or importing React.
- **Reuse, do not fork.** Title folding and fuzzy scoring come from `src/csv/match.js` (`matchText`, `diceCoefficient`). Two implementations of "is this the same title" would drift apart, and one of them would be wrong.
- **Nothing here applies anything.** This module returns proposals. A human confirms them (D15).
- **Commit after every task**, with the message the task gives.

## Why this is the hard part

Within one service a URI match is a fact. Across services there is **no shared identifier at all** — `ytmusicapi` returns no ISRC, so there is not even the weak tier the CSV matcher enjoys. Matching rests on title, artist and duration, and **duration is the only one that is hard to fake**: a cover, a live cut and a remix all share a title and often an artist, and differ in length.

## Decisions this plan makes

| | Decision | Why |
|---|---|---|
| M1 | **A pair needs BOTH a title agreement and an artist agreement.** Duration only decides Strong vs Likely | §7 lists fuzzy title / any-artist / duration drift as the things that *degrade* a match from Strong. Read as alternatives, a shared title alone would propose "Antidote" by two different artists. The conservative reading is the one where a wrong match is rare |
| M2 | **Over 5s apart is never proposed at all** | That gap usually means a live cut, an extended mix or a cover — the match you least want, and the one a title comparison is most likely to make |
| M3 | **`videoType` breaks ties, it never promotes or rejects** | `ATV` is an album track and `OMV` a music video, so the audio track wins a tie. But a legitimate match is sometimes only available as a video, so it must never be a reason to reject |
| M4 | **The match book is injected as `verdictFor(spotifyId, youtubeId)`** | Keeps this module pure and testable, and lets the storage plan land separately |
| M5 | **A YouTube title is also compared by its leading segment** — the part before the first ` (`, ` \|`, ` [`, ` - ` or ` : ` | Measured, not assumed: 72 of 384 real titles carry trailing noise like `INTO YOU (OFFICIAL VIDEO) \| TEGI PANNU \| MANNI SANDHU \| LATEST PUNJABI SONGS 2025`. Dice scores that at **0.48** against `Into You` — nowhere near the 0.9 floor — so without this rule a fifth of the library reports as unmatched |
| M6 | **The segment is only cut when the tail is decoration, never when it names a variant** | `Gal Dil Di (Duet Version 1)` is a different recording from `Gal Dil Di`. This is the same judgement `matchText` already makes by dropping `(feat. X)` while keeping `(Live)` and `(Remix)` — applied consistently rather than invented here |

## Measured facts

From the real libraries on 2026-09-24:

| | |
|---|---|
| YouTube playlist | 383 readable tracks |
| Spotify counterpart | ~418 tracks |
| `videoType` spread | `ATV` 224, `OMV` 132, `UGC` 10, untyped 13 |
| `album` present | 232 of 383 — so album is useless as a matching signal |
| ISRC on YouTube | none, ever |
| Titles carrying trailing noise | 72 of 384 (19%) — pipes, parenthesised tags, ALL-CAPS credits, trailing years |
| Titles with no noise at all | 289 of 384 (75%) |
| Leading-segment extraction, run over all 72 | 0 produced an empty result; the shortest (`C4`, `Magic`, `Snap`) are genuine titles |

### Why the noise matters more than a missed match

An unmatched Spotify track does not simply go unpaired — in deliverable 2c it
goes to the **fill** path and gets searched for and added. So a title the
matcher fails to recognise becomes a **duplicate of a track already in the
playlist**. That is the real cost of a fifth of the library folding wrong, and
it is why M5 exists.

---

## Task 1: Carry `videoType` on the YouTube Track

It was deliberately left off during the read path because nothing consumed it. M3 consumes it now.

**Files:**
- Modify: `src/services/youtube/track.js`
- Modify: `src/model/track.js` — Spotify must carry the same key
- Test: `src/services/youtube/track.test.js`, `src/model/track.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: every Track carries `videoType` — the raw string for YouTube (`'MUSIC_VIDEO_TYPE_ATV'`, `'MUSIC_VIDEO_TYPE_OMV'`, `'MUSIC_VIDEO_TYPE_UGC'`, or `null`), and always `null` for Spotify.

- [ ] **Step 1: Write the failing tests**

Add to `src/services/youtube/track.test.js`:

```js
test('carries videoType so the matcher can prefer an album track', () => {
  const [album] = normalizeYouTubeTracks([ALBUM_TRACK])
  const [video] = normalizeYouTubeTracks([MUSIC_VIDEO])
  expect(album.videoType).toBe('MUSIC_VIDEO_TYPE_ATV')
  expect(video.videoType).toBe('MUSIC_VIDEO_TYPE_OMV')
})

test('videoType is null when YouTube does not say', () => {
  // Measured: 13 of 383 real rows carry no videoType.
  expect(normalizeYouTubeTracks([UNTYPED])[0].videoType).toBeNull()
})
```

Add to `src/model/track.test.js`:

```js
test('Spotify tracks carry a null videoType', () => {
  // The key exists on both sides so the matcher never reads undefined.
  const [track] = makeTracks([{ name: 'a' }])
  expect(track.videoType).toBeNull()
})
```

- [ ] **Step 2: Run them and verify they fail**

```bash
npx vitest run src/services/youtube/track.test.js src/model/track.test.js -t videoType
```

Expected: FAIL — `videoType` is `undefined` on both.

- [ ] **Step 3: Add the field to both normalizers**

In `src/services/youtube/track.js`, in the object pushed into `tracks`, immediately after `itemId: raw.setVideoId,`:

```js
      // ATV is an album audio track, OMV an official music video, UGC a user
      // upload. The matcher uses it only to break a tie (M3).
      videoType: raw.videoType ?? null,
```

In `src/model/track.js`, in the returned object immediately after `itemId: null,`:

```js
    // Spotify has no equivalent. Present so the matcher never reads undefined.
    videoType: null,
```

- [ ] **Step 4: Run the suite**

```bash
npm test && npm run lint
```

Expected: `375 passed` (372 + 3), lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/services/youtube/track.js src/model/track.js src/services/youtube/track.test.js src/model/track.test.js
git commit -m "Carry videoType on every Track"
```

---

## Task 2: Score one candidate pair

**Files:**
- Create: `src/match/scorePair.js`
- Test: `src/match/scorePair.test.js`

**Interfaces:**
- Consumes: `matchText`, `diceCoefficient` from `../csv/match.js`
- Produces: `scorePair(spotifyTrack, youtubeTrack)` → `null` when the pair must not be proposed at all, otherwise:

```js
{
  tier: 'strong' | 'likely',
  durationDeltaMs: number,   // youtube minus spotify; signed, so the UI can show +2s
  reason: string,            // why it is not Strong, or that it is
}
```

  Also exports the thresholds so tests and the UI quote one source: `STRONG_DRIFT_MS` (2000), `MAX_DRIFT_MS` (5000), `FUZZY_FLOOR` (0.9).

- [ ] **Step 1: Write the failing test**

Create `src/match/scorePair.test.js`:

```js
import { describe, expect, test } from 'vitest'
import { MAX_DRIFT_MS, STRONG_DRIFT_MS, scorePair } from './scorePair.js'

const track = (over = {}) => ({
  name: 'Antidote',
  artists: [{ id: 'a1', name: 'Karan Aujla' }],
  primaryArtist: { id: 'a1', name: 'Karan Aujla' },
  durationMs: 188000,
  videoType: null,
  ...over,
})

describe('scorePair', () => {
  test('exact title and artist within 2s is strong', () => {
    const result = scorePair(track(), track({ durationMs: 189000 }))
    expect(result.tier).toBe('strong')
    expect(result.durationDeltaMs).toBe(1000)
  })

  test('the delta is signed, youtube minus spotify', () => {
    expect(scorePair(track(), track({ durationMs: 186000 })).durationDeltaMs).toBe(-2000)
  })

  test('exactly 2s apart is still strong; 2001ms is not', () => {
    expect(scorePair(track(), track({ durationMs: 188000 + STRONG_DRIFT_MS })).tier).toBe('strong')
    expect(scorePair(track(), track({ durationMs: 188000 + STRONG_DRIFT_MS + 1 })).tier).toBe('likely')
  })

  test('exactly 5s apart is likely; 5001ms is not proposed at all', () => {
    expect(scorePair(track(), track({ durationMs: 188000 + MAX_DRIFT_MS })).tier).toBe('likely')
    expect(scorePair(track(), track({ durationMs: 188000 + MAX_DRIFT_MS + 1 }))).toBeNull()
  })

  test('trailing decoration is cut, so the pair is still strong', () => {
    // Measured: 'antidote official video' scores 0.483 against 'antidote' —
    // nowhere near the fuzzy floor. Without M5 this pair is lost entirely.
    const result = scorePair(track(), track({ name: 'Antidote (Official Video)' }))
    expect(result.tier).toBe('strong')
  })

  test('a real-world YouTube title with piped credits still matches', () => {
    // Taken verbatim from the live library.
    const spotify = track({ name: 'Into You' })
    const youtube = track({
      name: 'INTO YOU (OFFICIAL VIDEO) | TEGI PANNU | MANNI SANDHU | ROHIT NEGAH | LATEST PUNJABI SONGS 2025',
    })
    expect(scorePair(spotify, youtube).tier).toBe('strong')
  })

  test('a tail that names a VARIANT is not cut', () => {
    // M6: a duet version is a different recording, so this must not be
    // silently folded into the original the way decoration is.
    const result = scorePair(track({ name: 'Gal Dil Di' }), track({ name: 'Gal Dil Di (Duet Version 1)' }))
    expect(result).toBeNull()
  })

  test('a genuine spelling variant is likely', () => {
    // Measured: dice 0.947. This is what the fuzzy tier is actually for.
    const result = scorePair(track({ name: 'Saade Pind' }), track({ name: 'Saade Pindd' }))
    expect(result.tier).toBe('likely')
  })

  test('the same title by a different artist is NOT proposed', () => {
    // M1: a shared title alone is not evidence. This is the match that would
    // look right and be wrong.
    expect(scorePair(track(), track({
      artists: [{ id: 'b', name: 'Someone Else' }],
      primaryArtist: { id: 'b', name: 'Someone Else' },
    }))).toBeNull()
  })

  test('a featured artist on one side counts as an artist agreement', () => {
    const spotify = track({
      artists: [{ id: 'a1', name: 'Karan Aujla' }, { id: 'a2', name: 'Mxrci' }],
    })
    const youtube = track({
      artists: [{ id: 'a2', name: 'Mxrci' }],
      primaryArtist: { id: 'a2', name: 'Mxrci' },
    })
    expect(scorePair(spotify, youtube).tier).toBe('likely')
  })

  test('a live version is not proposed, because it runs long', () => {
    // The case the whole duration rule exists for.
    expect(scorePair(track(), track({ name: 'Antidote (Live)', durationMs: 215000 }))).toBeNull()
  })

  test('a different title by the same artist is not proposed', () => {
    expect(scorePair(track(), track({ name: 'Winning Speech' }))).toBeNull()
  })

  test('an empty title never matches another empty title', () => {
    expect(scorePair(track({ name: '' }), track({ name: '' }))).toBeNull()
  })

  test('a missing duration on either side is not proposed', () => {
    // Duration is the only hard discriminator; without it there is no evidence.
    expect(scorePair(track({ durationMs: 0 }), track())).toBeNull()
  })

  test('the reason says why it is not strong', () => {
    expect(scorePair(track(), track({ durationMs: 192000 })).reason).toMatch(/4s|duration/i)
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

```bash
npx vitest run src/match/scorePair.test.js
```

Expected: FAIL — cannot resolve `./scorePair.js`.

- [ ] **Step 3: Write the scorer**

Create `src/match/scorePair.js`:

```js
/**
 * Judges whether one Spotify track and one YouTube track are the same track.
 *
 * Pure module: no network, no storage, no React.
 *
 * There is no shared identifier between the services — ytmusicapi returns no
 * ISRC — so this rests on title, artist and duration. Duration is the only
 * one that is hard to fake: a cover, a live cut and a remix all share a title
 * and often an artist, and differ in length.
 *
 * See docs/2026-09-18-youtube-mirror-design.md §7.
 */

import { diceCoefficient, matchText } from '../csv/match.js'

/** Within this, an exact title and artist is as good as it gets. */
export const STRONG_DRIFT_MS = 2000

/** Beyond this, nothing is proposed at any confidence (M2). */
export const MAX_DRIFT_MS = 5000

/** Dice coefficient on character bigrams, as the CSV matcher uses. */
export const FUZZY_FLOOR = 0.9

/**
 * Tails that name a DIFFERENT RECORDING rather than decoration (M6).
 *
 * The same judgement matchText already makes by dropping `(feat. X)` while
 * keeping `(Live)` and `(Remix)`: a duet version of a song is not that song.
 *
 * Both word boundaries are deliberate, and measured. Across 72 real tails the
 * only inflected form of any of these words is "MixSingh" — a producer's
 * name. A trailing-boundary-free pattern would read that as a variant and
 * refuse to cut a title that is only wearing credits.
 */
const VARIANT_TAIL =
  /\b(live|remix|version|acoustic|unplugged|slowed|reverb|cover|instrumental|duet|mix|edit|reprise|demo)\b/i

/** Where YouTube starts appending credits, tags and release years. */
const TAIL_START = /\s[|(\[]|\s[-–—:]\s/

/**
 * The part of a YouTube title before its trailing credits, or null when there
 * is no tail or the tail names a variant.
 *
 * Measured against the live library: 72 of 384 titles carry such a tail, and
 * the folded full title scores as low as 0.48 against the clean Spotify one —
 * so without this, a fifth of the playlist reports as unmatched, and in 2c
 * every one of those would be "filled" as a duplicate of a track already
 * present.
 */
export function leadingSegment(title) {
  const text = String(title ?? '')
  const cut = text.search(TAIL_START)
  if (cut === -1) return null
  if (VARIANT_TAIL.test(text.slice(cut))) return null
  return text.slice(0, cut).trim() || null
}

/** Album audio beats a music video beats a user upload, on a tie only (M3). */
const VIDEO_TYPE_RANK = {
  MUSIC_VIDEO_TYPE_ATV: 3,
  MUSIC_VIDEO_TYPE_OMV: 2,
  MUSIC_VIDEO_TYPE_UGC: 1,
}

/** How much a track's own kind is worth when two candidates otherwise tie. */
export function videoTypeRank(track) {
  return VIDEO_TYPE_RANK[track?.videoType] ?? 0
}

function foldedNames(track) {
  return (track?.artists ?? [])
    .map((artist) => matchText(artist?.name))
    .filter(Boolean)
}

/** Any credited artist in common, folded. */
function sharesAnArtist(spotify, youtube) {
  const theirs = new Set(foldedNames(youtube))
  return foldedNames(spotify).some((name) => theirs.has(name))
}

/**
 * @returns {{tier: string, durationDeltaMs: number, reason: string}|null}
 *   null means "do not propose this pair at all"
 */
export function scorePair(spotify, youtube) {
  const spotifyMs = spotify?.durationMs ?? 0
  const youtubeMs = youtube?.durationMs ?? 0
  // No duration on either side leaves nothing but title and artist, which is
  // exactly the evidence a cover or a live cut also satisfies.
  if (spotifyMs <= 0 || youtubeMs <= 0) return null

  const durationDeltaMs = youtubeMs - spotifyMs
  const drift = Math.abs(durationDeltaMs)
  if (drift > MAX_DRIFT_MS) return null

  const spotifyTitle = matchText(spotify?.name)
  const youtubeTitle = matchText(youtube?.name)
  if (!spotifyTitle || !youtubeTitle) return null

  const titleExact = spotifyTitle === youtubeTitle
  // M5: the same title wearing YouTube's credits is still the same title.
  const leadFolded = matchText(leadingSegment(youtube?.name))
  const titleViaLead = !titleExact && leadFolded !== '' && spotifyTitle === leadFolded
  const titleClose =
    titleExact || titleViaLead || diceCoefficient(spotifyTitle, youtubeTitle) >= FUZZY_FLOOR
  if (!titleClose) return null

  const primaryExact =
    matchText(spotify?.primaryArtist?.name) !== '' &&
    matchText(spotify?.primaryArtist?.name) === matchText(youtube?.primaryArtist?.name)

  // M1: a title agreement alone is not evidence. Two different songs share a
  // title far more often than the same song changes its artist.
  if (!primaryExact && !sharesAnArtist(spotify, youtube)) return null

  // Cutting decoration loses nothing, so a lead match is as good as an exact
  // one — the artist and the duration still have to agree (M5, M6).
  if ((titleExact || titleViaLead) && primaryExact && drift <= STRONG_DRIFT_MS) {
    return {
      tier: 'strong',
      durationDeltaMs,
      reason: titleExact
        ? 'Title and artist match exactly'
        : 'Title and artist match once YouTube’s credits are set aside',
    }
  }

  const why = []
  if (!titleExact && !titleViaLead) why.push('the titles differ slightly')
  if (!primaryExact) why.push('a different artist is credited first')
  if (drift > STRONG_DRIFT_MS) why.push(`the durations differ by ${Math.round(drift / 1000)}s`)

  return { tier: 'likely', durationDeltaMs, reason: capitalize(why.join(', ')) }
}

function capitalize(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text
}
```

- [ ] **Step 4: Run the suite**

```bash
npm test && npm run lint
```

Expected: `390 passed` (375 + 15), lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/match/
git commit -m "Score whether two tracks across services are the same track"
```

---

## Task 3: Pair two whole playlists

**Files:**
- Create: `src/match/pairTracks.js`
- Test: `src/match/pairTracks.test.js`

**Interfaces:**
- Consumes: `scorePair`, `videoTypeRank` from `./scorePair.js`
- Produces: `pairTracks(spotifyTracks, youtubeTracks, { verdictFor } = {})` →

```js
{
  pairs: [{ spotify, youtube, tier, durationDeltaMs, reason }],
  unmatchedSpotify: [...],   // need searching for, in a later deliverable
  unmatchedYoutube: [...],   // extras that will sink to the bottom
  counts: { certain, strong, likely, unmatchedSpotify, unmatchedYoutube },
}
```

  `verdictFor(spotifyId, youtubeVideoId)` is optional and returns `'same'`, `'different'`, or `null`/undefined. `'same'` yields tier `'certain'`; `'different'` suppresses that pair entirely so a dismissed pair is never re-proposed.

- [ ] **Step 1: Write the failing test**

Create `src/match/pairTracks.test.js`:

```js
import { describe, expect, test } from 'vitest'
import { pairTracks } from './pairTracks.js'

const sp = (id, name, artist, durationMs) => ({
  id, name, durationMs, videoType: null,
  artists: [{ id: artist, name: artist }],
  primaryArtist: { id: artist, name: artist },
})

const yt = (id, name, artist, durationMs, videoType = null) => ({
  ...sp(id, name, artist, durationMs), videoType,
})

describe('pairTracks', () => {
  test('pairs the obvious ones and reports the rest', () => {
    const result = pairTracks(
      [sp('s1', 'Antidote', 'Karan Aujla', 188000), sp('s2', 'Only Spotify', 'X', 100000)],
      [yt('y1', 'Antidote', 'Karan Aujla', 188000), yt('y2', 'Only YouTube', 'Z', 120000)],
    )
    expect(result.pairs).toHaveLength(1)
    expect(result.pairs[0].tier).toBe('strong')
    expect(result.unmatchedSpotify.map((t) => t.id)).toEqual(['s2'])
    expect(result.unmatchedYoutube.map((t) => t.id)).toEqual(['y2'])
  })

  test('one YouTube track cannot be claimed by two Spotify tracks', () => {
    // Greedy from a pool, exactly as the CSV matcher pairs duplicates.
    const result = pairTracks(
      [sp('s1', 'Antidote', 'Karan Aujla', 188000), sp('s2', 'Antidote', 'Karan Aujla', 188000)],
      [yt('y1', 'Antidote', 'Karan Aujla', 188000)],
    )
    expect(result.pairs).toHaveLength(1)
    expect(result.unmatchedSpotify).toHaveLength(1)
  })

  test('a strong match wins a contested track over a likely one', () => {
    // s2 is exact; s1 only drifts into range. Order must not decide it.
    const result = pairTracks(
      [sp('s1', 'Antidote', 'Karan Aujla', 192000), sp('s2', 'Antidote', 'Karan Aujla', 188000)],
      [yt('y1', 'Antidote', 'Karan Aujla', 188000)],
    )
    expect(result.pairs[0].spotify.id).toBe('s2')
    expect(result.pairs[0].tier).toBe('strong')
  })

  test('an album track beats a music video on an otherwise equal tie', () => {
    const result = pairTracks(
      [sp('s1', 'Antidote', 'Karan Aujla', 188000)],
      [
        yt('video', 'Antidote', 'Karan Aujla', 188000, 'MUSIC_VIDEO_TYPE_OMV'),
        yt('audio', 'Antidote', 'Karan Aujla', 188000, 'MUSIC_VIDEO_TYPE_ATV'),
      ],
    )
    expect(result.pairs[0].youtube.id).toBe('audio')
  })

  test('a confirmed pair is certain, whatever the tiers would have said', () => {
    const result = pairTracks(
      [sp('s1', 'Antidote', 'Karan Aujla', 188000)],
      [yt('y1', 'Completely Different', 'Nobody', 300000)],
      { verdictFor: () => 'same' },
    )
    expect(result.pairs[0].tier).toBe('certain')
  })

  test('a rejected pair is never proposed again', () => {
    // D16: without this, a pair you dismissed comes back every sync forever.
    const result = pairTracks(
      [sp('s1', 'Antidote', 'Karan Aujla', 188000)],
      [yt('y1', 'Antidote', 'Karan Aujla', 188000)],
      { verdictFor: () => 'different' },
    )
    expect(result.pairs).toHaveLength(0)
    expect(result.unmatchedSpotify).toHaveLength(1)
    expect(result.unmatchedYoutube).toHaveLength(1)
  })

  test('counts add up to the inputs', () => {
    const spotify = [sp('s1', 'A', 'X', 100000), sp('s2', 'B', 'Y', 100000)]
    const youtube = [yt('y1', 'A', 'X', 100000), yt('y2', 'C', 'Z', 100000)]
    const result = pairTracks(spotify, youtube)
    const { counts } = result
    const paired = counts.certain + counts.strong + counts.likely
    expect(paired + counts.unmatchedSpotify).toBe(spotify.length)
    expect(paired + counts.unmatchedYoutube).toBe(youtube.length)
  })

  test('empty inputs produce empty output rather than throwing', () => {
    expect(pairTracks([], []).pairs).toEqual([])
    expect(pairTracks(null, null).counts.certain).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

```bash
npx vitest run src/match/pairTracks.test.js
```

Expected: FAIL — cannot resolve `./pairTracks.js`.

- [ ] **Step 3: Write the pairer**

Create `src/match/pairTracks.js`:

```js
/**
 * Pairs a Spotify playlist against a YouTube playlist.
 *
 * Pure module: no network, no storage, no React. The match book is injected
 * as `verdictFor` so this never learns where a verdict is kept (M4).
 *
 * Every pair this returns is a PROPOSAL. Only a verdict of 'same' — a human
 * having already confirmed that exact pair — comes back as certain (D15).
 */

import { scorePair, videoTypeRank } from './scorePair.js'

const TIER_RANK = { certain: 3, strong: 2, likely: 1 }

/**
 * @param {Array} spotifyTracks
 * @param {Array} youtubeTracks
 * @param {{verdictFor?: (spotifyId: string, youtubeVideoId: string) => string|null}} [options]
 */
export function pairTracks(spotifyTracks, youtubeTracks, { verdictFor } = {}) {
  const spotify = spotifyTracks ?? []
  const youtube = youtubeTracks ?? []

  // Every candidate, scored once, then sorted so the best claim is settled
  // first. Doing it in input order would let a weak early pair take a track
  // a strong later pair needed.
  const candidates = []
  for (const left of spotify) {
    for (const right of youtube) {
      const verdict = verdictFor?.(left?.id, right?.id) ?? null
      // A dismissed pair is gone for good, not re-proposed every sync (D16).
      if (verdict === 'different') continue

      if (verdict === 'same') {
        candidates.push({
          spotify: left,
          youtube: right,
          tier: 'certain',
          durationDeltaMs: (right?.durationMs ?? 0) - (left?.durationMs ?? 0),
          reason: 'You confirmed this pair before',
        })
        continue
      }

      const scored = scorePair(left, right)
      if (scored) candidates.push({ spotify: left, youtube: right, ...scored })
    }
  }

  candidates.sort((a, b) => {
    const byTier = TIER_RANK[b.tier] - TIER_RANK[a.tier]
    if (byTier !== 0) return byTier
    const byDrift = Math.abs(a.durationDeltaMs) - Math.abs(b.durationDeltaMs)
    if (byDrift !== 0) return byDrift
    // M3: only ever a tie-break, never a reason to promote or reject.
    return videoTypeRank(b.youtube) - videoTypeRank(a.youtube)
  })

  const pairs = []
  const claimedSpotify = new Set()
  const claimedYoutube = new Set()
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
```

Note the claim sets hold the track **objects**, not ids: a playlist may hold the same track id twice, and each copy must be claimable separately.

- [ ] **Step 4: Run the suite**

```bash
npm test && npm run lint
```

Expected: `398 passed` (390 + 8), lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/match/
git commit -m "Pair a Spotify playlist against a YouTube playlist"
```

---

## Done when

- `npm test` reports 398 passing and `npm run lint` is clean
- `grep -rn "fetch\|localStorage\|react" src/match/` finds nothing
- Every pair carries a tier, a signed duration delta, and a reason a person can read

## Not in this plan

| | Why not here |
|---|---|
| The match book's storage | Next plan. Injected here as `verdictFor`, so this stays pure |
| Searching YouTube for unmatched Spotify tracks | Needs a proxy endpoint; its own plan |
| The confirmation surface | The UI plan, and the one that needs a manual gate |
| Any write | Deliverable 2c |
| **Tuning the thresholds** | 2s / 5s / 0.9 are reasoned, not measured. The moment this module exists, run it against the real 383-vs-418 libraries and look at the tier histogram before building a UI on top of it |
