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

## Tests

```bash
python -m pytest
```
