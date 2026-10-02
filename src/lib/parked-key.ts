/**
 * R9 (3.0.1): OS keychain parking for a displaced OpenAI-compatible API key.
 *
 * Switching the shared `openai` provider slot to a different backend (or
 * turning the current one off) used to leave the outgoing backend's API key
 * with nowhere permanent to go: F3 (Nachbesserung 6) parked it in
 * `providers.openai.displaced.apiKey`, a plain store field that survives
 * Enable/Disable within the running session but is stripped out of
 * localStorage before every write (`providerStore.ts`'s `partialize`), so a
 * restart between "switch away" and "switch back" always lost it.
 *
 * R9 adds a real place for it to live: a second, narrow account namespace in
 * the OS keychain (`secret_park_set`/`_get`/`_delete`, `src-tauri/src/commands/secret.rs`),
 * separate from the four fixed provider slots so it cannot collide with a
 * real account. This module is the thin TS-side glue: turning a backend's
 * display name into the `[a-z0-9-]{1,64}` id the Rust command requires, and
 * telling "no keychain on this device" apart from "the id was rejected"
 * (a bug here, not a fallback signal).
 *
 * What must never happen, checked by this module's own tests: the key value
 * itself, or a rejected id, reaching `console`, a thrown `Error` message, or
 * any other logged/telemetry surface.
 */

import { secretParkSet, secretParkGet, secretParkDelete } from '../api/backend'
import { log } from './logger'

/**
 * Mirrors the Rust `is_valid_backend_id` pattern (secret.rs): lowercase
 * letters, digits and hyphens only, 1 to 64 characters. A backend's display
 * name (free text: presets, or whatever a user typed for a custom
 * OpenAI-compatible endpoint) is turned into that shape here; a name that
 * collapses to nothing usable (all-symbols, empty) has no valid id and
 * parking is skipped rather than sent to Rust to be refused.
 */
export function slugifyBackendId(name: string): string | null {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  return slug.length > 0 ? slug : null
}

/**
 * The exact two strings `secret.rs` returns for "no keychain here" (Linux/
 * web stub, or the `LAZARUS_NO_KEYCHAIN` test switch), same check
 * `api/cloud/supabase.ts`'s `keychainMissing` already makes for the ordinary
 * `secret_*` commands. A `refused: ...` error (invalid id, a programming
 * error since ids are validated on this side too before the call) is
 * deliberately NOT one of these two, so it never gets mistaken for "this
 * device has no keychain" and silently swallowed the same way.
 */
export function isKeychainMissing(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('keychain unavailable') || msg.includes('keychain unsupported')
}

/**
 * Best-effort: park `apiKey` under `backendName`'s slug so it survives an
 * app restart while the backend is displaced. Returns whether it actually
 * landed in the keychain; the caller decides what to tell the user when it
 * did not (F3's "Switch Anyway" warning stays the fallback for exactly that
 * case, see ProviderConfig.tsx).
 *
 * Never throws: a keychain-missing failure is expected on some platforms, a
 * `refused:` failure is a real bug worth a log line, but neither should ever
 * take down the provider switch itself. Neither `backendId` (a display-name
 * slug, not a secret) nor `apiKey` is ever passed to `log`.
 */
export async function parkApiKeyForBackend(backendName: string, apiKey: string): Promise<boolean> {
  if (!apiKey) return false
  const backendId = slugifyBackendId(backendName)
  if (!backendId) return false
  try {
    await secretParkSet(backendId, apiKey)
    return true
  } catch (err) {
    if (!isKeychainMissing(err)) {
      log.error('parked-key: secret_park_set refused', { backendId })
    }
    return false
  }
}

/**
 * The other half: read a parked key back for `backendName` and, once read,
 * remove the parked entry (a park-then-restore is meant to be one-shot, not
 * a copy that keeps living in the keychain after the key is back in active
 * use). Returns `null` when there is nothing to restore, whether because
 * the keychain has no entry (nothing was ever parked, or the initial park
 * failed) or because there is no keychain at all on this device, so the
 * caller's own session-only fallback (`displaced.apiKey`, if it has one)
 * applies unchanged either way.
 */
export async function restoreParkedApiKeyForBackend(backendName: string): Promise<string | null> {
  const backendId = slugifyBackendId(backendName)
  if (!backendId) return null
  let value: string | null
  try {
    value = await secretParkGet(backendId)
  } catch (err) {
    if (!isKeychainMissing(err)) {
      log.error('parked-key: secret_park_get refused', { backendId })
    }
    return null
  }
  if (value === null) return null
  try {
    await secretParkDelete(backendId)
  } catch {
    // Best-effort cleanup only: a stray leftover entry under a valid id is
    // harmless (it is overwritten the next time this backend is displaced
    // again) and must not undo a restore that already succeeded.
  }
  return value
}
