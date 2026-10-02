/**
 * Opus review, first round, Blocker 1: `providerStore.engineOptedOut` is the
 * flag that tells a deliberate customer pick apart from the R13D silent
 * eviction bug, both of which leave the same `{ managed: false }` shape on
 * the `openai` slot (see lib/builtin-engine-presence.ts). This proves the
 * store half: the setter writes it, and `setProviderConfig` clears it again
 * the moment Lazarus Engine is really back on the slot.
 *
 * The five call sites themselves (Onboarding.tsx, BackendsStep.tsx,
 * BackendSelector.tsx, ModelSelector.tsx) are pinned by source-text
 * assertions in engine-opted-out-wiring.test.ts, one file up from the store
 * so the source-reading helper does not need to walk out of stores/.
 *
 * Run: npx vitest run src/stores/__tests__/engine-opted-out.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../api/providers/client-cache', () => ({ clearProviderCache: vi.fn() }))

import { useProviderStore } from '../providerStore'

beforeEach(() => {
  useProviderStore.setState({ engineOptedOut: false })
})

describe('providerStore.engineOptedOut', () => {
  it('starts false', () => {
    expect(useProviderStore.getState().engineOptedOut).toBe(false)
  })

  it('setEngineOptedOut writes the flag', () => {
    useProviderStore.getState().setEngineOptedOut(true)
    expect(useProviderStore.getState().engineOptedOut).toBe(true)
  })

  it('setProviderConfig clears a stale opt-out the moment Lazarus Engine is written back onto the slot (managed: true)', () => {
    useProviderStore.getState().setEngineOptedOut(true)
    useProviderStore.getState().setProviderConfig('openai', {
      enabled: true, name: 'Lazarus Engine', baseUrl: 'http://127.0.0.1:8127/v1', isLocal: true, managed: true,
    })
    expect(useProviderStore.getState().engineOptedOut).toBe(false)
  })

  // NEGATIVE CONTROL: a write to the openai slot that does NOT set
  // managed: true (an ordinary Disable, a Test click's status update, or a
  // takeover by yet another custom provider) must leave a recorded opt-out
  // standing, otherwise the flag would clear itself on the very next
  // unrelated write and stop meaning anything.
  it('NEGATIVE CONTROL: a write that does not set managed: true leaves the opt-out standing', () => {
    useProviderStore.getState().setEngineOptedOut(true)
    useProviderStore.getState().setProviderConfig('openai', { enabled: false })
    expect(useProviderStore.getState().engineOptedOut).toBe(true)
  })

  // NEGATIVE CONTROL: a write to a DIFFERENT slot must not touch the flag.
  it('NEGATIVE CONTROL: writing to the ollama slot leaves the openai opt-out alone', () => {
    useProviderStore.getState().setEngineOptedOut(true)
    useProviderStore.getState().setProviderConfig('ollama', { enabled: true })
    expect(useProviderStore.getState().engineOptedOut).toBe(true)
  })

  // Opus review, round 2, Blocker 7: `resetProvider('openai')` and
  // `resetProvidersToDefaults` write `providers` directly with `set(...)`,
  // never through `setProviderConfig`, so the auto-clear above never ran for
  // either reset path even though both hand the slot back to Lazarus Engine
  // (managed: true) and the field's own comment promises the mark clears on
  // "a full Reset". Without this a customer who once opted out, then later
  // pressed Reset AI Backends, would keep a stale true forever, silencing a
  // REAL later eviction the notice exists to catch.
  it('resetProvider("openai") clears a stale opt-out: it hands the slot back to Lazarus Engine (managed: true)', () => {
    useProviderStore.getState().setEngineOptedOut(true)
    useProviderStore.getState().resetProvider('openai')
    expect(useProviderStore.getState().providers.openai.managed).toBe(true)
    expect(useProviderStore.getState().engineOptedOut).toBe(false)
  })

  // NEGATIVE CONTROL: resetting a DIFFERENT slot must not touch the flag,
  // same reasoning as the setProviderConfig negative control above.
  it('NEGATIVE CONTROL: resetProvider("ollama") leaves the openai opt-out alone', () => {
    useProviderStore.getState().setEngineOptedOut(true)
    useProviderStore.getState().resetProvider('ollama')
    expect(useProviderStore.getState().engineOptedOut).toBe(true)
  })

  it('resetProvidersToDefaults clears a stale opt-out: it hands the openai slot back to Lazarus Engine too', () => {
    useProviderStore.getState().setEngineOptedOut(true)
    useProviderStore.getState().resetProvidersToDefaults()
    expect(useProviderStore.getState().providers.openai.managed).toBe(true)
    expect(useProviderStore.getState().engineOptedOut).toBe(false)
  })
})
