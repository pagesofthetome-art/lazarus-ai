# Task 1 review: training contracts and adapter registry

Reviewed `src/api/lora-training/types.ts`, `src/api/lora-training/registry.ts`, and `sdd-task1-report.md` against `plans/2026-10-01-prompt-driven-lora-training.md` and `specs/2026-10-01-prompt-driven-lora-training-design.md`. Inspected `src/api/trainer.ts` to confirm that the existing trainer status interfaces are already exported. No implementation files were changed.

## Spec compliance verdict

**PASS for the Task 1 scope.** All six named types and all three registry functions are present. The request includes the natural-language goal, target model, dataset sources, trigger word, output name, and research preference. The plan includes adapter/base identity, dataset summary and provenance, estimates, explanation, and advanced settings. The status contract represents every required state and requires an output on completion. The four adapter responsibilities match the design.

Registration validates stable IDs and rejects conflicting registrations. Selection evaluates adapters in stable ID order and ranks by readiness, descending compatibility score, and ID as a deterministic tie-breaker. Prioritizing readiness is consistent with selecting an executable compatible trainer; the detailed model/hardware scoring belongs to Task 3. Selection calls only `canTrain` and does not stage inputs or execute training.

The contracts import neither React nor Tauri. `AbortSignal` is a standard cancellation contract suitable for later adapters. Leaving `trainer.ts` unchanged is justified because its existing `TrainerStatus`, `TrainerInstallState`, and `TrainingRunStatus` interfaces are exported already. The empty initial registry and deferred runtime/output validation are appropriate for this slice.

## Code quality verdict

**PASS after fix round 1.** The original P2 failure-reporting issue is addressed; see the re-review below. The code is small, readable, and dependency-free, and the completion/validation discriminated unions give useful type guarantees. The focused strict TypeScript compilation passes. No unresolved findings remain for Task 1.

## Findings by severity

### P2 — An unsupported candidate masks a failed readiness check

**Resolution:** ADDRESSED in fix round 1. The description and evidence below record the original issue.

**Location:** `src/api/lora-training/registry.ts:70` (unsupported return), with failures collected at lines 40–52.

When one adapter throws in `canTrain` and every successfully evaluated adapter reports `unsupported`, the presence of any unsupported candidate causes an immediate `unsupported` result. The collected failure is discarded. For example, an image trainer readiness failure alongside a text-only adapter produces `unsupported` with the reason “Text trainer cannot train image LoRAs.” The caller receives no indication that the relevant trainer could not be checked and cannot distinguish unsupported capability from a readiness error.

This is especially relevant as additional adapters register: a harmless unsupported adapter changes an otherwise correctly reported readiness error into an unrelated capability blocker. It undermines the design's plain-language failure explanation without affecting the successful-ready selection path.

**Requested change:** Preserve successful ready/missing-input selection, but when there is no supported candidate and any capability check failed, return `error` with the existing sanitized failure reason (or expose equivalent structured failed-check diagnostics). Preserve the unsupported candidates for inspection. An all-successful, all-unsupported result should continue to return `unsupported`.

**Evidence:** A review-time, in-memory probe registered `image-local` whose `canTrain` throws and `text-local` whose `canTrain` returns `{ status: 'unsupported', score: 0, reason: 'Text trainer cannot train image LoRAs.' }`. The selection returned `status: 'unsupported'`, `adapter: null`, and the text adapter's reason; the image readiness failure was absent. The probe created no files and started no training.

## Verification and limits

- Independently ran the focused compiler command from the implementation report: `node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2023 --module ESNext --moduleResolution bundler --verbatimModuleSyntax --noUnusedLocals --noUnusedParameters --erasableSyntaxOnly src/api/lora-training/types.ts src/api/lora-training/registry.ts`. It passed with exit code 0.
- Reproduced the mixed readiness-failure/unsupported case using the actual registry code transpiled in memory.
- The report states that repository-wide compilation failed on unrelated existing errors. This review did not rerun that broad compilation or independently establish that those errors predate the change.
- Static inspection confirms Task 1 contract coverage and selection ordering. Real trainer, dataset, hardware, cancellation, and output validation behavior belongs to later implementation slices and is not validated by this review.

## Fix round 1 re-review

**Finding verdict: ADDRESSED. Spec compliance: PASS. Code quality: PASS for Task 1.**

Reviewed the revised `registry.ts` and the appended implementation report. The failure branch now runs after selecting any ready/missing-input candidate and before returning an unsupported result. Consequently, when no ready/missing-input adapter exists, a failed capability check returns `error`, `adapter: null`, and the first sanitized failure reason. Successfully evaluated unsupported candidates remain in the result.

Independently reran focused strict TypeScript compilation; it passed with exit code 0. Review-time in-memory assertions against the revised registry also passed for:

- A failed image readiness check combined with an unsupported adapter: returns the sanitized error and retains the unsupported candidate.
- Multiple failed checks registered in reverse ID order: reports the first failure by stable ID and excludes exception internals.
- Ready and missing-input candidates combined with a failed adapter: retain their previous precedence.
- All-successful unsupported candidates and an empty registry: retain unsupported outcomes.
- Readiness, descending score, and ID tie-break ordering across three registration permutations: select the same adapter and return the same candidate order.

The probe's `prepare`, `run`, and `validateOutput` methods would throw if called; none were called. No implementation or test files were changed. No additional findings were identified.
