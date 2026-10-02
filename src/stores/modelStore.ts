import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeJSONStorage } from '../lib/storage-quota'
import { canAutoSelectChat } from '../lib/chat-model-minimum'
import { isLoraRow } from '../lib/lora-rows'
import type { AIModel, PullProgress, ModelCategory } from '../types/models'
import { unloadModel } from '../api/ollama'
import { unloadLmStudioModel } from '../api/lmstudio'
import { activateBuiltinModel } from '../api/engine'
import { isLmStudioProvider } from '../lib/hf-to-provider'
import { isTauri, backendCall } from '../api/backend'
import { useChatStore } from './chatStore'
import { useGenerationStore } from './generationStore'
import { log } from '../lib/logger'
import { isLazarusEngineName } from '../lib/engine-name'
import { offloadWhenLocalLaneFree } from '../lib/cloud-offload-defer'
// Which provider slot a model name routes to. There is exactly one answer to
// that question in this app and it lives in api/providers/registry, the same
// function getProviderForModel uses to pick the client that actually sends the
// turn. A second implementation here disagreed with it on real names
// ('sdxl::x.safetensors' → null vs 'sdxl', 'a::b::c' → null vs 'ollama'), which
// is the worst possible place for two answers: the guard below would decline to
// clear a pick that the send path would then route to a dead backend.
import { getProviderIdFromModel } from '../api/providers/model-name'
import { onProviderSlotsDarkened } from '../lib/provider-slot-darkening'
import {
  announceChatPickLostItsEngine,
  onBuiltinSlotLostToForeignBackend,
  onBuiltinSlotRegained,
} from '../lib/builtin-slot-handover'
import { ensureBuiltinEngineAlive, builtinSlotSwitchedOff } from '../api/builtin-ensure'
import { isBuiltinEngineEntry, type InstalledModelLike } from '../lib/lmstudio-match'
import type { ProviderId } from '../api/providers/types'

/**
 * B6 followup (Auflage 1.1, lu-301/bau/review-offload2.md): `stop_bundled_engine`
 * was not the only unguarded stop in `setActiveModel`. `unloadLmStudioModel`
 * and Ollama's `unloadModel` sit right next to it, in the SAME function, fired
 * by the SAME Cloud-switch click (`AppShell.tsx`'s mode-switch reselect calls
 * `setActiveModel` on every entry into Cloud), and both target backends
 * `run-lane-of-model.ts` counts as the LOCAL lane. All three now go through
 * this one helper instead of three near-identical copies of "defer, then
 * recheck at fire time".
 *
 * `target` dedupes: a second call for the SAME target cancels the FIRST
 * pending one before scheduling its own, so switching Cloud/Local/Cloud
 * repeatedly during one long local run leaves exactly one pending unload
 * per target, not one per switch (Auflage 1.4: they used to stack, each
 * harmless on its own since `stop_bundled_engine` is idempotent, but the
 * bauer's own report claimed "exactly once" and that was only true for a
 * single switch).
 *
 * `stillWanted` is read at FIRE TIME, not at scheduling time: the user may
 * have switched back to the model (or, for the shared Lazarus Engine, to ANY
 * built-in model: the engine serves one at a time regardless of which)
 * while this was waiting for the local lane to free up. Returning true skips
 * the unload entirely.
 */
const pendingLocalUnloads = new Map<string, () => void>()

function deferLocalUnload(target: string, stillWanted: () => boolean, unload: () => void): void {
  pendingLocalUnloads.get(target)?.()
  pendingLocalUnloads.delete(target)
  let fired = false
  const cancel = offloadWhenLocalLaneFree(useGenerationStore, () => {
    fired = true
    pendingLocalUnloads.delete(target)
    if (stillWanted()) return
    unload()
  })
  if (!fired) pendingLocalUnloads.set(target, cancel)
}

/** Test-only (R2-6, lu-301/bau/review-offload2.md, Runde 2): forget every
 *  pending deferred unload so tests stay isolated, the same role
 *  `__resetBuiltinSlotOffloadForTests` plays for `builtin-slot-eviction.ts`'s
 *  own module state. Today's test file always ends its own bookings, so
 *  nothing leaks yet, but the next test that leaves a run unfinished would
 *  otherwise carry a stale cancel function into the following test. */
