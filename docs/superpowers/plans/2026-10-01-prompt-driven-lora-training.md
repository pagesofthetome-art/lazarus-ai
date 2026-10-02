# Prompt-Driven LoRA Training Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user request a LoRA in one plain-language prompt while Lazarus selects a compatible local trainer, optionally researches public web sources, prepares the dataset, runs the job, and registers the validated output.

**Architecture:** Add typed training requests, plans, adapters, and job status behind a trainer registry. Keep the existing Z-Image character trainer as the first adapter, add model-family selection and a plan preview, then add autonomous web research and additional image adapters without changing the user-facing prompt flow.

**Tech Stack:** React/TypeScript frontend, Zustand stores, Tauri Rust commands, existing ComfyUI model inventory, existing trainer environment, local filesystem staging, existing `fetchExternal` bridge.

**Spec:** `docs/superpowers/specs/2026-10-01-prompt-driven-lora-training-design.md`

## Global Constraints

- The first release targets local image LoRAs; text/code QLoRA and cloud training are separate future adapters.
- The default flow minimizes questions and may search public web sources automatically.
- The researcher must not bypass authentication, paywalls, robots restrictions, rate limits, or access controls.
- Downloaded content and model repositories are data only; Lazarus never executes code from them.
- Outputs are copied into the configured LoRA directory only after validation.
- An image LoRA is usable only when its base family matches an installed image/video model.
- Secrets are never passed through prompts or model metadata.

## Review Focus

- A prompt with no files must produce a clear autonomous-research status and a usable dataset or a plain-language reason it cannot.
- A prompt naming an unavailable model family must select an installed compatible family or explain the blocker.
- A web result with duplicate, corrupt, unrelated, private, or blocked content must be skipped without stopping the job.
- A trainer that cannot meet the GPU or VRAM requirements must not start and must leave no partial output registered.
- A cancelled or failed run must preserve status/logs and must never appear as an installed LoRA.

---

### Task 1: Define the training domain model and adapter registry

**Files:**
- Create: `src/api/lora-training/types.ts`
- Create: `src/api/lora-training/registry.ts`
- Modify: `src/api/trainer.ts` to re-export the existing trainer status types where needed

**Interfaces:**
- Produces `LoraTrainingRequest`, `LoraTrainingEnvironment`, `LoraTrainingPlan`, `LoraTrainingStatus`, `LoraTrainerAdapter`, and `LoraTrainerId`.
- Produces `registerLoraTrainer(adapter)`, `listLoraTrainers()`, and `selectLoraTrainer(request, environment)`.

- [ ] Define request fields for natural-language goal, optional target model, dataset sources, trigger word, output name, and autonomous research preference.
- [ ] Define plan fields for adapter, base model, dataset summary, estimated resources, user-facing explanation, and advanced settings.
- [ ] Define adapter result states for unsupported, missing-input, ready, running, complete, cancelled, and error.
- [ ] Register adapters by stable IDs and make selection deterministic by compatibility score.
- [ ] Keep the domain types independent of React and Tauri so future cloud adapters use the same contract.
- [ ] Verify with TypeScript compilation.

### Task 2: Wrap the existing Z-Image character trainer

**Files:**
- Create: `src/api/lora-training/adapters/zimage-character.ts`
- Modify: `src/api/trainer.ts`
- Modify: `src-tauri/src/commands/trainer.rs` only where the adapter needs a typed status or output-validation field

**Interfaces:**
- Consumes the existing `installCharacterTrainer`, `stageTrainingImage`, `startCharacterTraining`, `characterTrainingStatus`, and `cancelCharacterTraining` commands.
- Produces a `LoraTrainerAdapter` with ID `zimage-character-local`.

- [ ] Map the existing Z-Image readiness and base-file checks into `canTrain` and `prepare`.
- [ ] Reuse the existing staging and training commands instead of creating a second training process.
- [ ] Return the existing trigger-word, image-count, step-count, progress, cancellation, and output naming behavior through the common adapter status.
- [ ] Validate the expected `char_<name>_zimage.safetensors` output before reporting completion.
- [ ] Verify with TypeScript compilation and the existing production build.

### Task 3: Add local model and hardware scoring

**Files:**
- Create: `src/api/lora-training/model-selection.ts`
- Modify: `src/hooks/useModels.ts` or the existing model-inventory hook only where a typed environment snapshot is needed
- Modify: `src/lib/lora-compatibility.ts` if the shared architecture normalization needs training-family metadata

**Interfaces:**
- Produces `buildLoraTrainingEnvironment(models, trainerStatuses)` and `scoreTrainingCandidates(request, environment)`.

- [ ] Score candidates by task family, installed base compatibility, trainer readiness, VRAM fit, and Create workflow support in that order.
- [ ] Prefer local execution when a candidate is ready; return a plain-language blocker when none is ready.
- [ ] Keep unknown or unverified architecture families out of an executable plan.
- [ ] Include a short user-facing reason for the selected model and the strongest rejected alternative.
- [ ] Verify with TypeScript compilation.

