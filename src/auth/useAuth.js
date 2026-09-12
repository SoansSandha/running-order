/**
 * The connection lifecycle as React state.
 *
 * The redirect URI is the app root, so there is no callback route: this hook
 * checks for `?code=` on mount, exchanges it, and clears the query string.
 * See docs design §5.3.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '../api/client.js'
import { recordApiEvent } from '../ui/apiLog.js'
import { createCodeChallenge, createCodeVerifier, randomState } from './pkce.js'
import {
  buildAuthorizeUrl,
  currentRedirectUri,
  exchangeCodeForTokens,
  refreshTokens,
} from './spotifyAuth.js'

const CLIENT_ID_KEY = 'playlist-sorter:client-id'
const REFRESH_KEY = 'playlist-sorter:refresh-token'
const VERIFIER_KEY = 'playlist-sorter:verifier'
const STATE_KEY = 'playlist-sorter:state'
const REFRESH_MARGIN_MS = 60_000

function read(storage, key) {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(storage, key, value) {
  try {
    if (value === null) storage?.removeItem(key)
    else storage?.setItem(key, value)
  } catch {
    // Blocked site data. The session still works, it just will not persist.
  }
}

export function useAuth() {
  const [clientId, setClientIdState] = useState(
    () => read(globalThis.localStorage, CLIENT_ID_KEY) ?? '',
  )
  const [status, setStatus] = useState('idle') // idle | restoring | connecting | connected | error
  const [error, setError] = useState(null)
  const [tokens, setTokens] = useState(null)

  const tokensRef = useRef(null)
  // Latest-ref so the long-lived api client always reads the current values
  // without being rebuilt. Updated on write, never during render.
  const clientIdRef = useRef(clientId)

  const applyTokens = useCallback((next) => {
    tokensRef.current = next
    setTokens(next)
    write(globalThis.localStorage, REFRESH_KEY, next?.refreshToken ?? null)
  }, [])

  const setClientId = useCallback((value) => {
    clientIdRef.current = value
    setClientIdState(value)
    write(globalThis.localStorage, CLIENT_ID_KEY, value || null)
  }, [])

  const disconnect = useCallback(() => {
    applyTokens(null)
    setStatus('idle')
    setError(null)
  }, [applyTokens])

  // One client for the app's lifetime; it reads the live token through a ref.
  const client = useMemo(
    () =>
      createClient({
        onEvent: recordApiEvent,
        getAccessToken: () => tokensRef.current?.accessToken ?? '',
        refreshAccessToken: async () => {
          const id = clientIdRef.current
          const refreshToken = tokensRef.current?.refreshToken
          if (!id || !refreshToken) throw new Error('No refresh token available')
          const next = await refreshTokens({ clientId: id, refreshToken })
          applyTokens(next)
          return next.accessToken
        },
      }),
    [applyTokens],
  )

  /**
   * The callback runs exactly once per page load.
   *
   * StrictMode mounts, unmounts, and remounts in development. The
   * authorization code is single-use and the query string is cleared the
   * moment it is read, so a second invocation finds nothing and the first
   * one's result must not be discarded as though the component had really
   * gone away. Guarding on a ref covers both: the second pass returns
   * immediately, and the first pass keeps its tokens.
   */
  const callbackHandled = useRef(false)

  // Resume: handle a redirect back from Spotify, or restore a stored session.
  useEffect(() => {
    if (callbackHandled.current) return
    callbackHandled.current = true

    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const returnedState = params.get('state')
    const returnedError = params.get('error')

    const clearQuery = () =>
      window.history.replaceState({}, '', window.location.pathname)

    async function resume() {
      if (returnedError) {
        clearQuery()
        setError(describeAuthError(returnedError))
        setStatus('error')
        return
      }

      if (code) {
        const verifier = read(globalThis.sessionStorage, VERIFIER_KEY)
        const expectedState = read(globalThis.sessionStorage, STATE_KEY)
        clearQuery()

        if (!verifier || returnedState !== expectedState) {
          setError('That sign-in did not match the request this tab started. Try connecting again.')
          setStatus('error')
          return
        }

        setStatus('connecting')
        try {
          const next = await exchangeCodeForTokens({
            clientId: clientIdRef.current,
            code,
            redirectUri: currentRedirectUri(),
            codeVerifier: verifier,
          })
          applyTokens(next)
          setStatus('connected')
        } catch (failure) {
          setError(failure.message)
          setStatus('error')
        }
        return
      }

      const storedRefresh = read(globalThis.localStorage, REFRESH_KEY)
      if (storedRefresh && clientIdRef.current) {
        setStatus('restoring')
        try {
          const next = await refreshTokens({
            clientId: clientIdRef.current,
            refreshToken: storedRefresh,
          })
          applyTokens(next)
          setStatus('connected')
        } catch {
          // A stale refresh token is not an error worth showing on arrival.
          write(globalThis.localStorage, REFRESH_KEY, null)
          setStatus('idle')
        }
      }
    }

    resume()
  }, [applyTokens])

  // Refresh ahead of expiry so a long reorder never stalls mid-run.
  useEffect(() => {
    if (!tokens?.expiresAt) return
    const delay = Math.max(5_000, tokens.expiresAt - Date.now() - REFRESH_MARGIN_MS)
    const timer = setTimeout(() => {
      client.get('/me').catch(() => {})
    }, delay)
    return () => clearTimeout(timer)
  }, [tokens, client])

  const connect = useCallback(async () => {
    const id = clientIdRef.current?.trim()
    if (!id) {
      setError('Enter the Client ID from your Spotify app first.')
      setStatus('error')
      return
    }

    setError(null)
    setStatus('connecting')

    const verifier = createCodeVerifier()
    const state = randomState()
    write(globalThis.sessionStorage, VERIFIER_KEY, verifier)
    write(globalThis.sessionStorage, STATE_KEY, state)

    const challenge = await createCodeChallenge(verifier)
    window.location.assign(
      buildAuthorizeUrl({
        clientId: id,
        redirectUri: currentRedirectUri(),
        codeChallenge: challenge,
        state,
      }),
    )
  }, [])

  return {
    clientId,
    setClientId,
    status,
    error,
    connect,
    disconnect,
    client,
    isConnected: status === 'connected' && Boolean(tokens),
  }
}

function describeAuthError(code) {
  if (code === 'access_denied') return 'You declined the permission request, so nothing is connected.'
  if (code === 'invalid_client') return 'Spotify did not recognise that Client ID. Check it and try again.'
  return `Spotify refused the connection (${code}).`
}
