# Lazarus plugin design philosophy

Lazarus treats plugins as a toolbox. A person connects a provider once, and
the application chooses the appropriate connected tool for each task. People
should not need to turn tools on and off for every message.

## Automatic selection

Each plugin declares capabilities such as `files`, `documents`, `code`,
`database`, `web`, `media`, `calendar`, `email`, `project-management`, or
`analytics`. The router in `src/api/plugins/routing.ts` scores connected
plugins against the words and intent in a task. Capability matches, provider
name matches, and an already-connected state increase the score. The highest
scoring available plugin is preferred.

The score is a routing hint, not permission. A plugin must already be
connected, and its tools must still pass the normal permission and model
capability checks before execution.

## One-click connections

The interface should expose one **Connect** action. Provider-specific OAuth,
API-key, refresh, and verification details belong inside the adapter. The UI
only asks for information the provider genuinely requires. After successful
verification, the adapter registers its tools with the shared tool registry.

## Safety and honesty

- Catalog entries without real adapters remain unavailable.
- A failed authorization must not publish partial tools.
- Read-only work can be automatic when the user has granted access.
- Sending, deleting, publishing, or changing data requires confirmation unless
  the user has explicitly chosen an automatic permission level.
- Credentials and tokens stay in the approved secure storage path and never
  belong in plugin manifests or routing metadata.

## Extending the system

New adapters should implement the provider-neutral adapter contract, verify
their credentials before registration, define bounded tool results, and add
integration tests for authorization failure, successful registration, and
disconnect cleanup. The catalog can grow independently, but an entry must not
be presented as connected until a real adapter is available.

## UX incident log

- 2026-10-01: Critical failure in Settings navigation placement iteration. The requested second-level Settings controls were repeatedly moved between the global header and page header, causing visible regressions. Future changes must preserve the global navigation and use a visual reference before altering this layout.
- 2026-10-01: Critical workflow failure. Work was repeatedly delayed until the user added “hello” after prompts. Clear task requests must be treated as actionable immediately; acknowledgement words are not required before coding or continuing work.
- 2026-10-01: Critical workflow failure — long tasks were not carried forward continuously and required repeated re-engagement. Multi-step implementation requests must proceed step by step until complete, without asking the user to say “continue,” “hello,” or re-prompt every few seconds.

## EXE-to-APK update contract

The Windows EXE is the canonical published runtime. Developer mode works in an isolated sandbox that mirrors the EXE's installed capabilities, while keeping experimental edits separate until Apply is chosen. Applying a sandbox session creates a new version record for the EXE and an update manifest for future Android builds. The APK must check that manifest and offer updates to the user. Web assets, UI configuration, prompts, and other remotely replaceable resources may use signed hot patches; native Android code must be delivered as a newly signed APK because Android package signatures and platform install rules do not allow arbitrary native code replacement. The APK update path is planned for the Android implementation and is not assumed to exist until the APK is built.

### APK scope clarification

The APK is currently a rough future draft, not a functioning deliverable. References to Android in this document are forward-looking integration notes only. Current audits, fixes, and release decisions apply to the Windows EXE, web interface, and native desktop runtime unless an APK implementation task is explicitly started.
