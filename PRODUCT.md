# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One user at a time: someone managing their own music library from their own
machine, running their own copy. The source is public, so a stranger may
clone and self-host it, but there is no hosted service, no sign-up, and no
multi-tenancy — each person supplies their own API credentials and their own
browser holds their own tokens.

The job is deliberate library maintenance rather than listening. The user sits
down having decided a playlist's order is wrong, picks how it should be
ordered instead, and wants that applied exactly — then goes back to listening.
Sessions are occasional and purposeful, not habitual.

Used on desktop and phone equally. Neither is the fallback case.

## Product Purpose

Rewrite the track order of a playlist, either in place or into a cloned copy,
using a chosen sort strategy or an uploaded CSV. Spotify is supported today;
YouTube Music is planned, along with reconciling the same playlist across both
services.

Spotify itself offers no persistent reordering: its own sort views are
display-only, and its shuffle cannot be captured. The only way to impose a
lasting order is to move tracks by hand, one at a time. This product makes
that a single deliberate action.

Success is a playlist that comes out in exactly the intended order, with
nothing lost, and with the user having seen what would happen before it
happened.

## Positioning

Two mechanisms a neighbouring tool could not truthfully claim:

- **It preserves `added_at`.** The obvious way to write a new order is to
  replace the playlist's contents wholesale, which resets every track's
  added-date to now and permanently destroys the data a date-added sort reads.
  This product moves tracks instead, so a playlist can be re-sorted any number
  of times without degrading.
- **It moves only what must move.** A longest-increasing-subsequence pass
  leaves already-correct tracks untouched, so re-sorting after adding five
  songs costs about five operations rather than several hundred.

## Operating Context

- The user supplies their own Spotify **Client ID** on first use; the app
  performs an OAuth PKCE redirect. There is no server and no client secret.
- The Spotify app stays in **Development Mode**, which is sufficient because
  there is only one user.
- Playlists currently run to roughly **400 tracks** and are expected to grow.
- A sort is always four stages: fetch, build a plan, preview, execute. The
  preview is not optional — an applied reorder is slow to undo by hand, so the
  user sees the diff before anything is written.
- CSVs arrive from external exporters (Exportify being the common one) and
  have unpredictable headers, so column mapping must always be correctable by
  hand.

## Capabilities and Constraints

Confirmed functionality:

- List the user's playlists, distinguishing editable from clone-only.
- Nine sort strategies, including an artist-grouped sort with a choice of
  ordering inside each artist's block.
- Sort in place, or clone and sort the copy.
- Reorder to match an uploaded CSV.
- Preview every change before writing; undo after writing.

Platform constraints that bound the product:

- **No audio-feature sorting.** Spotify withdrew tempo, energy, danceability,
  key and valence for new apps in Nov 2024. These are the variants users most
  expect, so the interface must not imply they exist.
- **Writes are sequential.** Each reorder returns a snapshot id the next call
  must quote, so a large reorder takes real time and needs visible progress.
- **`localhost` is rejected** in redirect URIs; development uses the loopback
  literal `http://127.0.0.1:5173/` and any deployment must be HTTPS.
- **Refresh tokens rotate** on every use.
- Liked Songs is not a reorderable list and is out of scope.
- Playlist cover art is not copied when cloning.

Product facts that stay true regardless of implementation:

- A reorder is a **permutation**. Track count cannot change, which is why a
  collaboration files under one artist rather than appearing under both.
- **CSV reorders only** — it never adds or removes tracks. Rows that do not
  match are reported, not acted on.
- Local files and unavailable tracks can be reordered in place but cannot be
  cloned, so a clone may legitimately be shorter than its source. This is
  stated before the clone, never discovered after.

## Evidence on Hand

- Full design record at `docs/2026-09-09-design.md`,
  including the decision log D1–D9 and the alternatives considered.
- Build and test status at `docs/STATUS.md`.
- Test fixtures at `src/test/factory.js` build synthetic playlists through the
  real normalizer.

Absences that must not be papered over: no Spotify credentials have been used
yet, so nothing has run against the live API. There are no real playlist
captures, no screenshots, and no performance measurements. Any figure about
real-world timing or playlist content would be invented.

## Planned, not built

Recorded so the shape of the work is clear, and so nothing here is mistaken
for something that exists.

- **YouTube Music as a second source**, with the same sort strategies. The
  pure layers (`sort/`, `plan/`, `csv/`) are already service-agnostic — they
  operate on a normalized Track, not on anything Spotify-shaped.
- **Cross-service reconciliation.** Pick the same playlist on both services
  and see what each is missing, then sync in either direction.
- **Confirmation before any cross-service write.** Matching songs across
  services is guesswork in a way that matching within one service is not, so
  every proposed pair carries a link to play on each side, is confirmed one
  at a time, and offers a confirm-all for when the list is obviously right.
  Nothing crosses services unconfirmed.

## Product Principles

1. **Show the change before making it.** Every write is preceded by a preview
   the user can read and reject. Nothing is applied because it was requested —
   it is applied because it was confirmed.
2. **Never lose a track.** A sort is a permutation. Anything that cannot be
   carried over — a local file into a clone, an unavailable track — is
   reported explicitly rather than silently dropped.
3. **Preserve the data future sorts depend on.** Convenience that degrades
   `added_at` is not convenience; it forecloses the next sort.
4. **Be honest about what the platform cannot do.** Missing capabilities are
   stated plainly rather than hidden behind a control that quietly fails.
5. **Slow is acceptable; surprising is not.** A two-minute reorder with
   visible progress and a working cancel beats an instant one that loses
   metadata.
6. **A guess is never applied as a fact.** Within one service, an identifier
   match is certain and can be acted on. Across services there is no shared
   identifier, so a match is a proposal until a person confirms it.
