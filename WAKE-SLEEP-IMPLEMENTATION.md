# Lazarus Engine automatic rest mode

This build adds automatic lifecycle management for the app-managed Lazarus Engine.

- Default idle timeout: 5 minutes.
- While Chat, Agent, Coding Agent, queued work, or tool work is active, the engine is not unloaded.
- After the timeout, `stop_bundled_engine` is used so the llama-server process releases its model RAM/VRAM while the desktop UI remains open.
- The existing `ensureBuiltinEngineAlive()` pre-send path reloads the selected model automatically on the next request.
- Settings > AI Backends > Lazarus Engine (expert) includes Automatic rest mode: Off / 1 / 3 / 5 / 10 / 30 minutes and shows Sleeping / Waking / Ready / Working / Unloading.

Changed/added files:
- `src/lib/engine-idle-manager.ts` (new)
- `src/stores/engineLifecycleStore.ts` (new)
- `src/components/layout/AppShell.tsx`
- `src/components/settings/BuiltinEngineSettings.tsx`
- `src/api/builtin-ensure.ts`
- `src/types/settings.ts`
- `src/lib/constants.ts`

Validation note: dependency installation in the sandbox exceeded the execution time limit, so a full TypeScript/build pass could not be completed here. The attempted typecheck failed because the timed-out install had not installed the Vite/Vitest/Node type packages, not because of a reported source-code type error.
