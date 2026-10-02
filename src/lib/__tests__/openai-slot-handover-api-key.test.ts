/**
 * F3 (3.0.1, T4 Nebenfund): "a freshly added provider comes with a prefilled
 * value". Add Provider pushes a new backend into the shared `openai` slot via
 * `slotTakeoverUpdate`, whose patch never mentions `apiKey`, the plain store
 * merge in ProviderConfig.tsx's setProviderConfig therefore left whatever key
 * the DISPLACED backend had sitting in the field, so a brand new custom
 * OpenAI-compatible provider showed (and would have submitted) a secret that
 * belongs to a completely different endpoint.
 *
 * Run: npx vitest run src/lib/__tests__/openai-slot-handover-api-key.test.ts
 */
import { describe, it, expect } from 'vitest'
import { takeoverClearsApiKey, slotTakeoverUpdate, slotHandbackUpdate, type HandoverSlot } from '../openai-slot-handover'

const jan: HandoverSlot = {
  enabled: true, name: 'Jan', baseUrl: 'http://localhost:1337/v1', isLocal: true, managed: false,
}

describe('F3: a slot takeover clears the inherited API key', () => {
  it('a genuinely different backend clears it: the old key belongs elsewhere', () => {
    const incoming = { name: 'My Server', baseUrl: 'http://localhost:5001/v1', isLocal: true, managed: false }
    expect(takeoverClearsApiKey(jan, incoming)).toBe(true)
  })

  it('re-selecting the SAME backend that already holds the slot keeps the key', () => {
    const incoming = { name: jan.name, baseUrl: jan.baseUrl, isLocal: jan.isLocal, managed: jan.managed }
    expect(takeoverClearsApiKey(jan, incoming)).toBe(false)
  })

  it('an empty/disabled slot has nothing to leak, so nothing is cleared', () => {
    const empty: HandoverSlot = { enabled: false, name: '', baseUrl: '', isLocal: true, managed: false }
    const incoming = { name: 'My Server', baseUrl: 'http://localhost:5001/v1', isLocal: true, managed: false }
    expect(takeoverClearsApiKey(empty, incoming)).toBe(false)
  })

  it('switching only the managed flag (Built-in Engine <-> foreign backend) still counts as different', () => {
    const builtin: HandoverSlot = { enabled: true, name: 'Built-in Engine', baseUrl: 'http://127.0.0.1:8127/v1', isLocal: true, managed: true }
    const incoming = { name: 'Built-in Engine', baseUrl: 'http://127.0.0.1:8127/v1', isLocal: true, managed: false }
    expect(takeoverClearsApiKey(builtin, incoming)).toBe(true)
  })
})

/**
 * Opus-Review Nachbesserung 6 (3.0.1, F3): closing the leak by clearing the
 * key on takeover was only half the fix, the DISPLACED backend's own key
 * has to survive somewhere, or handing the slot back later comes with no key
 * and a silent 401. `displaced.apiKey` is that somewhere; these tests pin the
 * pure carry-through (the actual restore into the store + keychain is
 * ProviderConfig.tsx's job, see das there and background-shutdown-adjacent
 * tests for the store-level partialize stripping).
 */
describe('Nachbesserung 6: the displaced backend keeps its own key', () => {
  it('a real takeover remembers the OUTGOING backend key in displaced.apiKey', () => {
    const janWithKey: HandoverSlot = { ...jan, apiKey: 'obf-jan-key' }
    const incoming = { name: 'My Server', baseUrl: 'http://localhost:5001/v1', isLocal: true, managed: false }
    const patch = slotTakeoverUpdate(janWithKey, incoming)
    expect(patch.displaced?.apiKey).toBe('obf-jan-key')
  })

  it('re-selecting the same backend does not create a displaced record at all, key included', () => {
    const janWithKey: HandoverSlot = { ...jan, apiKey: 'obf-jan-key' }
    const incoming = { name: jan.name, baseUrl: jan.baseUrl, isLocal: jan.isLocal, managed: jan.managed }
    const patch = slotTakeoverUpdate(janWithKey, incoming)
    expect(patch.displaced).toBeUndefined()
  })

  it('slotHandbackUpdate hands the parked key back out through standbyOccupant', () => {
    const slotWithDisplacedKey: HandoverSlot = {
      enabled: true, name: 'Jan', baseUrl: 'http://localhost:1337/v1', isLocal: true, managed: false, apiKey: 'obf-jan-active',
      displaced: { name: 'Built-in Engine', baseUrl: 'http://127.0.0.1:8127/v1', isLocal: true, managed: true, apiKey: 'obf-builtin-parked' },
    }
    const update = slotHandbackUpdate(slotWithDisplacedKey)
    // The base patch itself never carries an apiKey field, ProviderConfig.tsx
    // reads the parked value straight off `providers.openai.displaced.apiKey`
    // BEFORE calling this, exactly so a plain merge of this patch cannot
    // corrupt the store's separately-obfuscated apiKey field (see the
    // handBackSlot/removeOccupant comment there for why).
    expect(update?.apiKey).toBeUndefined()
    // And the backend now being pushed OUT (Jan) gets its own key parked in
    // turn, so a second handback later still has something to give back.
    expect(update?.displaced?.apiKey).toBe('obf-jan-active')
  })

  it('a backend with no key parks nothing, and a handback restores nothing (not a stale one)', () => {
    const slotNoKey: HandoverSlot = {
      enabled: true, name: 'Jan', baseUrl: 'http://localhost:1337/v1', isLocal: true, managed: false,
      displaced: { name: 'Built-in Engine', baseUrl: 'http://127.0.0.1:8127/v1', isLocal: true, managed: true },
    }
    const update = slotHandbackUpdate(slotNoKey)
    expect(update?.displaced?.apiKey).toBeUndefined()
  })
})
