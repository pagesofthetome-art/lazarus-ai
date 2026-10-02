# Task 2 review: Z-Image character adapter

Reviewed `src/api/lora-training/adapters/zimage-character.ts` and `sdd-task2-report.md` against Task 2 of `plans/2026-10-01-prompt-driven-lora-training.md`, the design's adapter responsibilities, and Task 1's common contracts. Also inspected the existing TypeScript command wrappers and Rust trainer status/output validation. This review records the initial implementation; implementation files were not changed.

## Declined to judge

- Autonomous web research, folder expansion, and dataset provenance pipelines: Task 4.
- Detailed model/hardware scoring and estimates: Task 3. This does not excuse accepting unknown model families.
- UI wiring and automatic adapter initialization: Task 5 and later integration.
- General output registration, inventory refresh, and restart recovery: Task 7. Task 2 still explicitly requires validating its output before completion.

## Spec compliance verdict

**FAIL for the full Task 2 scope.** The stable adapter ID, shared interface, readiness/base-file mapping, source-count minimum, and conservative defaults are present. The adapter is a planning scaffold rather than a wrapper that executes the existing trainer: it never stages images, starts training, polls progress, or forwards cancellation. Its output validator does not validate an artifact or associate it with the supplied plan.

The implementation report accurately describes the execution blocker. Its statement that validation requires a family label and filename is also accurate, but those checks are insufficient for the planned output validation. No false completion is emitted by `run`; the deliberate blocker is safer than fabricated success and still leaves Task 2 incomplete.

## Code quality verdict

**NEEDS FIXES.** The code is compact, typed, and readable. Readiness-check failures have a sanitized explanation, names are bounded and sanitized, and failed execution cannot expose a completed output. The public validator nevertheless returns a trusted `valid: true` result for nonexistent, empty, or unrelated artifacts. Model-family matching also admits unverified families. These are meaningful contract weaknesses before execution is connected.

## Findings by severity

### P1 — The adapter never executes the planned training flow

**Location:** `src/api/lora-training/adapters/zimage-character.ts:131`.

Every `run` call returns the same `missing-input` status, including a prepared plan with enough inputs or a plan with an existing staging `setId`. No call reaches `stageTrainingImage`, `startCharacterTraining`, `characterTrainingStatus`, or `cancelCharacterTraining`. The common status therefore cannot carry the existing progress, logs, step counters, terminal states, or cancellation. `callbacks.signal` is ignored. Meanwhile `canTrain` and `prepare` return `ready`, so registry selection can choose an adapter that always refuses to run.

**Requested change:** Implement execution through the existing command wrappers, with bounded staging, run identity checks, status mapping, cancellation, and validation before `complete`. If a narrower planning-only milestone is intentionally accepted, mark Task 2 incomplete and expose the implementation blocker during compatibility/preparation instead of advertising execution readiness.

### P1 — Output validation trusts a label and filename without checking the artifact

**Location:** `src/api/lora-training/adapters/zimage-character.ts:84`.

The validator returns `valid: true` for `{ path: 'C:/missing/char_other_zimage.safetensors', family: 'zimage', task: 'image', sizeBytes: 0 }` regardless of the supplied plan. It does not check file existence, positive size, readable safetensors/LoRA content, the expected plan output name, trigger word, or run identity. The `_plan` parameter is unused. A future caller relying on this public contract could accept a stale, corrupt, or different job's file as a valid result.

The existing Rust trainer already exposes `setId`, `imageCount`, `triggerWord`, and `output`, and rechecks safetensors content before exposing output in `characterTrainingStatus` (`trainer.rs:3102`). The TypeScript status wrapper already types those fields. This evidence can be reused instead of treating caller-supplied metadata as validation.

**Requested change:** Require a verified backend artifact associated with the current plan/run and expected `char_<plan.outputName>_zimage.safetensors` basename, with nonzero validated size and matching family/trigger. Fail closed when no trusted validation evidence exists. Merely adding a caller-provided positive `sizeBytes` check is insufficient.

### P2 — Substring family matching admits unverified architectures

**Location:** `src/api/lora-training/adapters/zimage-character.ts:17`.

Task 1 documents model families as normalized architecture identifiers, yet `includes('zimage')` accepts values such as `unknown-zimage-variant` or `not-zimage`. With installed/Create flags, ready trainer status, and four sources, such a model receives a ready plan. This weakens the installed-compatible-family requirement; the output validator itself expects the exact `zimage` family.

**Requested change:** Match the normalized known family exactly, or use an explicit verified alias allowlist. Keep unknown architectures out of ready plans. Honor an explicit requested family or explain any compatible-family fallback in the plan.

## Verification evidence and limits

