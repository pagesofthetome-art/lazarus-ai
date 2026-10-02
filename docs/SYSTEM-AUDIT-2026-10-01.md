# Lazarus System Audit — 2026-10-01

## Scope

This audit covers the current Windows/web Lazarus project, its native Tauri layer, Developer Studio sandbox work, build checks, and project design notes. The draft APK is explicitly out of scope and is treated only as a future integration note.

## Current health

- **Frontend production build:** PASS (`vite build`).
- **Developer sandbox focused tests:** PASS — 3 files, 8 tests.
- **Native Rust check:** PASS (`cargo check`). One non-blocking path canonicalization warning is emitted for `C:\Users\Shadow`.
- **Frontend typecheck:** FAIL due to pre-existing/unresolved TypeScript issues outside the focused sandbox tests.

## High-priority findings

1. **Typecheck is not clean.** Current errors include unused imports/locals in `CodexView`, `Header`, `Sidebar`, and `useModels`; a missing `chunkForTts` export; stale test references to `cloud`, `cloudSwitch`, `memoryCloudOptIn`, and `cloudGateOpen`; and a `paidPlan` type mismatch in `cloudAuthStore`.
2. **Production build succeeds despite typecheck failures.** Release automation should require typecheck success before packaging an installer.
3. **Large frontend chunks remain.** Vite reports chunks over 500 kB, including the main application and PDF-related bundles. This is a performance risk, not a build blocker.
4. **Preview/runtime dependencies are optional.** Ollama is not available on PATH and SearXNG was unavailable during startup; the web shell still builds and runs, but those capabilities need runtime health indicators.

## Developer Studio status

Implemented and verified: newest-backup boot, two-backup rotation, isolated preview process, model shutdown before sandbox entry, staged file/plugin operations, Apply, Discard, Restore, preview overlay, and sandbox-focused tests.

Remaining integration work: full end-to-end tests with real plugin providers, verification of native preview lifecycle under restart/crash conditions, and release packaging checks.

## Design decisions recorded

- The EXE is the current canonical published runtime.
- Developer mode is an isolated working copy with the same installed capabilities but no automatically loaded model.
- Apply is explicit; Discard removes the sandbox.
- APK behavior is future-facing design guidance only until an actual Android implementation exists.
- Long multi-step tasks must continue automatically without requiring repeated “hello” or “continue” prompts.

## Recommended order

1. Fix the typecheck failures and stale test contracts.
2. Add end-to-end sandbox lifecycle tests, including crash and restart cleanup.
3. Add provider/plugin smoke tests using mocked adapters.
4. Split oversized frontend chunks before installer packaging.
5. Define the future APK update manifest only when Android implementation begins.