export function __resetDeferredLocalUnloadsForTests(): void {
  for (const cancel of pendingLocalUnloads.values()) cancel()
  pendingLocalUnloads.clear()
}

export interface PullState {
  progress: PullProgress
  controller: AbortController
  paused: boolean
  complete: boolean
}

interface ModelState {
  models: AIModel[]
  activeModel: string | null
  activePulls: Record<string, PullState>
  isModelLoading: boolean
  categoryFilter: ModelCategory
  /** Has a model list ever landed here. A counter must show a loading mark
   *  until it has, never a 0 (Befund 2 of the abnahme counter-check
   *  2026-08-29: "Installed 0" next to three Installed cards). */
  inventoryLoaded: boolean
  /** How many inventory refreshes are in flight. A number, not a flag,
   *  because fetchModels is called from several mounted components at once
   *  and the first one to finish must not declare the count settled. */
  inventoryRefreshes: number
  /**
   * Welche Zeilen eingeklappt wurden, weil ein anderes Backend dieselbe Datei
   * schon anbietet: wessen Zeilen es waren, wie viele, und wer sie stattdessen
   * bedient.
   *
   * Persona P5, 03./04.09.2026: LM Studio meldete ueber die eigene
   * Schnittstelle 7 Modelle, der Waehler zeigte unter LM STUDIO nur 4. Die
   * drei fehlenden sind genau die, deren Datei auch als Lazarus-Engine-Zeile
   * dasteht. Das Einklappen ist richtig, das Schweigen darueber nicht: fuer
   * den Nutzer sehen drei seiner Modelle einfach verschwunden aus.
   *
   * Gegenprobe G1, 04.09.2026: dieselbe Sache in der anderen Richtung, und
   * dort war es schlimmer. Sobald LM Studio den Steckplatz haelt, faellt
   * `Qwen3-4B-Q4_K_M` weg, eine echte, installierte Datei des Kunden von
   * 2,3 GB, aus dem Waehler UND von der Models-Seite. Kein Hinweis, keine
   * Erklaerung, waehrend fuer die Gegenrichtung ein Satz existierte und
   * angezeigt wurde. Ein Feld statt zwei, damit die beiden Richtungen nicht
   * wieder auseinanderlaufen koennen.
   */
  foldedRows: { backend: string; count: number; servedBy: string } | null
  setFoldedRows: (folded: { backend: string; count: number; servedBy: string } | null) => void
  beginInventoryRefresh: () => void
  endInventoryRefresh: () => void
  setModels: (models: AIModel[]) => void
  /** Drop every inventory row for a file that is provably gone from the disk.
   *  Nebenbefund 2 of the R8 re-measure: after a confirmed delete the row and
   *  the counter stood unchanged for about ten seconds while the file was long
   *  gone, because the list only ever changed at the END of the reconcile
   *  chain (ComfyUI rescan, reachability probe, two /object_info reads, a stat
   *  over every remaining file). Nothing here guesses: the delete command has
   *  already returned Ok. The chain still runs and still has the last word.
   *  Every row, not the first: one checkpoint file is one row under Image and
   *  one under Video. `activeModel` is untouched on purpose, this serves the
   *  ComfyUI lanes and an image file is never the active chat model. */
  removeInventoryModel: (name: string) => void
  setActiveModel: (name: string | null) => void
  startPull: (name: string, controller: AbortController) => void
  updatePullProgress: (name: string, progress: PullProgress) => void
  pausePull: (name: string) => void
  completePull: (name: string) => void
  dismissPull: (name: string) => void
  setIsModelLoading: (loading: boolean) => void
  setCategoryFilter: (category: ModelCategory) => void
  /** Nothing across these two stores enforced that the picked model belongs to
   *  a backend that is still switched on. `setModels` only re-checks the pick
   *  against the next NON-EMPTY inventory, so between switching a provider off
   *  and the next successful refresh the composer showed a model whose backend
   *  was gone and every send failed with model-not-found. providerStore calls
   *  this the moment a slot goes dark. */
  dropActiveModelIfServedBy: (providerId: ProviderId) => void
  /** Der geteilte lokale Steckplatz ist an ein eingeschaltetes fremdes Backend
   *  gegangen. Der Chip im Chat nennt danach weiter das GGUF, das auf 8127 lag,
   *  auf dem Port liegt nichts mehr, und die Selbstheilung des Absendewegs
   *  haengt hinter `config.managed === true`, das jetzt false ist. Bleibt die
   *  Wahl stehen, ist die einzige Antwort auf ein Absenden eine Fremdmeldung
   *  ueber eine unbekannte Modell-Kennung.
   *
   *  Entschieden wird nach der ZEILE, nicht nach dem Steckplatz, und gelesen
   *  wird sie erst bei der Zustellung, eine Mikrotask nach dem Wechsel. Das
   *  deckt genau EINEN der beiden Klickwege ab: `useModels.activateModel` gibt
   *  den Steckplatz ab und setzt die Zeile des uebernehmenden Backends ohne
   *  `await` unmittelbar danach, dort steht dann eine fremde Zeile, die diese
   *  Aktion nichts angeht. Der zweite Weg, die Auto-Ladung im Waehler, laedt
   *  erst in LM Studio und setzt die Wahl erst hinterher, auf der Box 12,4 s
   *  spaeter; dort faellt sie wirklich, und bis zum Ende der Ladung bedient
   *  auch niemand das GGUF.
   *
   *  `taker` ist nur fuer die Zeile da, die der Nutzer danach liest, und ist
   *  eine Momentaufnahme vom Steckplatzwechsel selbst. Angesagt wird der Wechsel
   *  von lib/builtin-slot-eviction ueber lib/builtin-slot-handover. */
  dropPickServedByTheBuiltinEngine: (taker: string | undefined) => void
  /** Der Steckplatz gehoert wieder der eigenen Engine, nachdem sie ihr Modell
   *  schon losgelassen hatte (Gegenprobe G2: nach Enable und Remove lief auf
   *  8127 nichts mehr und startete auch nach dreimaligem Ansichtswechsel nicht
   *  nach). `ensureBuiltinEngineAlive` ist genau der Weg, den auch das Absenden
   *  einer Nachricht geht: Zustand fragen, Datei suchen, mit der Feineinstellung
   *  des Nutzers starten. */
  reviveBuiltinEngineForActivePick: () => Promise<void>
}