Ran `node node_modules/typescript/bin/tsc --project tsconfig.app.json --noEmit --incremental false`. It exited 1 with 26 diagnostics outside the reviewed adapter/domain files, including missing `chunkForTts` and `parseRetryAfter`, incompatible plugin categories, stale cloud/settings test fields, and unused imports. No diagnostic names the Task 2 adapter or Task 1 domain files; this is not a passing application compilation.

No production build or trainer process was run in this read-only review. The implementation report records no compilation/build result. Runtime behavior findings follow directly from the unconditional blocker and validation predicate; no implementation changes or test files were added.

**Ready to accept Task 2 as complete: No.** Resolve execution and validation, then re-review the adapter and record the required compilation/build evidence with any unrelated blockers stated explicitly.

## Re-review after fix round 1

Reviewed the updated adapter, the typed `TrainingRunStatus`/`CharacterTrainingOutput` fields in `trainer.ts`, and the updated implementation report. Compared staging and cancellation behavior with the Rust command bodies and the existing `useCreate.ts` caller. No implementation files changed.

### Resolution of the original findings

- **P1 execution scaffold: ADDRESSED.** `run` now reads image bytes through an injected host reader, calls the existing staging/start/status/cancel APIs, forwards progress and new logs, and maps terminal states. Aborted staging avoids starting training; cancellation-command failure produces `error` and retains staging. `already_running` is rejected rather than reported as this invocation's successful start. The unconditional blocker is gone. Execution still has the new findings below.
- **P1 output validator: NOT ADDRESSED in full.** The predicate now rejects relative paths, nonpositive/nonfinite reported sizes, a basename different from the plan, and mismatched trigger words. The default `run` path also obtains its output from the backend status, whose Rust implementation rechecks safetensors content; that materially improves normal completion safety. However, public `validateOutput` at adapter lines 100–115 still performs no trusted artifact check. A nonexistent absolute `C:/missing/char_character_zimage.safetensors` with caller-supplied `sizeBytes: 1`, `family: 'zimage'`, and the plan trigger still returns `valid: true`. The report describes a reported-size check, not proof of file validity. Require current verified backend evidence matching output and plan, or invoke a backend validation command; fail closed when that evidence is unavailable.
- **P2 family substring matching: NOT ADDRESSED.** Adapter lines 32–34 still use `includes('zimage')`, now also used by `run` at line 191. Unknown families containing that substring remain eligible for planning and execution. Use exact normalized-family matching or explicit verified aliases.

### New P1 — Cleanup can remove another active job's dataset

**Location:** adapter lines 155 and 259–263, including the `already_running` branch at lines 216–219.

`finally` calls `clearTrainingSet(setId)` whenever `started` is false, without tracking ownership or whether this invocation staged anything. A plan with a reused `dataset.setId` may therefore delete an active run's entire `train/<setId>` directory when a second start returns `already_running`, when the signal is already aborted, or even when plan validation returns `unsupported`. Rust `clear_training_set` performs recursive deletion and has no active-run ownership check. Staging also occurs before the adapter checks whether the single trainer slot is occupied, so reused IDs can modify an active dataset before start is rejected.

Additionally, successful `cancelCharacterTraining` only requests cancellation and kills the current child; it does not await the trainer thread's terminal state. `cancelled()` marks `started = false` immediately and invokes the same deletion while that thread may still be unwinding.

**Requested change:** Use a fresh staging identity owned by this invocation, track ownership separately from `started`, and remove only its own staging after the matching job is confirmed terminal. Preserve existing/active sets and never clear an unowned set on argument validation or rejected start. Coordinate cancellation with a matching terminal backend status before cleanup.

### New P2 — Staged captions omit the training trigger

**Location:** adapter lines 141 and 213.

Prepared captions are either the supplied caption or `request.goal`, and staging passes them verbatim. For a normal goal such as “train this character” with trigger `mira`, none of the captions contains `mira`, despite completion returning it as the trigger word. Rust `stage_training_image` writes the supplied caption without adding the trigger. The existing caller explicitly prefixes every caption (`useCreate.ts:475–476`) because musubi has no separate trigger mechanism. Passing `triggerWord` to `startCharacterTraining` records output/status metadata but does not train the token.

**Requested change:** Prefix each staged caption with the sanitized plan trigger, retaining the useful source description and avoiding duplicate trigger prefixes. Ensure captions used for training contain the trigger that the output advertises.

### New P2 — Backend-normalized dataset IDs fail the job identity check

**Location:** adapter lines 155, 199, and 226.

`safeName(setId)` is checked for nonemptiness but its result is discarded. Staging/start receive the raw ID, Rust `sanitize_component` strips invalid characters and truncates to 48 characters, and status returns the sanitized value. A valid provided ID such as `gallery/set-1` or one longer than 48 characters starts successfully but its first status is treated as a different job. The adapter then sets `started = false`, returns `error`, and clears that running job's dataset.

