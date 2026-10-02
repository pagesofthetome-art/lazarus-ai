import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * B6 (lu-301/bau/klaerung-n7.md), zweiter unbewachter Weg: `setActiveModel`
 * rief `stop_bundled_engine` bisher UNBEDINGT, sobald das vorige Modell der
 * eingebaute Motor war und das neue keiner ist. `AppShell.tsx` ruft genau
 * diesen Wechsel bei JEDEM Cloud-Umschalten automatisch auf
 * (`setActiveModel(pick.next)`), auch waehrend eine ANDERE Unterhaltung noch
 * lokal generiert. Der schon bestehende Schutz `offloadWhenLocalLaneFree`
 * (`lib/cloud-offload-defer.ts`) bewachte bis jetzt nur AppShells eigenen
 * `offload_local_models`-Aufruf, nicht diesen hier.
 *
 * Auflage 1.1 (lu-301/bau/review-offload2.md): dieselbe Funktion hatte ZWEI
 * weitere unbewachte Nachbarzweige auf dem selben Klick: `unloadLmStudioModel`
 * und Ollamas `unloadModel`. Alle drei laufen jetzt durch EINEN Helfer
 * (`deferLocalUnload`), hier je einzeln getestet.
 *
 * Dieser Test faehrt den ECHTEN `modelStore` gegen den ECHTEN
 * `generationStore` und die ECHTE `isLmStudioProvider` (Auflage 1.5: der
 * Mock war unnoetig, die Funktion ist rein). Nur `backendCall` und die
 * Provider-Aufrufe selbst (`unloadModel`, `unloadLmStudioModel`) sind
 * gemockt (kein Tauri-Invoke, kein echtes Netzwerk).
 *
 * Lauf: npx vitest run src/stores/__tests__/modelStore-defers-engine-stop-during-local-run.test.ts
 */

const backendCall = vi.fn(async (..._args: unknown[]) => ({}))
const unloadModel = vi.fn(async (..._args: unknown[]) => undefined)
const unloadLmStudioModel = vi.fn(async (..._args: unknown[]) => undefined)

vi.mock('../../api/backend', () => ({
  backendCall: (...a: unknown[]) => backendCall(...a),
  isTauri: () => true,
}))
vi.mock('../../api/ollama', () => ({
  unloadModel: (...a: unknown[]) => unloadModel(...a),
}))
vi.mock('../../api/lmstudio', () => ({
  unloadLmStudioModel: (...a: unknown[]) => unloadLmStudioModel(...a),
}))

import { useModelStore, __resetDeferredLocalUnloadsForTests } from '../modelStore'
import { useGenerationStore } from '../generationStore'
import type { AIModel } from '../../types/models'

const builtin = (name: string): AIModel =>
  ({ name: `openai::${name}`, model: name, size: 1, type: 'text', provider: 'openai', providerName: 'Lazarus Engine' } as unknown as AIModel)
const cloudModel = (name: string): AIModel =>
  ({ name, model: name, size: 1, type: 'text', provider: 'anthropic', providerName: 'Anthropic' } as unknown as AIModel)
const lmsModel = (name: string): AIModel =>
  ({ name: `openai::${name}`, model: name, size: 1, type: 'text', provider: 'openai', providerName: 'LM Studio' } as unknown as AIModel)
const ollamaModel = (name: string): AIModel =>
  ({ name, model: name, size: 1, type: 'text' } as unknown as AIModel)

const CONV_ID = 'conv-with-a-running-local-turn'
const CONV_ID_2 = 'a-second-conv-with-its-own-local-turn'
const RUN_TOKEN = {}
const RUN_TOKEN_2 = {}

beforeEach(() => {
  backendCall.mockClear()
  unloadModel.mockClear()
  unloadLmStudioModel.mockClear()
  // R2-6 (lu-301/bau/review-offload2.md, Runde 2): `pendingLocalUnloads` is
  // module state with no test resetter until now. Every test below ends its
  // own booking before it finishes, so nothing has leaked yet, but this
  // guards the next test that does not.
  __resetDeferredLocalUnloadsForTests()
  useModelStore.setState({
    models: [builtin('qwenA'), builtin('qwenB'), cloudModel('claude-x'), lmsModel('mistral'), ollamaModel('llama3')],
    activeModel: 'openai::qwenA',
  })
  useGenerationStore.setState({ runs: {}, generating: {}, aborters: {} })
})

