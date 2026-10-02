/**
 * Whether the built-in Lazarus Engine provider has fallen out of the provider
 * list entirely, WITHOUT the customer having chosen that.
 *
 * R13D Nebenfund 1 (3.0.1 box-gruen r13d, 2026-09-21): add two custom local
 * OpenAI-compatible providers in a row and remove both again, and the Lazarus
 * Engine card is gone from Settings, AI Backends, Providers, with no card
 * anywhere and no restart bringing it back. Root cause lives in
 * `lib/openai-slot-handover.ts`: the shared `openai` slot remembers only ONE
 * displaced backend (`ProviderConfig.displaced`, a single object, not a
 * stack). `slotTakeoverUpdate` overwrites that single memory on every
 * takeover, so the SECOND custom provider's takeover discards Lazarus Engine's
 * `displaced` record, not the later removal. This function does not fix that
 * (see the comment above for the real cause); it only lets the app notice
 * and say so, per the owner's instruction: no rework of the slot logic for
 * 3.0.1, just a clear, dismissible notice with a way back.
 *
 * Opus review, first round (2026-09-21): reading `managed`/`displaced` alone
 * is a false positive for every customer who never had Lazarus Engine in the
 * first place, or who chose a different local backend on purpose. Five
 * pick UIs write `managed: false` with no `displaced` record onto the
 * `openai` slot, the EXACT same shape the silent-eviction bug leaves behind
 * (onboarding's Ollama and detected-backend choices, the startup backend
 * selector, "Start LM Studio Server" in the model picker): the provider
 * config alone cannot tell "evicted by the bug" from "picked on purpose"
 * apart. `providerStore.engineOptedOut` is the difference: set only by
 * those dedicated pick UIs (not by Add Provider, which is the path the bug
 * actually runs through), and cleared automatically the moment `managed:
 * true` is written back onto the slot. When the caller does not pass it,
 * this stays exactly the check it was before that flag existed, so every
 * unit test written against a bare slot keeps meaning what it always meant.
 *
 * "im Zweifel enger feuern" (owner's instruction): a false positive is the
 * one kind of mistake this function must never make, only a missed notice.
 * Opus review, round 2 (2026-09-21): a DEFAULT value on `optedOut` worked
 * against that promise, not for it, a caller that forgot the argument would
 * silently get `false`, the answer that SHOWS the notice. The argument is
 * required now, so a forgotten argument is a compile error instead of a
 * silent false positive. Both real call sites (ProviderConfig.tsx,
 * EngineMissingBar.tsx) already read `providerStore.engineOptedOut` and pass
 * it through.
 */

/** The parts of the `openai` slot this check reads. Matches the shape of
 *  `ProviderConfig` and `HandoverSlot` without importing either, so this
 *  stays a plain, dependency-free function. */
export interface EngineSlotView {
  managed?: boolean
  displaced?: {
    managed?: boolean
  }
}

export function isBuiltinEngineMissing(
  slot: EngineSlotView | undefined | null,
  optedOut: boolean,
): boolean {
  if (!slot) return true
  if (slot.managed) return false
  if (slot.displaced?.managed) return false
  if (optedOut) return false
  return true
}
