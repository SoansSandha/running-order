/**
 * PKCE primitives for the Authorization Code flow.
 *
 * PKCE is what lets a browser app authorise without a client secret — there
 * is no secret to leak, which is why this app needs no server. See docs
 * design §5.3.
 */

const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'

/** A high-entropy string of unreserved characters, 43-128 chars per RFC 7636. */
export function createCodeVerifier(length = 64) {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  let out = ''
  for (const byte of bytes) out += UNRESERVED[byte % UNRESERVED.length]
  return out
}

/** base64url(SHA-256(verifier)), the S256 challenge method. */
export async function createCodeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64UrlEncode(new Uint8Array(digest))
}

/** Opaque value echoed back by Spotify, guarding against cross-site callbacks. */
export function randomState() {
  return createCodeVerifier(32)
}

function base64UrlEncode(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