describe('the Lazarus Engine stop (built-in -> non-built-in)', () => {
  it('does NOT stop the engine while a local run is booked, and fires exactly once after it ends', () => {
    useGenerationStore.getState().bookRun(CONV_ID, 'local', RUN_TOKEN)
    // The mode-switch reselect AppShell.tsx does on entering Cloud.
    useModelStore.getState().setActiveModel('claude-x')

    expect(backendCall).not.toHaveBeenCalledWith('stop_bundled_engine')

    useGenerationStore.getState().endRun(CONV_ID, RUN_TOKEN)

    expect(backendCall).toHaveBeenCalledWith('stop_bundled_engine')
    expect(backendCall.mock.calls.filter((c) => c[0] === 'stop_bundled_engine')).toHaveLength(1)
  })

  it('Gegenprobe: without an active local run, the stop fires immediately (unchanged behaviour)', () => {
    useModelStore.getState().setActiveModel('claude-x')
    expect(backendCall).toHaveBeenCalledWith('stop_bundled_engine')
  })

  it('Gegenprobe: switching back to Local (a built-in model) before the run ends means NO stop ever fires', () => {
    useGenerationStore.getState().bookRun(CONV_ID, 'local', RUN_TOKEN)

    useModelStore.getState().setActiveModel('claude-x') // defers
    useModelStore.getState().setActiveModel('openai::qwenA') // user flips back to Local

    backendCall.mockClear()
    useGenerationStore.getState().endRun(CONV_ID, RUN_TOKEN)

    expect(backendCall).not.toHaveBeenCalledWith('stop_bundled_engine')
  })

  // Auflage 1.3(a): a run that ends through its error path books and ends
  // the SAME way a normal run does: generationStore.runs has no separate
  // "failed" state, run-slot.ts's `finally` calls `endRun` regardless of
  // outcome (documented in offload2.md). This test pins that the deferred
  // stop does not care WHY the run ended, only THAT it did.
  it('Auflage 1.3(a): a run that ends via its error path (finally, not success) still releases the deferred stop', () => {
    useGenerationStore.getState().bookRun(CONV_ID, 'local', RUN_TOKEN)
    useModelStore.getState().setActiveModel('claude-x')
    expect(backendCall).not.toHaveBeenCalledWith('stop_bundled_engine')

    // run-slot.ts's `finally` calls endRun on every exit path, error
    // included; there is nothing else to simulate an error exit with here.
    useGenerationStore.getState().endRun(CONV_ID, RUN_TOKEN)
    expect(backendCall).toHaveBeenCalledWith('stop_bundled_engine')
  })

  // Auflage 1.3(c): a second, unrelated local run overlaps the first. The
  // stop must wait for BOTH, not just the one that happened to be booked
  // when Cloud was clicked.
  it('Auflage 1.3(c): two overlapping local runs, the stop waits for the LAST one to end', () => {
    useGenerationStore.getState().bookRun(CONV_ID, 'local', RUN_TOKEN)
    useGenerationStore.getState().bookRun(CONV_ID_2, 'local', RUN_TOKEN_2)
    useModelStore.getState().setActiveModel('claude-x')

    useGenerationStore.getState().endRun(CONV_ID, RUN_TOKEN)
    expect(backendCall).not.toHaveBeenCalledWith('stop_bundled_engine')

    useGenerationStore.getState().endRun(CONV_ID_2, RUN_TOKEN_2)
    expect(backendCall).toHaveBeenCalledWith('stop_bundled_engine')
  })

  // Auflage 1.3(b) / 1.4: switching Cloud/Local/Cloud during the SAME long
  // local run used to register a SEPARATE pending stop each time it entered
  // Cloud with a built-in model active, each harmless alone
  // (stop_bundled_engine is idempotent), but the bauer's report claimed
  // "exactly once" and that only held for a single switch. `deferLocalUnload`
  // dedupes by target, so the count stays exactly one no matter how many
  // times the user flips before the run ends.
  it('Auflage 1.4: Cloud/Local/Cloud twice during one run still stops the engine exactly once', () => {
    useGenerationStore.getState().bookRun(CONV_ID, 'local', RUN_TOKEN)

    useModelStore.getState().setActiveModel('claude-x') // Cloud: schedules a stop
    useModelStore.getState().setActiveModel('openai::qwenA') // Local: no new schedule (prevIsBuiltin is false here)
    useModelStore.getState().setActiveModel('claude-x') // Cloud again: prevIsBuiltin is true again, schedules a SECOND stop pre-fix

    useGenerationStore.getState().endRun(CONV_ID, RUN_TOKEN)

    expect(backendCall.mock.calls.filter((c) => c[0] === 'stop_bundled_engine')).toHaveLength(1)
  })
})

