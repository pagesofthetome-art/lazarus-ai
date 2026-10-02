import { describe, expect, it } from 'vitest'
import { googleLoopbackRedirectUri } from '../googleOAuth'

describe('Google desktop OAuth loopback redirect', () => {
  it('uses the loopback IP and ephemeral port without an extra path', () => {
    expect(googleLoopbackRedirectUri(43127)).toBe('http://127.0.0.1:43127')
  })
})