### Task 4: Add autonomous public-web dataset research

**Files:**
- Create: `src/api/lora-training/research.ts`
- Create: `src/api/lora-training/dataset.ts`
- Modify: `src/api/backend.ts` only if the existing external-fetch bridge needs a bounded binary-download call
- Modify: `src-tauri/src/commands/download.rs` or a new Rust command only if dataset files need a jailed staging directory

**Interfaces:**
- Produces `researchLoraSources(request)`, `buildTrainingDataset(candidates)`, and a source manifest type containing URL, retrieval time, hash, status, and reason.

- [ ] Accept direct URLs and keyword goals as sources.
- [ ] Use existing external-fetch infrastructure for public pages and configured search providers.
- [ ] Skip authentication walls, paywalls, blocked responses, robots-denied sources, non-image downloads, corrupt files, and executable content.
- [ ] Deduplicate by content hash and perceptual image hash where available.
- [ ] Record provenance and acceptance/rejection reasons without requiring per-source approval.
- [ ] Generate plain captions from the prompt and source context, retaining a trigger word when one is chosen.
- [ ] Return the first blocking reason when the dataset cannot meet the adapter minimum.
- [ ] Verify with TypeScript compilation and the production build.

### Task 5: Add the prompt-driven training plan UI

**Files:**
- Create: `src/components/create/training/LoraTrainingPlan.tsx`
- Create: `src/components/create/training/LoraTrainingStatus.tsx`
- Modify: `src/components/create/experimental/SpecialIntentControls.tsx`
- Modify: the relevant Create store with training-request and plan state

**Interfaces:**
- Consumes `LoraTrainingRequest`, `LoraTrainingPlan`, `LoraTrainingStatus`, and registry selection from Tasks 1–4.
- Produces a single prompt entry point, a compact plan preview, and status/progress controls.

- [ ] Treat phrases such as “create a LoRA for…” as a training intent without exposing adapter terminology.
- [ ] Show only missing inputs: normally source files, a target subject, or an unavoidable model choice.
- [ ] Show autonomous research progress as a short summary rather than a permission checklist.
- [ ] Keep advanced settings collapsed by default.
- [ ] Add explicit start, cancel, retry, and inspect-dataset actions.
- [ ] Keep navigation and existing Create controls unchanged.
- [ ] Verify with TypeScript compilation and the production build.

### Task 6: Add SDXL and Flux adapter boundaries

**Files:**
- Create: `src/api/lora-training/adapters/sdxl.ts`
- Create: `src/api/lora-training/adapters/flux.ts`
- Create: `src-tauri/src/commands/lora_training.rs` for pinned runtime invocation and jailed output handling
- Modify: `src-tauri/src/main.rs` to register the command
- Modify: `src/api/lora-training/registry.ts` to register both adapters

**Interfaces:**
- Each adapter implements the common `LoraTrainerAdapter` contract and consumes the same dataset and model-selection plan.

- [ ] Require an installed matching SDXL or Flux base model and explicit hardware readiness before execution.
- [ ] Use pinned trainer/runtime versions and a dedicated working directory outside the application bundle.
- [ ] Stream phase, progress, and logs through the existing Tauri status pattern.
- [ ] Validate output metadata and reject incomplete or wrong-family files.
- [ ] Make the adapters unavailable with a clear reason until their runtime and base files are installed.
- [ ] Verify with TypeScript compilation and the production build.

### Task 7: Register outputs and persist recoverable job state

**Files:**
- Create: `src/api/lora-training/output.ts`
- Modify: the model refresh/indexing path used by `useModels`
- Modify: the download/job store only if it is the established persistence location for long-running local jobs

**Interfaces:**
- Produces output validation, registration, cancellation, and recovery helpers used by the UI and adapters.

- [ ] Confirm file existence, nonzero size, expected extension, readable metadata, and matching base family.
- [ ] Move or copy only validated outputs into the configured LoRA directory.
- [ ] Persist enough job state to recover after leaving the page or restarting the app.
- [ ] Refresh ComfyUI inventory after completion and expose the new LoRA immediately.
- [ ] Keep failed and cancelled artifacts out of the installed list.
- [ ] Verify with TypeScript compilation and the production build.

### Task 8: Add cloud adapter seam without enabling uploads by default

**Files:**
- Create: `src/api/lora-training/adapters/cloud.ts`
- Modify: plugin/provider settings only to store an explicitly configured cloud trainer

**Interfaces:**
- Produces a disabled-by-default adapter that can explain when a local plan cannot run and what cloud configuration is missing.

- [ ] Never upload a dataset without an explicit configured provider and a start action.
- [ ] Reuse the same plan, dataset manifest, status, and output-validation contract.
- [ ] Keep cloud configuration separate from local model credentials.
- [ ] Verify with TypeScript compilation and the production build.

## Verification

- Run TypeScript compilation after each adapter or UI slice.
- Run the production Vite build after the complete local flow.
- Manually verify: prompt with attached files, prompt requiring autonomous research, no-compatible-model case, cancellation, and completed output refresh.
