# Lazarus identity and hosted-service audit

**Reviewed:** 2026-10-01  
**Scope:** desktop identity, the former first-party hosted provider and media service, bundled model catalogs, upgrade cleanup, and references in current documentation.

## Result

The shipped product identity is Lazarus. The former first-party LU account, hosted inference, hosted media, and hosted model catalog are not reachable from the current app. User-configured providers such as OpenAI, Anthropic, OpenRouter, Ollama, and compatible endpoints remain available; their URLs and credentials come from the user’s settings.

The retired provider ID is retained as a disabled compatibility tombstone so profiles from older releases fail closed. Legacy app-data names, OS credential names, and installer identifiers remain only where Lazarus must migrate user data, remove old credentials, or upgrade an existing installation.

## Findings and changes

- Package, Cargo package, Tauri product, application identifier, main executable, and bundled llama.cpp sidecar use Lazarus names. The Windows installer recognizes the previous product and executable names only to stop and remove the old install during upgrade.
- First-party cloud and Supabase endpoint values are empty. The retired request client returns HTTP 410 before any fetch, and the retired provider cannot be constructed by the provider registry.
- The bundled hosted-model seed and media-generation catalogs are empty. The old persisted hosted catalog is no longer hydrated or backed up; startup deletes its cached catalog, account-session, and obsolete notice keys.
- Hosted account, checkout, hosted LoRA, hosted voice, and hosted generation UI surfaces are removed. Current docs say remote model requests use the provider configured by the user. Old v2.5.9 release notes label the hosted render service as retired.
- Trainer errors no longer direct users to the unavailable hosted service. Stale code comments that named the old source repository or described its hosted provider as current were generalized.
- User-configured provider credentials and unrelated local data are preserved. The app-data migration continues to read the old product paths and store keys so upgrades do not strand chats, settings, model downloads, or credential-store entries.

## Checks

The focused, dependency-free audit passed: `node --test scripts/identity-overhaul-audit.test.mjs` (8 passed, 0 failed). `node --check scripts/identity-overhaul-audit.test.mjs` also passed. The audit checks the no-network tombstones, empty catalogs, deleted service surfaces, Lazarus package metadata, preserved provider slots, current documentation, and source-import resolution.

The full Vitest suite, TypeScript build, and packaged desktop build were not run: this workspace has no `node_modules`, and only Node plus a fallback `pnpm` command are available. Rust tests were not run because this project checkout has no `Cargo.toml` and `cargo` is unavailable. No dependencies were installed as part of this audit.

## Deliberate compatibility remnants

The strings `lu-cloud`, `locally-uncensored`, `lu-labs`, the previous Tauri identifier, and the old Windows executable names may still appear in narrowly scoped migration, cleanup, or fail-closed code. They are not service destinations or active product metadata. Historical release records remain historical; current guidance describes the retired service accurately.
