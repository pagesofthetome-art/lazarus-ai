import { describe, it, expect } from 'vitest'
import { isBuiltinEngineMissing } from '../builtin-engine-presence'

describe('isBuiltinEngineMissing', () => {
  it('is false when Lazarus Engine occupies the slot', () => {
    expect(isBuiltinEngineMissing({ managed: true }, false)).toBe(false)
  })

  it('is true when a custom provider occupies the slot and nothing is on standby', () => {
    expect(isBuiltinEngineMissing({ managed: false }, false)).toBe(true)
    expect(isBuiltinEngineMissing({ managed: false, displaced: undefined }, false)).toBe(true)
  })

  it('is false when Lazarus Engine is only parked on standby', () => {
    expect(isBuiltinEngineMissing({ managed: false, displaced: { managed: true } }, false)).toBe(false)
  })

  it('is true when a different backend is parked on standby, not Lazarus Engine', () => {
    // Two custom providers in a row: the second takeover overwrote the
    // standby memory that used to hold Lazarus Engine (R13D Nebenfund 1), so the
    // slot now remembers only the first custom provider, e.g. Jan.
    expect(isBuiltinEngineMissing({ managed: false, displaced: { managed: false } }, false)).toBe(true)
    expect(isBuiltinEngineMissing({ managed: false, displaced: {} }, false)).toBe(true)
  })

  it('is true for a missing or empty slot, independent of any other provider being active', () => {
    // Cloud mode active (lu-cloud enabled) says nothing about the openai
    // slot itself: this check reads only the slot it is given, never a
    // global mode flag, so a caller gating on cloud mode does that itself.
    expect(isBuiltinEngineMissing(undefined, false)).toBe(true)
    expect(isBuiltinEngineMissing(null, false)).toBe(true)
    expect(isBuiltinEngineMissing({}, false)).toBe(true)
  })
})

// Opus review, first round: `managed: false` with no `displaced` record is
// not proof of the R13D eviction bug. Five write paths in the app leave the
// `openai` slot in exactly that shape ON PURPOSE, because the customer
// picked a different local backend for himself. `optedOut` is how the
// caller tells this function which situation it is looking at; see
// providerStore.engineOptedOut and its five call sites.
describe('isBuiltinEngineMissing, the optedOut parameter (Opus review, first round)', () => {
  // The resulting `openai` slot shape each of the five deliberate-pick call
  // sites leaves behind. None of them write `displaced`, which is exactly
  // why the bare two-argument check could not tell them apart from R13D.
  const deliberatePickShapes = [
    { label: 'Onboarding.tsx:179, Ollama chosen', slot: { managed: false } },
    { label: 'Onboarding.tsx:184, a detected backend chosen', slot: { managed: false, displaced: undefined } },
    { label: 'BackendsStep.tsx:359, LM Studio installed by the assistant', slot: { managed: false } },
    { label: 'BackendSelector.tsx:79, startup selector dialog', slot: { managed: false } },
    { label: 'ModelSelector.tsx:227, Start LM Studio Server', slot: { managed: false } },
  ]

  it('is false for every one of the five deliberate pick paths once optedOut is set, as the app itself sets it', () => {
    const results = deliberatePickShapes.map((c) => isBuiltinEngineMissing(c.slot, true))
    expect(results).toEqual([false, false, false, false, false])
    // Negative control with numbers: exactly 0 of the 5 read as missing once
    // opted out is true, and exactly 5 of 5 would read as missing without it
    // (the false-positive this review caught).
    expect(results.filter((r) => r === true)).toHaveLength(0)
    const withoutOptOut = deliberatePickShapes.map((c) => isBuiltinEngineMissing(c.slot, false))
    expect(withoutOptOut.filter((r) => r === true)).toHaveLength(5)
  })

  it('the R13D eviction chain still reads as missing: optedOut stays false because Add Provider never sets it', () => {
    // Two custom providers added in a row, both removed again: the slot the
    // silent-eviction bug leaves behind, see the tests above this describe
    // block. No pick UI ran, so engineOptedOut was never set to true.
    const r13dSlot = { managed: false, displaced: { managed: false } }
    expect(isBuiltinEngineMissing(r13dSlot, false)).toBe(true)
  })

  it('a stale opt-out does not survive Lazarus Engine actually coming back: the caller reads providerStore.engineOptedOut fresh, this function just trusts what it is given', () => {
    // This function itself has no memory; the reset-on-return behaviour is
    // providerStore.setProviderConfig's job (see its own tests). Documented
    // here so a reader of this file is not surprised the function itself
    // does not special-case `slot.managed === true` against `optedOut`.
    expect(isBuiltinEngineMissing({ managed: true }, true)).toBe(false)
    expect(isBuiltinEngineMissing({ managed: true }, false)).toBe(false)
  })

  // Opus review, round 2, kleinigkeit: `optedOut` used to default to
  // `false`, the one value that SHOWS the notice, so a caller that forgot
  // the argument got a false positive by default, not a missed notice. The
  // argument is required now (see the TS signature): omitting it is a
  // COMPILE error, so `npx tsc` catches a forgetful caller before it ever
  // ships, instead of the runtime silently choosing the unsafe default. The
  // line below documents that: without the required argument the call is a
  // type error the build gate would refuse, `tsc -p tsconfig.app.json` is
  // clean specifically because every real call site passes it.
  it('optedOut has no default: TypeScript refuses a call that omits it', () => {
    // @ts-expect-error the second argument is required, not optional
    isBuiltinEngineMissing({ managed: false })
  })
})
