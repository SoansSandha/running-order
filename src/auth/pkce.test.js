import { describe, expect, test } from 'vitest'
import { createCodeChallenge, createCodeVerifier, randomState } from './pkce.js'

describe('createCodeVerifier', () => {
  test('produces a verifier inside the length RFC 7636 allows', () => {
    const verifier = createCodeVerifier()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
  })

  test('uses only unreserved characters, so it survives a URL round trip', () => {
    expect(createCodeVerifier(128)).toMatch(/^[A-Za-z0-9\-._~]+$/)
  })

  test('does not repeat itself', () => {
    expect(createCodeVerifier()).not.toBe(createCodeVerifier())
  })
})

describe('createCodeChallenge', () => {
  test('matches the worked example in RFC 7636', async () => {
    // Appendix B of the spec. If this drifts, the Spotify handshake breaks
    // with an opaque error, so it is worth pinning to the published vector.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(await createCodeChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  test('is base64url encoded, with no padding or URL-unsafe characters', async () => {
    const challenge = await createCodeChallenge(createCodeVerifier())
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/)
  })

  test('is deterministic for a given verifier', async () => {
    const verifier = createCodeVerifier()
    expect(await createCodeChallenge(verifier)).toBe(await createCodeChallenge(verifier))
  })
})

describe('randomState', () => {
  test('produces a fresh value each time, which is the point of it', () => {
    expect(randomState()).not.toBe(randomState())
  })
})
