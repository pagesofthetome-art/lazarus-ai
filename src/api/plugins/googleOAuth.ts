import { oauthStart, oauthWait, openExternal, isTauri } from '../backend'

export interface GoogleOAuthResult {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
}

/** Google Desktop OAuth loopback redirects use the ephemeral IP:port origin. */
export function googleLoopbackRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}`
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function randomUrlPart(size = 32): Promise<string> {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(new Uint8Array(digest))
}

/**
 * Google desktop OAuth with PKCE. The native callback listener is the only
 * local HTTP server involved; tokens remain in the caller's memory.
 */
export async function connectGoogleDrive(clientId: string): Promise<GoogleOAuthResult> {
  if (!isTauri()) throw new Error('Google sign-in is available in the Lazarus desktop app.')
  if (!clientId.trim()) throw new Error('Google OAuth client ID is not configured.')
  const port = await oauthStart()
  const redirectUri = googleLoopbackRedirectUri(port)
  const state = await randomUrlPart()
  const verifier = await randomUrlPart(48)
  const challenge = await pkceChallenge(verifier)
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  await openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
  const callback = await oauthWait(port, 300)
  const result = new URLSearchParams(callback)
  if (result.get('state') !== state) throw new Error('Google sign-in state did not match.')
  const error = result.get('error')
  if (error) throw new Error(`Google sign-in was not completed: ${error}`)
  const code = result.get('code')
  if (!code) throw new Error('Google sign-in returned no authorization code.')
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status}).`)
  const tokens = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number }
  if (!tokens.access_token) throw new Error('Google token exchange returned no access token.')
  return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresIn: tokens.expires_in }
}
