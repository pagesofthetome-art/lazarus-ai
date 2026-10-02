# Task 2: Minimal Z-Image character adapter

Implemented `createZImageCharacterAdapter()` and `registerZImageCharacterAdapter()` in `src/api/lora-training/adapters/zimage-character.ts`.

The adapter accepts image character requests when a supported installed Z-Image model and trainer runtime/base files are ready. It plans with at least four non-empty file/gallery sources and conservative defaults. Execution stages dataset inputs and runs the local trainer through the trainer APIs. Output validation requires the Z-Image image family and a `char_<name>_zimage.safetensors` filename.

No Rust or UI changes were made.

## Review fixes

The adapter now accepts an injected `readFileBytes` function and stages each file/gallery image through `stageTrainingImage`, starts the local trainer, polls its status, streams new log lines, reports progress, and requests backend cancellation when the signal aborts. It does not report completion unless the trainer supplies its output and the adapter validates it.

Output validation now requires an absolute path, positive reported file size, the expected `char_<outputName>_zimage.safetensors` basename, the Z-Image image family, and an exact trigger-word match with the plan. TypeScript check passed with:

`& .\\node_modules\\.bin\\tsc.cmd --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --lib ES2022,DOM src/api/lora-training/adapters/zimage-character.ts`


## Review round 2 fixes

Prepared captions now begin with the plan trigger word. The runtime sanitizes the requested dataset ID before staging, starting, reporting, or clearing; when status returns a set ID, it verifies and adopts that returned identity. Cleanup runs only after a successful staging call and is suppressed for an already-running or unsupported result, pre-abort, and active runs. Z-Image family matching now uses normalized exact aliases/architecture keys rather than substring matching. Output checks validate the absolute path shape, planned filename/family/trigger, and positive reported size; they do not establish that the file exists.

Focused TypeScript compilation passed again with the command above.