describe('the LM Studio unload (Auflage 1.1)', () => {
  it('does NOT unload while a local run is booked, and fires exactly once after it ends', () => {
    useModelStore.setState({ activeModel: 'openai::mistral' })
    useGenerationStore.getState().bookRun(CONV_ID, 'local', RUN_TOKEN)

    useModelStore.getState().setActiveModel('claude-x')
    expect(unloadLmStudioModel).not.toHaveBeenCalled()

    useGenerationStore.getState().endRun(CONV_ID, RUN_TOKEN)
    expect(unloadLmStudioModel).toHaveBeenCalledWith('mistral')
    expect(unloadLmStudioModel).toHaveBeenCalledTimes(1)
  })

  it('Gegenprobe: without an active local run, the unload fires immediately (unchanged behaviour)', () => {
    useModelStore.setState({ activeModel: 'openai::mistral' })
    useModelStore.getState().setActiveModel('claude-x')
    expect(unloadLmStudioModel).toHaveBeenCalledWith('mistral')
  })

  it('Gegenprobe: picking the SAME LM Studio model again before the run ends means NO unload ever fires', () => {
    useModelStore.setState({ activeModel: 'openai::mistral' })
    useGenerationStore.getState().bookRun(CONV_ID, 'local', RUN_TOKEN)

    useModelStore.getState().setActiveModel('claude-x') // defers
    useModelStore.getState().setActiveModel('openai::mistral') // picked again

    unloadLmStudioModel.mockClear()
    useGenerationStore.getState().endRun(CONV_ID, RUN_TOKEN)
    expect(unloadLmStudioModel).not.toHaveBeenCalled()
  })
})

describe('the Ollama unload (Auflage 1.1)', () => {
  it('does NOT unload while a local run is booked, and fires exactly once after it ends', () => {
    useModelStore.setState({ activeModel: 'llama3' })
    useGenerationStore.getState().bookRun(CONV_ID, 'local', RUN_TOKEN)

    useModelStore.getState().setActiveModel('claude-x')
    expect(unloadModel).not.toHaveBeenCalled()

    useGenerationStore.getState().endRun(CONV_ID, RUN_TOKEN)
    expect(unloadModel).toHaveBeenCalledWith('llama3')
    expect(unloadModel).toHaveBeenCalledTimes(1)
  })

  it('Gegenprobe: without an active local run, the unload fires immediately (unchanged behaviour)', () => {
    useModelStore.setState({ activeModel: 'llama3' })
    useModelStore.getState().setActiveModel('claude-x')
    expect(unloadModel).toHaveBeenCalledWith('llama3')
  })

  it('Gegenprobe: picking the SAME Ollama model again before the run ends means NO unload ever fires', () => {
    useModelStore.setState({ activeModel: 'llama3' })
    useGenerationStore.getState().bookRun(CONV_ID, 'local', RUN_TOKEN)

    useModelStore.getState().setActiveModel('claude-x') // defers unloading llama3
    // Picking llama3 again routes THIS call's own prev ('claude-x', a bare
    // name with no '::') through the same bare-Ollama branch, scheduling an
    // unrelated deferred unload of 'claude-x' under its own target key, a
    // pre-existing quirk (a cloud model name with no provider prefix is
    // indistinguishable from a bare Ollama one) this test does not touch.
    // The assertion below is scoped to llama3, not "unloadModel never runs".
    useModelStore.getState().setActiveModel('llama3')

    unloadModel.mockClear()
    useGenerationStore.getState().endRun(CONV_ID, RUN_TOKEN)
    expect(unloadModel).not.toHaveBeenCalledWith('llama3')
  })
})

describe('__resetDeferredLocalUnloadsForTests (R2-6)', () => {
  it('cancels a pending unload left over from a run this test never ends', () => {
    useModelStore.setState({ activeModel: 'llama3' })
    useGenerationStore.getState().bookRun(CONV_ID, 'local', RUN_TOKEN)
    useModelStore.getState().setActiveModel('claude-x') // defers, never ended
    expect(unloadModel).not.toHaveBeenCalled()

    __resetDeferredLocalUnloadsForTests()
    // Ending the run now must NOT fire the cancelled unload: the reset threw
    // away the subscription, so `offloadWhenLocalLaneFree`'s listener is gone
    // and nothing is left to fire when the lane frees up.
    useGenerationStore.getState().endRun(CONV_ID, RUN_TOKEN)
    expect(unloadModel).not.toHaveBeenCalled()
  })

  it('Gegenprobe: without the reset, that same leftover unload DOES fire once the lane frees', () => {
    useModelStore.setState({ activeModel: 'llama3' })
    useGenerationStore.getState().bookRun(CONV_ID, 'local', RUN_TOKEN)
    useModelStore.getState().setActiveModel('claude-x') // defers, never ended
    expect(unloadModel).not.toHaveBeenCalled()

    useGenerationStore.getState().endRun(CONV_ID, RUN_TOKEN)
    expect(unloadModel).toHaveBeenCalledWith('llama3')
  })
})