export const useModelStore = create<ModelState>()(
  persist(
    (set, get) => ({
      models: [],
      activeModel: null,
      activePulls: {},
      isModelLoading: false,
      categoryFilter: 'all',
      inventoryLoaded: false,
      inventoryRefreshes: 0,

      beginInventoryRefresh: () => set((state) => ({ inventoryRefreshes: state.inventoryRefreshes + 1 })),
      endInventoryRefresh: () =>
        set((state) => ({ inventoryRefreshes: Math.max(0, state.inventoryRefreshes - 1) })),

      setModels: (models) =>
        set((state) => {
          // A legacy hosted catalog may still be returned by an older
          // persisted profile or provider response. Never expose those rows
          // after the hosted service has been retired.
          const availableModels = models.filter((model) => model.provider !== 'lu-cloud')
          // Keep the persisted activeModel only if it's actually still
          // present in the freshly fetched list. Without this validation a
          // model name persists in the picker after the underlying provider
          // (e.g. Ollama) was uninstalled or the model was deleted — the
          // dropdown then shows a dead name and clicking it opens an empty
          // list. Automatic replacement uses the first eligible chat model;
          // if none has a known size of at least 7B, require an explicit pick.
          // An empty list validates nothing. fetchModels writes its result
          // here even when every provider failed, and dropping the pick on
          // that answer is how a transient failure turned into a silently
          // different model in the picker (Befund 3, abnahme counter-check
          // 2026-08-29). The pick has its own guard on the way in and its
          // own moment to be re-checked: the next non-empty list.
          //
          // Und getauscht wird hier nicht mehr stumm. Der Tausch steht in
          // derselben set() wie die neue Liste, also liest jeder Effekt
          // danach schon den Ersatz und kann nicht mehr erkennen, dass
          // getauscht wurde. Gesagt wird es deshalb dort, wo beide Seiten
          // noch dastehen: bei dem, der die Liste hereingibt
          // (hooks/useModels, announceChatModelReplaced).
          // Ein LoRA ist keine Wahl. Bis zum LoRA-Reiter standen die Dateien
          // aus `loras` zwischen den Checkpoints im Bild-Reiter und waren
          // anklickbar, und wer damals einmal geklickt hat, traegt den Namen
          // bis heute hier. Die Zeile steht weiter in der vollen Inventur,
          // also haette die Pruefung unten sie fuer gueltig gehalten, und
          // abwaehlen laesst sie sich in Models nicht mehr. Die Wahl faellt
          // deshalb beim naechsten Laden zurueck, denselben Weg wie ein Name,
          // den es nicht mehr gibt.
          const gewaehlteZeile = availableModels.find((m) => m.name === state.activeModel)
          const stillValid =
            !!state.activeModel &&
            (availableModels.length === 0 || (!!gewaehlteZeile && !isLoraRow(gewaehlteZeile)))
          // Automatic choices need a known size of at least 7B. Image/video,
          // small models and opaque aliases require no implicit chat pick.
          // The valid persisted choice above remains the user's decision.
          const firstChat = availableModels.find(canAutoSelectChat)
          return {
            models: availableModels,
            inventoryLoaded: true,
            activeModel: stillValid
              ? state.activeModel
              : (firstChat ? firstChat.name : null),
          }
        }),

      removeInventoryModel: (name) =>
        set((state) => {
          if (!name) return state
          const models = state.models.filter((m) => m.name !== name)
          // A no-op must stay a no-op: returning a fresh array for a name that
          // was not in the list would re-render every counter for nothing.
          if (models.length === state.models.length) return state
          return { models }
        }),

      setActiveModel: (name) => {
        const prev = get().activeModel
        const prevModel = prev ? get().models.find((m) => m.name === prev) : undefined
        set({ activeModel: name })
        // Befund 4 of the abnahme counter-check (2026-08-29): the open chat
        // kept the model it was created with while the wire of that same turn
        // already carried the new one. Every path that changes the selection
        // comes through here, so the record is written here, once. A cleared
        // selection has nothing to write.
        if (name) {
          try { useChatStore.getState().setActiveConversationModel(name) }
          catch (e) { log.warn('[modelStore] could not note the model on the open chat', { err: e }) }
        }
        if (!prev || prev === name) return
        // Exactly ONE local model stays in VRAM at a time (David 2026-06-12:
        // "darf niemals 2 gleichzeitig geladen sein, außer man macht Compare").
        // Compare uses its own store + provider calls, NOT setActiveModel, so it
        // is unaffected. EXCEPTION (R2-3, lu-301/bau/review-offload2.md, Runde 2):
        // while a deferred unload is waiting (see `deferLocalUnload` below), the
        // old local model can briefly sit in VRAM alongside a newly activated
        // one, because the old one's unload is held back until every local run
        // still using it has ended. That is not a break of this rule; it is the
        // documented price of never dropping a run out from under itself.
        // Unload the PREVIOUS local model via the right provider.
        //   - Ollama (no provider prefix)  → unloadModel
        //   - LM Studio (openai:: + LM-Studio providerName) → unloadLmStudioModel
        //   - Cloud (anthropic:: / OpenRouter / OpenAI etc.) → no local VRAM, skip
        // The old `!prev.includes('::')` guard skipped LM Studio entirely, so
        // switching AWAY from an LM Studio model left it loaded → two models in
        // VRAM at once. (David live find.)
        const prevIsLms = isLmStudioProvider(
          (prevModel && 'providerName' in prevModel && prevModel.providerName) as string | undefined,
        )
        // The Lazarus Engine (llama.cpp sidecar) occupies the `openai::` slot
        // with providerName 'Lazarus Engine' ('Built-in Engine' before 2.6.8, still
        // on disk in older chats) and holds its GGUF in VRAM with
        // -ngl 999. It is NOT caught by the LM-Studio or the bare-Ollama branch
        // below, so before 2.5.7 wired this in, switching away from a built-in
        // model to an Ollama/LM-Studio model left the sidecar resident → two
        // models in VRAM at once (the exact case this guard exists to prevent).
        const prevIsBuiltin =
          !!prevModel && 'providerName' in prevModel && isLazarusEngineName(prevModel.providerName)
        if (prevIsLms) {
          const bareKey = prev.replace(/^[^:]+::/, '') // strip Lazarus's routing prefix
          // B6 (klaerung-n7.md) / Auflage 1.1 (review-offload2.md): this LM
          // Studio unload sits in the SAME function as the Lazarus Engine stop
          // below and fires on the SAME Cloud-switch click, at a model
          // `run-lane-of-model.ts` counts as local: it used to run
          // unguarded while the built-in-engine branch right next to it
          // already had the fix. `stillWanted` here means "the user picked
          // this exact model again before the local lane freed up".
          deferLocalUnload(
            `lms:${bareKey}`,
            () => get().activeModel === prev,
            () => unloadLmStudioModel(bareKey).catch((e) =>
              log.warn('[modelStore] failed to unload previous LM Studio model', { model: prev, err: e }),
            ),
          )
        } else if (prevIsBuiltin) {
          const nextModel = get().models.find((m) => m.name === name)
          const nextIsBuiltin =
            !!nextModel && 'providerName' in nextModel && isLazarusEngineName(nextModel.providerName)
          if (!nextIsBuiltin) {
            // B6 (lu-301/bau/klaerung-n7.md): this reselect is the SECOND,
            // unguarded path that stops the Lazarus Engine. AppShell's cloud-mode
            // effect calls setActiveModel(pick.next) on every mode flip
            // BEFORE its own offload effect runs, and this stop used to fire
            // unconditionally, killing llama-server mid-stream for whatever
            // OTHER conversation was still generating locally. Same guard as
            // AppShell's offload: defer until the local lane is free.
            //
            // A re-check at fire time, not just a deferred call: by the time
            // the local lane frees up, the user may have switched back to
            // Local or picked another built-in model themselves (this same
            // function runs again for that), so the stop must look at the
            // CURRENT active model, not the one that was picked when this
            // closure was created. Every built-in model shares the ONE
            // engine process, so the check is "is ANY built-in model active
            // again", not just this exact one (a different built-in pick
            // takes the swap branch below, on ITS OWN call, and must not be
            // undone by a stop this call scheduled earlier).
            deferLocalUnload(
              'builtin-engine',
              () => {
                const stillActiveModel = get().activeModel
                const stillActiveEntry = stillActiveModel
                  ? get().models.find((m) => m.name === stillActiveModel)
                  : undefined
                return (
                  !!stillActiveEntry &&
                  'providerName' in stillActiveEntry &&
                  isLazarusEngineName(stillActiveEntry.providerName)
                )
              },
              () => backendCall('stop_bundled_engine').catch((e) =>
                log.warn('[modelStore] failed to stop the Lazarus Engine on switch-away', { err: e }),
              ),
            )
          } else if (name) {
            // built-in → DIFFERENT built-in: llama-server serves exactly ONE
            // gguf and ignores the request's model field, and the send-path
            // self-heal only revives a DEAD server, so without a swap right
            // here, a pick on the Models page would keep every chat silently
            // answering from the OLD model. The composer picker awaits this
            // same call itself before setting the store, so every activation
            // reaches the engine twice. Rust's argv idempotence swallows the
            // second call only for a model that LOADS: a GGUF that fails to
            // load leaves no running engine to compare argv against, and the
            // second command runs the whole try-and-retry routine again (four
            // llama-server spawns per click, measured 2026-09-03). The
            // coalescing that makes the double call harmless therefore lives
            // in api/engine.ts (activationsInFlight), at the one door both
            // callers come through. (A cleared selection, name = null, has
            // nothing to swap to; nextIsBuiltin is false then anyway, this
            // branch just spells it out for tsc.)
            activateBuiltinModel(name).catch((e) =>
              log.warn('[modelStore] failed to swap the Lazarus Engine to the picked model', { model: name, err: e }),
            )
          }
        } else if (!prev.includes('::')) {
          // Same guard, same reason as the LM Studio branch above (Auflage
          // 1.1): a bare Ollama name is local too (run-lane-of-model.ts),
          // and this fires on the same Cloud-switch click. Whether Ollama's
          // own `keep_alive: 0` waits out a request already in flight on
          // that model is the SERVER's call, not observable from this repo
          // (researched, not measured, in review-offload2.md); deferring
          // here costs nothing either way and closes the loophole without
          // relying on an unverified assumption about Ollama's scheduler.
          deferLocalUnload(
            `ollama:${prev}`,
            () => get().activeModel === prev,
            () => unloadModel(prev).catch((e) =>
              log.warn('[modelStore] failed to unload previous model', { model: prev, err: e }),
            ),
          )
        }
      },

      startPull: (name, controller) =>
        set((state) => ({
          activePulls: {
            ...state.activePulls,
            [name]: { progress: { status: 'Starting download...' }, controller, paused: false, complete: false },
          },
        })),

      updatePullProgress: (name, progress) =>
        set((state) => {
          if (!state.activePulls[name]) return state
          return {
            activePulls: {
              ...state.activePulls,
              [name]: { ...state.activePulls[name], progress, paused: false },
            },
          }
        }),

      pausePull: (name) => {
        const pull = get().activePulls[name]
        if (pull && !pull.complete) {
          pull.controller.abort()
          set((state) => ({
            activePulls: {
              ...state.activePulls,
              [name]: { ...state.activePulls[name], paused: true, progress: { ...state.activePulls[name].progress, status: 'Paused' } },
            },
          }))
        }
      },

      completePull: (name) =>
        set((state) => {
          if (!state.activePulls[name]) return state
          return {
            activePulls: {
              ...state.activePulls,
              [name]: { ...state.activePulls[name], complete: true, paused: false, progress: { status: 'Complete' } },
            },
          }
        }),

      dismissPull: (name) => {
        // Bug #5 (phantomderp v2.4.3): the X-button used to remove the
        // entry from `activePulls` without telling Rust to stop the
        // underlying stream. The Tauri-side `pull_model_stream` kept
        // emitting `pull-progress` events that re-created the entry via
        // `pullModelTauri`'s listener — the item visually respawned within
        // 100 ms and the disk-write kept running. Fix: cancel both sides.
        //
        // 1. Abort the AbortController so the listener inside
        //    `useModels.pullModel` sees the abort and the controller's
        //    "abort" handler fires `cancel_model_pull`.
        // 2. Best-effort: invoke `cancel_model_pull` directly too. This
        //    covers the rare case where the controller was already
        //    consumed (e.g. completed-but-not-yet-dismissed entries) and
        //    is idempotent on the Rust side.
        const existing = get().activePulls[name]
        if (existing) {
          try { existing.controller.abort() } catch { /* already aborted */ }
        }
        if (isTauri()) {
          // Fire-and-forget — the Rust command returns Ok(()) even when
          // there's nothing to cancel, so failure here is non-fatal.
          import('@tauri-apps/api/core').then(({ invoke }) => {
            invoke('cancel_model_pull', { name }).catch(() => {})
          }).catch(() => {})
        }
        set((state) => {
          const { [name]: _, ...rest } = state.activePulls
          return { activePulls: rest }
        })
      },

      foldedRows: null,
      setFoldedRows: (folded) => set({ foldedRows: folded }),

      setIsModelLoading: (loading) => set({ isModelLoading: loading }),
      setCategoryFilter: (category) => set({ categoryFilter: category }),

      dropActiveModelIfServedBy: (providerId) => {
        const active = get().activeModel
        if (!active || getProviderIdFromModel(active) !== providerId) return
        log.warn('[modelStore] the picked model\'s backend was switched off, clearing the pick', {
          model: active, provider: providerId,
        })
        // Through setActiveModel, not a bare set(): the model that is going
        // away is also the one holding VRAM, and that release lives there.
        get().setActiveModel(null)
      },

      dropPickServedByTheBuiltinEngine: (taker) => {
        const gewaehlt = get().activeModel
        if (!gewaehlt) return
        const zeile = get().models.find((m) => m.name === gewaehlt)
        if (!isBuiltinEngineEntry(zeile as unknown as InstalledModelLike | undefined)) return
        // Geraeumt wird mit set(), NICHT ueber `setActiveModel`: an dessen Weg
        // weg von einer Engine-Zeile haengt ein sofortiges
        // `stop_bundled_engine`, und das wuerde die 30 Sekunden Nachsicht
        // ueberholen, die lib/builtin-slot-eviction verwaltet.
        set({ activeModel: null })
        log.info('[modelStore] the local slot went to another backend, dropped the pick it served')
        // Zuerst raeumen, dann reden. Die Zeile darf das Raeumen weder
        // verzoegern noch mit sich reissen, wenn niemand sie annimmt.
        //
        // Das eigene catch ist kein Zierrat. `zustellen` in
        // lib/builtin-slot-handover schluckt stumm, damit ein Zuhoerer den
        // Steckplatzwechsel nicht mitreisst, und der Rueckweg gleich darunter
        // hat sein log.warn. Ohne dieses hier haette ein Wurf auf DIESEM Weg
        // gar keine Zeile hinterlassen, und das war er vor dem Umbau am
        // 04.09.2026 nicht: lib/builtin-slot-eviction hat an derselben Stelle
        // '[builtin-slot] could not drop the pick of the displaced engine'
        // geschrieben. Eine Faehigkeit, die beim Umbau leise verschwindet,
        // faellt erst beim Kunden auf, und dann ohne Spur.
        try {
          announceChatPickLostItsEngine(gewaehlt, taker)
        } catch (e) {
          log.warn('[modelStore] could not say that the pick lost its engine', { err: e })
        }
      },

      reviveBuiltinEngineForActivePick: async () => {
        try {
          const gewaehlt = get().activeModel
          if (!gewaehlt) return
          // Der Nutzer hat die Engine in den Einstellungen ausgeschaltet. Der
          // Steckplatz gehoert ihr wieder, aber niemand hat sie zurueckgebeten.
          // Gefragt wird zum Zustellzeitpunkt, nicht bei der Ansage.
          if (builtinSlotSwitchedOff()) return
          await ensureBuiltinEngineAlive(gewaehlt)
          log.info('[modelStore] the engine has the local slot again, brought its model back')
        } catch (e) {
          // Kein Grund, den Steckplatzwechsel scheitern zu lassen. Der
          // Absendeweg versucht dasselbe noch einmal, sobald jemand schreibt.
          log.warn('[modelStore] could not bring the engine back', { err: e })
        }
      },
    }),
    {
      name: 'chat-models',
      storage: safeJSONStorage(),
      partialize: (state) => ({
        activeModel: state.activeModel,
        categoryFilter: state.categoryFilter,
      }),
      onRehydrateStorage: () => (state) => {
        // Older profiles may persist a removed hosted model selection. Clear
        // it before the composer can attempt to resolve or send it.
        if (state?.activeModel?.startsWith('lu-cloud::')) state.setActiveModel(null)
      },
    }
  )
)

