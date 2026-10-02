import { useState, useEffect } from 'react'
import { useModelStore } from '../stores/modelStore'
import { useSettingsStore } from '../stores/settingsStore'
import { getProviderIdFromModel, displayModelName } from '../api/providers'
import { getModelContextCached } from '../api/ollama'
import { getLmStudioModelContext } from '../api/lmstudio'
import { getModelMaxTokens } from '../lib/context-compaction'
import { effectiveContextWindow } from '../lib/context-window'
import { effectiveSendWindow } from '../lib/send-window'
import { isManagedBuiltinSlot } from '../api/builtin-ensure'
import { ENGINE_DEFAULT_CTX } from '../lib/builtin-ctx'
import { bundledEngineStatus, bundledCtxTrain } from '../api/engine'
import { getProviderForModel } from '../api/providers'
import type { ContextSource } from '../lib/context-source'
import type { ProviderClient } from '../api/providers/types'
import { resolveActiveWindow } from '../lib/context-source'
import { isLanOpenAiBackend, sendsToALanBackend } from '../lib/lan-openai-slot'

/** `custom` ist jeder andere OpenAI-kompatible Server auf diesem Rechner oder
 *  im LAN: llama.cpp, vLLM, KoboldCpp, text-generation-webui (GH #129). */
export type CtxProvider = 'ollama' | 'lmstudio' | 'builtin' | 'cloud' | 'custom' | 'unknown'

export interface ActiveContext {
  /** Which backend the active model runs on. */
  provider: CtxProvider
  /** The context window the model is ACTUALLY using right now — the TRUE
   *  denominator for the token counter. */
  contextWindow: number
  /** The model's ceiling, used to cap the dropdown presets (0 = unknown). */
  modelMax: number
  /**
   * The window one request may actually SEND (2.6.6, plan A2). Equal to
   * contextWindow on local backends; on a paid provider it is the send cap,
   * which is the only honest denominator for the token counter. A 262k model
   * whose steps are capped at 64k is not "25 percent full", it is full.
   */
  sendWindow: number
  /** True when the value is the model's real, confirmed live context (Ollama
   *  num_ctx, or LM Studio's loaded_context_length) rather than a fallback. */
  isTrue: boolean
  /** Whether the user can change it from the dropdown (local backends only). */
  adjustable: boolean
  /**
   * Woher die Zahl stammt: vom Server, vom Nutzer, oder geraten (GH #129).
   * Der Zaehler schreibt es in seinen Werkzeugtext, und `applyMaxTokens`
   * leitet nur aus den ersten beiden ein `max_tokens` ab.
   */
  source: ContextSource
  /**
   * Der Schluessel, unter dem die Wahl des Nutzers gespeichert wird
   * (`<baseUrl>|<modelId>`). Leer, wo es keine modellgenaue Wahl gibt.
   */
  windowKey: string
  /**
   * Die gespeicherte Wahl, die ueber dem laufenden Fenster des Servers lag und
   * darauf geklemmt wurde (0 oder fehlend = nichts geklemmt). Nur der eigene
   * OpenAI-kompatible Endpunkt kennt diesen Fall: Ollama, LM Studio und der
   * Lazarus-Motor laden bei einer Wahl neu, ein fremder Server nicht.
   */
  clampedFrom?: number
}

/** What the hook reports while there is no model, or none resolved yet. */
const NO_CONTEXT: ActiveContext = {
  provider: 'unknown', contextWindow: 0, modelMax: 0, sendWindow: 0, isTrue: false,
  adjustable: false, source: 'guess', windowKey: '',
}

/** Der Client zu einem Modellnamen, ohne zu werfen, wenn der Slot fehlt. */
function safeProviderFor(modelName: string): { provider: ProviderClient | null; modelId: string } {
  try {
    const { provider, modelId } = getProviderForModel(modelName)
    return { provider, modelId }
  } catch {
    return { provider: null, modelId: displayModelName(modelName) }
  }
}

/**
 * Resolve the REAL context window of the active model, provider-aware, so the
 * TokenCounter denominator and the Context dropdown agree and never lie:
 *   - Ollama:    num_ctx we send = effectiveContextWindow(realCtx, override).
 *   - LM Studio: loaded_context_length from the enhanced REST API — the value
 *                the model is genuinely running with (NOT its theoretical max).
 *   - Cloud:     the model's fixed max (can't be changed; not adjustable).
 *
 * `reloadTick` lets the dropdown force a re-read right after it reloads a model.
 */
