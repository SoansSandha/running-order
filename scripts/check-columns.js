// The layout check (docs/2026-10-10-match-tray-design.md §10): opens every
// screen in demo mode at six widths and reports any element that runs past
// its column or its row. It must report {}.
//
// With the dev server running (`npm run dev:web`; if 127.0.0.1 does not answer,
// `npx vite --host 127.0.0.1 --port 5173`), from the repo root:
//   playwright-cli -s=columns open about:blank
//   playwright-cli -s=columns --raw run-code --filename=scripts/check-columns.js
//   playwright-cli -s=columns close
//
// It uses no one's library: the match review is fed synthetic long titles and
// artists through a mocked proxy, and every request that would leave the
// machine (Spotify, YouTube's and Spotify's players) is answered locally.
async (page) => {
  const BASE = 'http://127.0.0.1:5173'
  const WIDTHS = [1440, 1280, 1024, 860, 680, 390]
  const LONG = 'An Extraordinarily Long Song Title That Keeps Going (Official Music Video) | Feat. Many Guests | 2026'
  const LONG_ARTISTS = ['A Very Long Artist Name', 'Another Rather Long Artist Name', 'A Third Featured Artist']

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${BASE}/?demo=1`)
  await page.evaluate(() => document.fonts.ready)
  const demo = await page.evaluate(async () => {
    const module = await import('/src/ui/demoData.js')
    return module
      .loadDemo()
      .tracks.filter((track) => track.id)
      .map((track) => ({ id: track.id, name: track.name, artist: track.primaryArtist.name, seconds: Math.round(track.durationMs / 1000) }))
  })

  const raw = (videoId, title, artists, seconds, videoType = 'MUSIC_VIDEO_TYPE_ATV') => ({
    videoId,
    setVideoId: `set-${videoId}`,
    title,
    artists: artists.map((name) => ({ name, id: null })),
    album: videoType === 'MUSIC_VIDEO_TYPE_ATV' ? { name: 'An Album', id: null } : null,
    duration_seconds: seconds,
    videoType,
  })
  const longRaw = (videoId) => raw(videoId, `${LONG} ${videoId}`, LONG_ARTISTS, 241, 'MUSIC_VIDEO_TYPE_OMV')
  // Four exact twins (strong), two 4s off (likely), six long unmatched rows.
  const library = [
    ...demo.slice(0, 4).map((track, index) => raw(`strong${index}0000`.slice(0, 11), track.name, [track.artist], track.seconds)),
    ...demo.slice(4, 6).map((track, index) => raw(`likely${index}0000`.slice(0, 11), track.name, [track.artist], track.seconds + 4)),
    ...Array.from({ length: 6 }, (_, index) => longRaw(`longvid${index}000`.slice(0, 11))),
  ]
  // Songs the sweep finds in the catalogue: the next four demo tracks.
  const catalogue = new Map(demo.slice(6, 10).map((track, index) => [`${track.name} ${track.artist}`, raw(`found${index}00000`.slice(0, 11), track.name, [track.artist], track.seconds)]))
  const spotifyLong = (id) => ({
    id,
    uri: `spotify:track:${id}`,
    type: 'track',
    name: `${LONG} ${id}`,
    duration_ms: 241000,
    artists: LONG_ARTISTS.map((name) => ({ id: name, name })),
    album: { id: 'al', name: 'An Album', release_date: '2026-01-01', release_date_precision: 'day' },
  })

  await page.route('http://127.0.0.1:8787/**', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/playlists') {
      return route.fulfill({ json: { playlists: [{ id: 'PLT', title: 'test punjabi songs', count: library.length }] } })
    }
    if (url.pathname.startsWith('/playlists/')) {
      return route.fulfill({ json: { id: 'PLT', title: 'test punjabi songs', counted: library.length, readable: library.length, tracks: library } })
    }
    if (url.pathname === '/search') {
      const found = catalogue.get(url.searchParams.get('q'))
      return route.fulfill({ json: { results: found ? [found] : [longRaw('nearmiss000'), longRaw('nearmiss001')] } })
    }
    if (url.pathname.startsWith('/track/')) return route.fulfill({ json: { track: longRaw('pasted00000') } })
    return route.fulfill({ json: { authenticated: true } })
  })
  await page.route('https://api.spotify.com/**', (route) =>
    route.fulfill({ json: route.request().url().includes('/search') ? { tracks: { items: [spotifyLong('spotifyLong01234567890')] } } : spotifyLong('spotifyLong01234567890') }),
  )
  for (const host of ['https://open.spotify.com/**', 'https://www.youtube-nocookie.com/**']) {
    await page.route(host, (route) => route.fulfill({ contentType: 'text/html', body: '<html></html>' }))
  }

  // Every Spotify song's match-book key: its id, or a local file's URI.
  const spotifyKeys = await page.evaluate(async () => {
    const module = await import('/src/ui/demoData.js')
    return module.loadDemo().tracks.map((track) => track.id ?? track.uri).filter(Boolean)
  })
  // The review pass: one settled pair, and one song marked on each side.
  const reviewBook = [
    { spotifyKey: demo[0].id, youtubeVideoId: 'strong00000', verdict: 'same', decidedAt: 1 },
    { spotifyKey: demo[12].id, youtubeVideoId: null, verdict: 'none', decidedAt: 1 },
    { spotifyKey: null, youtubeVideoId: 'longvid5000', verdict: 'none', decidedAt: 1 },
  ]
  // The review-ready pass (mirror run design §7): every row settled, so the
  // panel is Ready. The six twins are confirmed, one long-titled find is to
  // be added on each side, and every other song is marked.
  const longFind = (side, uri) => ({
    side,
    name: LONG,
    artists: LONG_ARTISTS,
    durationMs: 241000,
    videoType: side === 'youtube' ? 'MUSIC_VIDEO_TYPE_OMV' : null,
    uri,
  })
  const twins = [
    ...demo.slice(0, 4).map((track, index) => [track.id, `strong${index}0000`.slice(0, 11)]),
    ...demo.slice(4, 6).map((track, index) => [track.id, `likely${index}0000`.slice(0, 11)]),
  ]
  const settledKeys = new Set([...twins.map(([key]) => key), demo[6].id])
  const readyBook = [
    ...twins.map(([spotifyKey, youtubeVideoId]) => ({ spotifyKey, youtubeVideoId, verdict: 'same', decidedAt: 1 })),
    { spotifyKey: demo[6].id, youtubeVideoId: 'findyt00000', verdict: 'same', decidedAt: 1, found: longFind('youtube', null) },
    {
      spotifyKey: 'findsp00000000000000000',
      youtubeVideoId: 'longvid5000',
      verdict: 'same',
      decidedAt: 1,
      found: longFind('spotify', 'spotify:track:findsp00000000000000000'),
    },
    ...['longvid0000', 'longvid1000', 'longvid2000', 'longvid3000', 'longvid4000'].map((youtubeVideoId) => ({
      spotifyKey: null,
      youtubeVideoId,
      verdict: 'none',
      decidedAt: 1,
    })),
    ...spotifyKeys
      .filter((key) => !settledKeys.has(key))
      .map((spotifyKey) => ({ spotifyKey, youtubeVideoId: null, verdict: 'none', decidedAt: 1 })),
  ]

  const measure = () => {
    const found = []
    const rows = document.querySelectorAll(
      '.board-row, .board-cols, .lever-row, .head, .tally, .peek-row, .tray-cand, .tray-field, .tray-pair .tray-actions, .tray-head, .tray-foot, .mirror-row',
    )
    for (const row of rows) {
      const rowBox = row.getBoundingClientRect()
      if (rowBox.width === 0) continue
      const name = `${row.className.split(' ')[0]}${row.closest('.board')?.classList.contains('board-review') ? '@review' : ''}`
      for (const [index, cell] of [...row.children].entries()) {
        const cellBox = cell.getBoundingClientRect()
        if (cellBox.width === 0 || cellBox.height === 0) continue
        if (cellBox.right > rowBox.right + 1.5 || cellBox.left < rowBox.left - 1.5) {
          found.push(`${name} cell ${index} runs past its row by ${Math.round(Math.max(cellBox.right - rowBox.right, rowBox.left - cellBox.left))}px`)
        }
        const style = getComputedStyle(cell)
        if (style.overflowX === 'visible' && cell.scrollWidth > cell.clientWidth + 1) {
          found.push(`${name} cell ${index} text runs past its column: "${cell.textContent.trim().slice(0, 40)}"`)
        }
        for (const element of cell.querySelectorAll('*')) {
          const box = element.getBoundingClientRect()
          if (box.width === 0 || box.height === 0) continue
          const over = Math.max(box.right - cellBox.right, cellBox.left - box.left)
          if (over > 1.5) found.push(`${name} cell ${index} ${element.tagName.toLowerCase()} "${(element.textContent || '').trim().slice(0, 30)}" runs past its column by ${Math.round(over)}px`)
        }
      }
    }
    return [...new Set(found)]
  }

  const report = {}
  const note = (where, findings) => {
    for (const finding of findings) (report[finding] ??= []).push(where)
  }
  const screens = [
    ['playlists', '/?demo=1'],
    ['sort', '/spotify/demo-1?demo=1'],
    ['sort-csv', '/spotify/demo-1?demo=1&csv=1'],
    ['preview', '/spotify/demo-2/preview?demo=1'],
    ['progress', '/spotify/demo-2/progress?demo=1&progress=running'],
    ['progress-done', '/spotify/demo-1/progress?demo=1&progress=done'],
    ['review', '/spotify/demo-1/review?demo=1'],
    ['review-ready', '/spotify/demo-1/review?demo=1'],
  ]
  for (const [name, path] of screens) {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      // The review pass gets one settled pair and one song marked on each
      // side, so the Settled and "Not on the other service" groups have rows
      // to measure. The review-ready pass gets every row settled.
      await page.evaluate(
        (book) => localStorage.setItem('playlist-sorter:match-book', JSON.stringify(book)),
        name === 'review-ready' ? readyBook : reviewBook,
      )
      await page.goto(`${BASE}${path}`)
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(500)
      if (name === 'review-ready') {
        await page.selectOption('#review-youtube', 'PLT')
        await page.waitForSelector('.mirror')
        if (await page.getByRole('button', { name: 'Update YouTube' }).isDisabled()) {
          throw new Error(`review-ready@${width}: the mirror panel is not Ready`)
        }
        for (const summary of await page.locator('.mirror-list > summary').all()) await summary.click()
        if ((await page.locator('.mirror-row').count()) < 2) throw new Error(`review-ready@${width}: no rows to measure`)
        note(`review-ready@${width}`, await page.evaluate(measure))
        continue
      }
      if (name !== 'review') {
        note(`${name}@${width}`, await page.evaluate(measure))
        continue
      }
      await page.selectOption('#review-youtube', 'PLT')
      await page.waitForSelector('.board-review .board-row')
      await page.getByRole('button', { name: 'Search all unmatched' }).click()
      await page.waitForFunction(() => document.body.textContent.includes('Searched'), null, { timeout: 30000 })
      // Open Settled and Not on the other service, so their rows are measured.
      for (const summary of await page.locator('.review-settled > summary').all()) await summary.click()
      const marked = await page.locator('.review-marked .board-row').count()
      if (marked !== 2) throw new Error(`review@${width}: expected 2 marked rows, found ${marked}`)
      if (!(await page.locator('.review-marked').evaluate((el) => el.open))) throw new Error(`review@${width}: the marked group did not open`)
      note(`review@${width}`, await page.evaluate(measure))
      for (const [label, button, pair, search] of [
        ['tray: only on Spotify', page.getByRole('button', { name: 'Find a match' }).first(), false, 'Search YouTube Music'],
        ['tray: a likely pair', page.getByRole('button', { name: 'Listen', exact: true }).first(), true, null],
        ['tray: only on YouTube', page.getByRole('button', { name: 'Find a match' }).last(), false, 'Search Spotify'],
      ]) {
        await button.click()
        await page.waitForSelector('.tray .tray-cand')
        // Prove the right tray opened and that it has candidates to measure.
        const opened = await page.evaluate(() => ({
          cands: document.querySelectorAll('.tray .tray-cand').length,
          pair: document.querySelectorAll('.tray .tray-pair').length > 0,
          buttons: [...document.querySelectorAll('.tray button')].map((b) => b.textContent.trim()),
        }))
        if (opened.cands === 0) throw new Error(`${label}@${width}: the tray has no candidates to measure`)
        if (opened.pair !== pair) throw new Error(`${label}@${width}: expected ${pair ? 'a' : 'no'} pair in the tray`)
        if (search && !opened.buttons.includes(search)) throw new Error(`${label}@${width}: expected a "${search}" button, found ${JSON.stringify(opened.buttons)}`)
        note(`${label}@${width}`, await page.evaluate(measure))
        await page.getByRole('button', { name: 'Close', exact: true }).first().click()
        await page.waitForSelector('.tray', { state: 'detached' })
      }
    }
  }
  return JSON.stringify(report, null, 1)
}