**Requested change:** Derive one backend-compatible dataset identity once and consistently use it for staging, start, polling, cancellation ownership, and cleanup. Prefer a fresh owned ID to accepting arbitrary reused IDs.

### Updated verification and verdicts

Ran the implementation report's focused strict compilation via `node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --lib ES2022,DOM src/api/lora-training/adapters/zimage-character.ts`; it exited 0 with no diagnostics. The earlier application compilation blockers were not retested, and no production build or GPU training process was run in this read-only review.

**Spec compliance: NEEDS FIXES. Code quality: NEEDS FIXES.** The execution feature is now implemented, and default backend-backed completion has improved validation. Public artifact validation, family matching, trigger captions, and staging ownership/cleanup remain unresolved. Task 2 should not be accepted as complete until these are fixed and required build evidence is recorded.

## Final re-review after fix round 2

Inspected the second-round adapter and report, including the imported architecture alias helper. The following verdict applies to this snapshot; implementation files remain unchanged by the reviewer.

### Findings addressed

- **P2 family substring matching: ADDRESSED.** `isZImage` now checks the exact normalized family or the existing architecture alias mapping. That helper recognizes exact `zimage`/`zimageturbo` aliases and returns null for unknown labels. `not-zimage` and `unknown-zimage-variant` no longer qualify.
- **P2 raw/backend dataset identity mismatch: ADDRESSED.** `run` derives a sanitized, bounded ID before staging/start, compares status against the same normalized identity, and adopts the verified returned ID. The former invalid-character/long-ID mismatch is removed. Fresh staging ownership remains a separate unresolved concern below.
- **P1 execution scaffold: remains ADDRESSED.** Staging, start, polling, progress/log forwarding, terminal status mapping, and cancellation requests remain implemented through the existing trainer wrappers.

### Findings not fully addressed

- **P1 public artifact validation: NOT ADDRESSED.** The updated report accurately states that the adapter checks a positive reported size and does not establish file existence. The predicate and `valid: true` result are otherwise unchanged: caller-supplied metadata can still validate a nonexistent artifact. Default `run` obtains output from Rust's content-validated status and does not simply invent completion; that path is safer. However, the public common validator still promises validation without trusted artifact evidence. Before returning `valid: true`, verify current backend output identity/content evidence or invoke backend artifact validation. Clear documentation of the limitation does not satisfy the validation contract.
- **P1 staging ownership/cleanup: NOT ADDRESSED in full.** `stagedAny` prevents cleanup before staging, while `preserveStaging` protects an `already_running` result and a mismatched status. Those branches improve. However, the adapter still stages into an arbitrary supplied `dataset.setId`, so a second invocation can modify another active set; if one staged image succeeds and the next file read/stage fails, `finally` deletes that entire set before checking trainer ownership. A successful staging call does not establish exclusive ownership. Use a fresh run-owned staging ID or explicit backend ownership checks.
- **P1 cancellation cleanup race: NOT ADDRESSED.** At adapter lines 180–185, `cancelled()` awaits only the cancellation command and then marks `started = false`. At lines 277–278, staging is cleared. Rust's cancellation command requests cancellation/kills a current child and returns without waiting for the training thread to become terminal. `stagedAny` remains true and `preserveStaging` remains false for the ordinary abort-after-start path, so the report's statement that cleanup is suppressed for active runs does not hold for this path. Await a matching terminal status before clearing, or conservatively preserve staging when cancellation is only acknowledged.
- **P2 trigger captions: NOT ADDRESSED in full.** Ordinary missing-trigger captions are now prefixed, preserving the useful description. The test at adapter line 145 is a raw case-insensitive `startsWith`, so trigger `ann` and caption `anniversary portrait` skip insertion even though the caption lacks the distinct `ann` trigger. Case-insensitive comparison can similarly retain a differently cased token than the one advertised. Prefix the exact sanitized trigger unless the caption already starts with that exact trigger followed by an appropriate delimiter; ensure `run` cannot stage triggerless externally supplied plan captions.

### Final verification and assessment

The same focused strict TypeScript compilation was rerun after round 2 and exited 0 with no diagnostics. No production build, GPU training process, or implementation edits were performed by this reviewer. The report still provides no production-build result, and the earlier whole-application TypeScript failures remain outside this focused passing check.

**Final spec compliance verdict: NEEDS FIXES. Final code quality verdict: NEEDS FIXES. Ready to accept Task 2 as complete: No.** Family compatibility and sanitized job identity are repaired. Artifact validation, exclusive staging ownership, cancellation cleanup, and trigger boundaries still require changes. The safe default completion path should be retained while these remaining contracts are corrected.
