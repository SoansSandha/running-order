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

```bash
uvicorn app:app --host 127.0.0.1 --port 8787
```

`GET /auth/status` answers `{"authenticated": true}` once credentials load.

## Tests

```bash
python -m pytest
```
