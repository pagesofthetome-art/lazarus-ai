/**
 * K8 nachbessert (review-create.md), Punkt 6: starting the dev server with
 * `--host` exposes /shell-execute and /execute-code (both behind
 * /local-api, see waechter-und-port.test.ts) to anyone on the LAN, not just
 * this machine. Nothing told the person starting it. hostWarningMessage()
 * (dev-server/index.ts) is the pure, testable half of the one-line warning
 * devServerPlugin now prints once the server is actually listening.
 *
 * Run: npx vitest run dev-server/__tests__/host-warning-k8.test.ts
 */
import { describe, expect, it } from 'vitest'
import { hostWarningMessage } from '../index'

describe('hostWarningMessage (K8 Punkt 6)', () => {
  it('--host inactive: no warning', () => {
    expect(hostWarningMessage({ config: { server: {} }, resolvedUrls: null })).toBeNull()
  })

  it('--host active: names both endpoints and says LAN-reachable', () => {
    const msg = hostWarningMessage({ config: { server: { host: true } }, resolvedUrls: null })
    expect(msg).not.toBeNull()
    expect(msg).toContain('/shell-execute')
    expect(msg).toContain('/execute-code')
    expect(msg).toMatch(/LAN/)
  })

  it('--host as a bound address string (not just boolean true) still warns', () => {
    // Vite accepts --host <address> too; server.config.server.host is then
    // the address string, not `true`. The check must not be `=== true`.
    const msg = hostWarningMessage({ config: { server: { host: '0.0.0.0' } }, resolvedUrls: null })
    expect(msg).not.toBeNull()
  })
})