// Audit W-T2: Der providerStore hat sich diesen Store frueher selbst geholt
// (`void import('./modelStore')`), um bei abgeschalteten Slots die Modellwahl
// zu raeumen, ein dynamischer Import, der den Kreis providerStore zu
// modelStore und zurueck nur verdeckt hat. Jetzt wird dort angesagt und hier
// zugehoert; die Anmeldung passiert beim Laden dieses Moduls, wie
// registerBuiltinTools() sich beim Tool-Registry anmeldet.
onProviderSlotsDarkened((darkened) => {
  for (const id of darkened) useModelStore.getState().dropActiveModelIfServedBy(id)
})

// Audit W-T2, zweite Runde: lib/builtin-slot-eviction hat sich diesen Store mit
// `await import('../stores/modelStore')` selbst geholt, und diese eine Kante
// trug drei der fuenf Kreise, die `npm run cycles` gemeldet hat. Dieselbe
// Umkehr wie oben, dieselbe Stelle: die Regel kennt den Steckplatz, dieser
// Store kennt die Wahl, und die Leitung dazwischen (lib/builtin-slot-handover)
// gehoert keinem von beiden.
//
// Die Ladereihenfolge traegt das. Beide Webviews haben diesen Store eager im
// Baum, bevor sich ein Steckplatz bewegen kann (main.tsx laedt AppShell im
// Hauptfenster, OnboardingWindow im kleinen Fenster, und beide ziehen ihn),
// und der Rumpf hier laeuft garantiert NACH dem der Eviction, weil diese Datei
// ueber api/engine auf sie zeigt und nicht umgekehrt.
onBuiltinSlotLostToForeignBackend((taker) => {
  useModelStore.getState().dropPickServedByTheBuiltinEngine(taker)
})
onBuiltinSlotRegained(() => {
  void useModelStore.getState().reviveBuiltinEngineForActivePick()
})
