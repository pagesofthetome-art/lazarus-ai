# Task 1: training domain model and adapter registry

Completed the Task 1 contract from `plans/2026-10-01-prompt-driven-lora-training.md` against the corresponding design specification.

## Files

- Created `src/api/lora-training/types.ts`.
- Created `src/api/lora-training/registry.ts`.
- Existing trainer status interfaces are already exported from `src/api/trainer.ts`; no change was needed there.

## Interfaces

- `LoraTrainingRequest`: natural-language goal, task/intent, optional model identity/family, file/gallery/folder/URL/search sources, trigger word, output name, and autonomous research preference.
- `LoraTrainingEnvironment`: normalized model inventory, explicit hardware availability or unknown values, adapter runtime/base readiness, and optional output directory.
- `LoraTrainingPlan`: adapter/base selection, staged dataset and provenance manifest, resource/time estimates, explanation, rejected alternative, output identity, and advanced settings.
- `LoraTrainingStatus`: unsupported, missing-input, ready, running, complete, cancelled, and error states; progress/log fields; a complete state requires an output record.
- `LoraTrainerAdapter`: capability check, preparation, execution callbacks with cancellation signal, and output validation. Runtime operations are asynchronous; capability checks may be synchronous or asynchronous.
- `LoraTrainerId`: known stable IDs plus extensibility for future adapters.
- Registry exports `registerLoraTrainer`, `listLoraTrainers`, and asynchronous `selectLoraTrainer`. Registration rejects malformed/conflicting IDs, listing sorts by ID, selection prioritizes readiness then score then ID. A failed capability check does not stop other adapters from being evaluated. Selection never stages inputs or starts a job.

## Verification

- Ran `node node_modules/typescript/bin/tsc -b --force`: failed on existing errors outside these two new files, including missing voice/cloud exports, stale settings/store test fields, and unused imports. No diagnostics referenced the new training contract files.
- Ran `node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2023 --module ESNext --moduleResolution bundler --verbatimModuleSyntax --noUnusedLocals --noUnusedParameters --erasableSyntaxOnly src/api/lora-training/types.ts src/api/lora-training/registry.ts`: passed with exit code 0.

## Decisions and concerns

- Kept domain contracts free of React/Tauri imports. Cancellation uses the standard `AbortSignal` contract.
- Compatibility checks own hardware and family validation; registry scoring must not be used to bypass those checks. `null` hardware/family values mean unverified.
- The registry intentionally has no built-in adapters in this task; later adapter slices register themselves.
- Output validation and runtime behavior remain adapter responsibilities. The completion type requires an output record but does not itself inspect a file.
- No commit was made because this workspace is not a Git checkout. Scope was limited to Task 1.

## Review fix round 1

- Confirmed that an unsupported candidate previously hid a readiness-check exception from another adapter.
- Updated `selectLoraTrainer` to return `status: 'error'` and the first sanitized failure when no ready or missing-input candidate exists. Ready and missing-input candidates keep their existing precedence. Unsupported candidates remain available in the returned diagnostics.
- Failure ordering still follows stable adapter IDs, and exception internals are never placed in the user-facing reason. The public contract is unchanged.
- Ran `node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2023 --module ESNext --moduleResolution bundler --verbatimModuleSyntax --noUnusedLocals --noUnusedParameters --erasableSyntaxOnly src/api/lora-training/types.ts src/api/lora-training/registry.ts`: passed with exit code 0.
