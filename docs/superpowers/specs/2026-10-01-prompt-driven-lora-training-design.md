# Prompt-Driven LoRA Training

## Goal

Let a user request a LoRA in ordinary language, such as “create a LoRA for
this character using the best model on this computer,” while Lazarus selects a
compatible local model and trainer, asks only for missing training material,
shows a short reviewable plan, runs the job, and registers the resulting LoRA.

The first release targets local image LoRAs. It supports the existing Z-Image
character trainer and adds adapter boundaries for SDXL and Flux. Text/code
QLoRA and cloud training remain future adapters using the same job contract.

## User experience

1. The user writes a training request in the normal assistant input.
2. Lazarus classifies it as an image LoRA request and extracts a goal, target
   model family, optional trigger word, output name, and style/character hints.
3. Lazarus checks installed model inventory, GPU memory, trainer availability,
   and the attached or selected source files.
4. If files are missing, it asks for them in one short question. A training
   request cannot silently invent a dataset.
5. Lazarus shows a compact plan: selected base model, trainer, input count,
   expected time range, output name, and the few settings that materially
   affect the result.
6. The user approves the plan. The trainer runs locally with progress,
   logs, cancellation, and recovery.
7. The output is validated, copied to the configured LoRA folder, indexed by
   the model inventory, and offered in Create.

The UI avoids technical terminology by default. An Advanced disclosure can
show rank, learning rate, steps, resolution, and precision for experienced
users.

## Adapter architecture

Create a `LoraTrainerAdapter` interface with four responsibilities:

- `canTrain(request, environment)`: report whether the adapter supports the
  requested task, base family, hardware, and dataset.
- `prepare(request, environment)`: validate files, derive captions, choose
  safe defaults, and return a concrete plan without starting work.
- `run(plan, callbacks)`: execute through a pinned local runtime and report
  progress, logs, output paths, and cancellation.
- `validateOutput(output, plan)`: verify the output is a readable LoRA,
  records its base family and trigger metadata, and rejects incomplete files.

Initial adapters:

- `zimage-character-local`: wraps the existing musubi trainer commands.
- `sdxl-local`: uses a pinned SDXL LoRA training runtime and writes to the
  ComfyUI `loras` directory.
- `flux-local`: uses a pinned Flux-compatible trainer and requires a matching
  installed Flux base and sufficient VRAM.

Later adapters can implement the same contract for `text-qlora-local`,
`cloud-image`, and `cloud-text` without changing the user flow.

## Model and hardware selection

The selector scores installed models and adapters using:

1. Task compatibility: character, style, subject, or other requested goal.
2. Model-family compatibility: the LoRA must be trained for the selected base.
3. Hardware fit: VRAM, system memory, storage, and supported GPU features.
4. Local readiness: installed runtime, base files, and trainer health.
5. Output usefulness: the model must be usable by the current Create workflow.

If no local adapter meets the requirements, Lazarus explains why and offers a
cloud adapter only when the user has configured one. No cloud upload happens
automatically.

## Dataset handling

The prompt can describe the desired result, but training still requires source
examples. Lazarus may use attached files, selected gallery items, or a user
chosen folder. It can generate captions and a trigger word, but it must show
the count and preview before training. Paths are sanitized and training is
confined to the approved dataset and trainer directories.

## Autonomous web research mode

When the user does not provide enough examples, Lazarus may search public web
sources automatically and build a candidate dataset with minimal interruption.
The default flow does not require the user to approve each URL. Lazarus records
the source URL, retrieval time, content hash, license or usage notice when
available, and the reason each item was accepted or rejected. It deduplicates,
filters unrelated or corrupt files, generates captions, and proceeds when the
dataset reaches the selected trainer's minimum.

The researcher can follow public URLs and use configured search providers, but
it must not bypass authentication, paywalls, robots restrictions, rate limits,
or access controls. It never executes code from a downloaded page or model
repository. A real person's likeness is treated as a normal training target
only when the user provides the request and source material; the system does
not infer consent or collect private personal data.

The user sees a short status summary instead of a permission checklist:
“Found 18 usable references from 4 public sources; removed 7 duplicates and 3
unrelated files.” A full source manifest remains available for review or
deletion after the dataset is built.

## Security and reliability

- Trainers are pinned to known environments and versions.
- The app never executes code found inside a dataset or model repository.
- Downloaded trainer artifacts are stored outside the application bundle and
  are checked before use.
- Secrets are not passed through prompts or model metadata.
- Jobs are cancellable and leave a resumable status record.
- Outputs are written to the configured model directory only after validation.

## Compatibility and failure behavior

An image LoRA is shown as usable only when its base family matches an
installed image/video model. Text/code adapters are kept out of the ComfyUI
image LoRA list and will use their own adapter registry later.

The plan screen must identify the first blocking issue in plain language:
missing examples, unsupported model family, insufficient VRAM, missing base
files, or unavailable trainer. A failed run preserves logs and never presents
an incomplete file as installed.

## Implementation slices

1. Define the typed request, plan, status, and adapter interfaces.
2. Wrap the current Z-Image trainer as the first adapter.
3. Add automatic local model/hardware scoring and a plan preview.
4. Add prompt extraction and dataset selection to the Create flow.
5. Add SDXL adapter and compatibility metadata.
6. Add Flux adapter and compatibility metadata.
7. Add output validation, indexing, cancellation, and recovery coverage.
8. Add cloud adapters behind explicit configuration and approval.

## Success criteria

- A user can request a character or style LoRA in one plain-language prompt.
- Lazarus selects a compatible installed base and explains the choice.
- The user is asked only for missing source examples or an unavoidable choice.
- The run can be started, monitored, cancelled, and recovered locally.
- The finished LoRA appears in the correct local folder and Create list.
- Incompatible or unverified outputs never appear as usable LoRAs.
