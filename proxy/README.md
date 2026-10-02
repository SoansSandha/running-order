# YouTube Music proxy

YouTube Music sends no CORS headers, so a browser cannot call it. This process
makes those calls and holds the credentials, so the browser never sees them.

It holds no business logic — auth and transport only.

## Setup

```bash
python -m pip install -r requirements.txt
```

Then produce credentials, from a directory **outside this repo**:

```bash
ytmusicapi browser
```

Copy the resulting `browser.json` into this directory. It is gitignored, and
it carries session cookies — treat it like a password.

## Running

From the repository root, `npm start` runs this alongside the app. To run it
alone:

```bash
npm run dev:proxy
```

or directly, from this directory:

```bash
python -m uvicorn app:app --host 127.0.0.1 --port 8787
```

If it fails to start, the app keeps working — Spotify sorting does not depend
on this process. Only the YouTube features go quiet.

`GET /auth/status` answers `{"authenticated": true}` once credentials load.
`POST /auth/status` makes one real call to YouTube, which is the only way to
tell a live session from an expired one.

## When the session expires

The app says "Your YouTube Music session has expired" when YouTube stops
accepting the stored session. The usual cause: YouTube rotates the cookies of
any session that stays open in a browser tab, so headers copied from the
browser you use every day go stale within days (measured: 6 days, then 1).

Capture from a session nothing else will touch:

1. Open a **new private window** and sign in to music.youtube.com there.
2. Open devtools → Network, filter `browse`, click around until a `browse`
   request appears, and copy its request headers (Firefox: toggle **Raw**).
3. Run `ytmusicapi browser` from a directory outside this repo, paste, then
   Ctrl+Z and Enter.
4. **Close the private window.** Do not sign out first, and do not open that
   session again — signing out kills it outright.
5. Copy the new `browser.json` over the old one here, and reload the app.

No restart is needed: the proxy drops a session that fails and reads the file
afresh on the next request. Using YouTube Music normally in your everyday
browser is fine; that is a separate session.

If `ytmusicapi` is not found, pip installed it into a Scripts folder that is
not on PATH — Microsoft Store Python does this. Add
`%LOCALAPPDATA%\Packages\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0\LocalCache\local-packages\Python313\Scripts`
to the user PATH. `python -m ytmusicapi` does not work: the package has no
`__main__`.

## Tests

```bash
python -m pytest
```
