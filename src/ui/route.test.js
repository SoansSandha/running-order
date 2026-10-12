import { describe, expect, test } from 'vitest'
import { parseRoute, pathFor } from './route.js'

const at = (path) => parseRoute(new URL(path, 'http://127.0.0.1:5173'))

describe('parseRoute', () => {
  test('/ is the Spotify library', () => {
    expect(at('/')).toEqual({ view: 'home', source: 'spotify', playlistId: null })
  })

  test('?source=youtube is the YouTube library', () => {
    expect(at('/?source=youtube')).toEqual({ view: 'home', source: 'youtube', playlistId: null })
  })

  test('an unknown ?source is the Spotify library', () => {
    expect(at('/?source=tidal')).toEqual({ view: 'home', source: 'spotify', playlistId: null })
  })

  test('a playlist path is its Sort screen', () => {
    expect(at('/spotify/37i9dQZF1DXcBWIGoYBM5M')).toEqual({
      view: 'sort',
      source: 'spotify',
      playlistId: '37i9dQZF1DXcBWIGoYBM5M',
    })
  })

  test('a trailing slash is the same route', () => {
    expect(at('/youtube/PLx_y-1/')).toEqual({ view: 'sort', source: 'youtube', playlistId: 'PLx_y-1' })
  })

  test.each(['preview', 'progress', 'review'])('/spotify/:id/%s is that view', (view) => {
    expect(at(`/spotify/abc/${view}`)).toEqual({ view, source: 'spotify', playlistId: 'abc' })
  })

  test('a YouTube playlist has no Review, so it lands on its Sort', () => {
    expect(at('/youtube/PLabc/review?demo=1')).toEqual({ redirect: '/youtube/PLabc?demo=1' })
  })

  test.each([
    ['an unknown source', '/tidal/abc'],
    ['a source with no id', '/spotify'],
    ['an unknown view', '/spotify/abc/settings'],
    ['Sort named outright', '/spotify/abc/sort'],
    ['extra segments', '/spotify/abc/preview/more'],
    ['an encoded slash in the id', '/spotify/a%2F..%2Fme'],
    ['a dot in the id', '/spotify/a.b'],
  ])('%s goes home', (_, path) => {
    expect(at(path)).toEqual({ redirect: '/' })
  })

  test('a redirect home keeps the other query parameters', () => {
    expect(at('/nowhere?demo=1&source=youtube')).toEqual({ redirect: '/?demo=1' })
  })
})

const ROUTES = [
  { view: 'home', source: 'spotify', playlistId: null },
  { view: 'home', source: 'youtube', playlistId: null },
  { view: 'sort', source: 'spotify', playlistId: 'abc' },
  { view: 'preview', source: 'spotify', playlistId: 'abc' },
  { view: 'progress', source: 'spotify', playlistId: 'abc' },
  { view: 'review', source: 'spotify', playlistId: 'abc' },
  { view: 'sort', source: 'youtube', playlistId: 'PL_a-b' },
  { view: 'preview', source: 'youtube', playlistId: 'PL_a-b' },
  { view: 'progress', source: 'youtube', playlistId: 'PL_a-b' },
]

describe('pathFor', () => {
  test.each(ROUTES)('$view on $source survives a round trip', (route) => {
    expect(at(pathFor(route))).toEqual(route)
  })

  test('names each path as the spec does', () => {
    expect(pathFor({ view: 'home', source: 'spotify', playlistId: null })).toBe('/')
    expect(pathFor({ view: 'home', source: 'youtube', playlistId: null })).toBe('/?source=youtube')
    expect(pathFor({ view: 'sort', source: 'spotify', playlistId: 'abc' })).toBe('/spotify/abc')
    expect(pathFor({ view: 'review', source: 'spotify', playlistId: 'abc' })).toBe('/spotify/abc/review')
  })

  test('carries other query parameters, and keeps ?source to home', () => {
    expect(pathFor({ view: 'preview', source: 'youtube', playlistId: 'PLx' }, '?demo=1&source=youtube&debug')).toBe(
      '/youtube/PLx/preview?demo=1&debug=',
    )
    expect(pathFor({ view: 'home', source: 'youtube', playlistId: null }, '?demo=1')).toBe('/?demo=1&source=youtube')
    expect(pathFor({ view: 'home', source: 'spotify', playlistId: null }, '?source=youtube')).toBe('/')
  })
})