/**
 * Woher das Fenster eines ferngesteuerten Modells stammt.
 *
 * R2-5: hier stand `?? 'probe'`, und "probe" heisst im Werkzeugtext des
 * Zaehlers "from server". Antwortet der Anbieter gar nicht, faellt `max` aber
 * auf die KNOWN_CONTEXT-Tabelle dieses Hauses, auf die Namensheuristik oder
 * ganz auf die 4096 aus `context-compaction.ts`. Der Nutzer las dann eine
 * geratene Zahl als Auskunft des Betreibers und richtete seinen Sendedeckel
 * danach. Eine Auskunft ist es nur, wenn der Anbieter sie wirklich gegeben hat
 * oder wenn es der eigene Katalog ist; sonst steht dort "estimated", was
 * `SOURCE_LABEL.guess` schon sagt.
 */
export function remoteWindowSource(
  _providerId: string,
  resolved: ContextSource | undefined,
  _max: number,
): ContextSource {
  return resolved ?? 'guess'
}

export function useActiveContextWindow(reloadTick = 0): ActiveContext {
  const activeModel = useModelStore((s) => s.activeModel)
  const override = useSettingsStore((s) => s.settings.contextWindowOverride)
  const builtinCtx = useSettingsStore((s) => s.settings.builtinEngine.ctx)
  const sendWindowTokens = useSettingsStore((s) => s.settings.codexSendWindowTokens)
  const capEnabled = useSettingsStore((s) => s.settings.contextDecay)
  // The resolved window carries the model it was resolved FOR. That tag does
  // two jobs: the "no model" case becomes a derivation instead of a setState
  // fired from the effect body (React 19 `set-state-in-effect`), and a model
  // switch no longer reports the PREVIOUS model's window during the probe.
  // The second one matters for this hook in particular — everything above is
  // about the counter never lying, and "62k of 262k" under a model that has
  // 8k is exactly the lie. Unresolved reads as unknown, which is the state
  // every consumer already handles on mount.
  const [resolved, setResolved] = useState<{ model: string; ctx: ActiveContext } | null>(null)

  // Re-read whenever a model reload finishes anywhere (the Context dropdown
  // fires this), so every consumer — counter AND dropdown — reflects the new
  // loaded context at the same time instead of drifting.
  const [reloadBump, setReloadBump] = useState(0)
  useEffect(() => {
    const onReloaded = () => setReloadBump((b) => b + 1)
    window.addEventListener('lu-context-reloaded', onReloaded)
    return () => window.removeEventListener('lu-context-reloaded', onReloaded)
  }, [])

  useEffect(() => {
    if (!activeModel) return
    let cancelled = false
    const providerId = getProviderIdFromModel(activeModel)
    const setState = (ctx: ActiveContext) => setResolved({ model: activeModel, ctx })

    ;(async () => {
      // ── Ollama: num_ctx is per-request, so what we send == what runs. ──
      if (providerId === 'ollama') {
        const max = await getModelContextCached(activeModel).catch(() => 0)
        if (cancelled) return
        const ollamaCtx = effectiveContextWindow(max, override)
        setState({
          provider: 'ollama',
          contextWindow: ollamaCtx,
          modelMax: max,
          // Local backend: nothing is billed, so the send window IS the window.
          sendWindow: ollamaCtx,
          isTrue: true,
          adjustable: true,
          source: override > 0 ? 'user' : max > 0 ? 'probe' : 'guess',
          windowKey: '',
        })
        return
      }

      // ── Built-in engine (app-managed llama-server): status.ctx is the -c
      //    the server was STARTED with — the true denominator (ENG-3). Must
      //    come before the LM Studio probe: the bundled server is
      //    openai-compat too and would otherwise fall through to the cloud
      //    branch, where the counter lies. ──
      if (providerId === 'openai' && isManagedBuiltinSlot()) {
        const status = await bundledEngineStatus().catch(() => null)
        if (cancelled) return
        // Trained ceiling from the GGUF header (via the model listing) caps
        // the dropdown presets; 0 = unknown = uncapped (pre-listing or a
        // header without the key).
        const modelMax = bundledCtxTrain(activeModel)
        if (status?.running && typeof status.ctx === 'number' && status.ctx > 0) {
          setState({
            provider: 'builtin',
            contextWindow: status.ctx,
            modelMax,
            sendWindow: status.ctx,
            isTrue: true,
            adjustable: true,
            // Der laufende Motor hat gesagt, mit welchem -c er startete.
            source: 'probe',
            windowKey: '',
          })
        } else {
          // Managed but not up (offloaded / before first send): the next
          // start uses the tuning value, so that IS the honest prediction.
          // Dieselbe Konstante, mit der der Motor wirklich startet
          // (lib/builtin-ctx). Hier stand 8192 als Zahl: wer die Konstante auf
          // 16384 setzt, bekaeme sonst eine Klapplade, die 16K sagt, und einen
          // Zaehler, der weiter durch 8192 teilt.
          const nextCtx = builtinCtx > 0 ? builtinCtx : ENGINE_DEFAULT_CTX
          setState({
            provider: 'builtin',
            contextWindow: nextCtx,
            modelMax,
            sendWindow: nextCtx,
            isTrue: false,
            adjustable: true,
            // Eine Vorhersage des naechsten Starts, kein Messwert.
            source: 'guess',
            windowKey: '',
          })
        }
        return
      }

      // ── openai-compat: probe LM Studio's enhanced API. A real loaded/max
      //    value means it IS LM Studio; null means a cloud/other openai server. ──
      if (providerId === 'openai') {
        const modelId = displayModelName(activeModel)
        const info = await getLmStudioModelContext(modelId)
        if (cancelled) return
        if (info.loaded || info.max) {
          const loaded = info.loaded ?? 0
          const max = info.max ?? loaded
          const lmCtx = loaded > 0
            ? loaded                                   // TRUE: what LM Studio actually loaded
            : (override > 0 ? override : Math.min(max || 8192, 16384))
          setState({
            provider: 'lmstudio',
            contextWindow: lmCtx,
            modelMax: max,
            sendWindow: lmCtx,
            isTrue: loaded > 0,
            adjustable: true,
            source: loaded > 0 ? 'probe' : override > 0 ? 'user' : 'guess',
            windowKey: '',
          })
          return
        }
      }

      /*
       * GH #129: jeder ANDERE OpenAI-kompatible Server auf diesem Rechner oder
       * im LAN. llama.cpp, vLLM, KoboldCpp, text-generation-webui, Jan.
       *
       * Bis hierher fielen sie alle in den Cloud-Zweig unten, und der tut
       * zweierlei, was fuer eine eigene Maschine falsch ist: er nennt das
       * Fenster nicht verstellbar (also kein Waehler, obwohl der Nutzer der
       * Einzige ist, der die Zahl kennt), und er zieht den BEZAHLTEN
       * Sendedeckel ab, obwohl hier niemand etwas bezahlt. Beim Melder ergab
       * das aus einer geratenen 8192 die Anzeige "6.4K" (8192 mal 0,8, geteilt
       * durch 1024) neben einem Modell mit 262144.
       */
      if (providerId === 'openai' && isLanOpenAiBackend()) {
        const { provider, modelId } = safeProviderFor(activeModel)
        const resolved = provider?.getContextWindow
          ? await provider.getContextWindow(modelId).catch(() => null)
          : null
        if (cancelled) return
        if (provider && resolved && resolved.tokens > 0) {
          const win = resolveActiveWindow({ resolved, localBackend: true })
          setState({
            provider: 'custom',
            contextWindow: win.contextWindow,
            modelMax: win.modelMax,
            sendWindow: win.sendWindow,
            isTrue: win.isTrue,
            adjustable: win.adjustable,
            source: win.source,
            windowKey: provider.contextWindowKey?.(modelId) ?? '',
            clampedFrom: win.clampedFrom,
          })
          return
        }
      }

      // ── Cloud / other: fixed context, not adjustable from here. The
      // DEFAULT_CONTEXT_CAP and the local num_ctx override are local-runtime
      // levers — applying them here would falsify the denominator for
      // 128k-context hosted models. ──
      const { provider: cloudClient, modelId: cloudId } = safeProviderFor(activeModel)
      const cloudResolved = cloudClient?.getContextWindow
        ? await cloudClient.getContextWindow(cloudId).catch(() => null)
        : null
      const max = cloudResolved?.tokens || await getModelMaxTokens(activeModel).catch(() => 4096)
      if (cancelled) return
      setState({
        provider: 'cloud',
        contextWindow: max,
        modelMax: max,
        // Meter honesty (plan A2): a paid step never sends more than the cap,
        // so the cap is what the counter divides by.
        sendWindow: effectiveSendWindow({
          providerId,
          modelWindow: max,
          sendWindowTokens,
          capEnabled,
          // Der Zweig oben kehrt nur um, wenn der eigene Server ein Fenster
          // GENANNT hat. Sagt er keins, faellt er bis hierher durch, und ohne
          // diese Zeile bekaeme er dann doch den bezahlten Deckel.
          localBackend: sendsToALanBackend(providerId),
        }),
        isTrue: false,
        // Aus der Ferne ist das Fenster keine Sache des Nutzers: es gehoert
        // einer fremden Bereitstellung, und der Sendedeckel ist hier der
        // Hebel, der den Nenner regelt.
        adjustable: false,
        // Woher die Zahl kommt, auch wenn sie hier niemand verstellen kann.
        source: remoteWindowSource(providerId, cloudResolved?.source, max),
        windowKey: '',
      })
    })()

    return () => { cancelled = true }
  }, [activeModel, override, builtinCtx, sendWindowTokens, capEnabled, reloadTick, reloadBump])

  return activeModel && resolved?.model === activeModel ? resolved.ctx : NO_CONTEXT
}
