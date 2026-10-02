/**
 * useMemory — Hook for memory operations including LLM-based auto-extraction.
 *
 * Fires a separate inference call to analyze conversation exchanges and
 * extract memorable information. Errors are caught silently — extraction
 * failures must never disrupt the chat experience.
 */

import { useMemoryStore } from '../stores/memoryStore'
import { useModelStore } from '../stores/modelStore'
import { useProviderStore } from '../stores/providerStore'
import { getProviderForModel, getProviderIdFromModel } from '../api/providers'
import { useSettingsStore } from '../stores/settingsStore'
import { resolveAgentNumCtx } from '../lib/agent-num-ctx'
import {
  buildExtractionPrompt,
  parseExtractionResponse,
  buildResolutionPrompt,
  parseResolutionResponse,
  type ExtractedMemory,
  type SimilarExisting,
} from '../lib/memory-extraction'
import { generateEmbeddings, cosineSimilarity } from '../api/rag'
import { loadVectors } from '../lib/memoryEmbedDB'
import { silentCallAllowed, pickSilentCallModel } from '../lib/silent-model-calls'
import type { MemoryFile } from '../types/agent-mode'
import { runInLane } from '../lib/run-slot'
import { laneOf, currentLaneFacts } from '../lib/run-lane-of-model'

interface MemoryWriteGuard {
  current: () => boolean
  wrote: () => void
}

// Rate limit: only extract every Nth turn to reduce cost
let _extractCounter = 0
const EXTRACT_EVERY_N = 3
const MIN_RESPONSE_LENGTH = 100

// ── Write-decision similarity bands (Feature FF) ──────────────────
// Cosine of the new fact's embedding against the most-similar SAME-TYPE
// existing memory decides the write path:
//   sim <  ADD_THRESHOLD   → clearly new → addMemory (no extra LLM call)
//   ADD..NOOP (the "merge band") → ambiguous → one temp:0.1 resolution call
//   sim >= NOOP_THRESHOLD   → already captured → skip (no LLM call, no write)
// Thresholds are first-pass; need live MV3/MV4 validation before "tuned".
const ADD_THRESHOLD = 0.6
const NOOP_THRESHOLD = 0.92
// How many similar existing memories to show the resolver.
const RESOLUTION_TOP_K = 3

/**
 * The provider + model a SILENT memory call may run on, or null when the cost
 * policy forbids the call outright (plan 2.6.6 A7).
 *
 * Resolving it HERE, one level below every extraction path, is the point: the
 * gate and model choice apply to `extractMemoriesFromPair` and to
 * the write-decision resolution alike, so every call follows the same policy.
 */
function resolveSilentCall(
  activeModel: string,
): { provider: ReturnType<typeof getProviderForModel>['provider']; modelId: string; callModel: string } | null {
  const providerId = getProviderIdFromModel(activeModel)
  if (!silentCallAllowed(providerId)) return null
  const callModel = pickSilentCallModel(activeModel, providerId, useModelStore.getState().models)
  const { provider, modelId } = getProviderForModel(callModel)
  return { provider, modelId, callModel }
}

/**
 * Pure extraction routine — safe to call from anywhere (hooks, Tauri listeners,
 * background jobs). Fire-and-forget: never throws, errors are swallowed.
 *
 * The A7 cost policy lives INSIDE (see resolveSilentCall), so every caller
 * below inherits it without a line of its own.
 *
 * Used by:
 *  - useMemory().extractAndSave (Lazarus chat)
 *  - useAgentChat (agent loop)
 *  - useCodex (codex loop)
 *  - AppShell.tsx remote-chat-message listener (Remote chats)
 */
export async function extractMemoriesFromPair(
  userMessage: string,
  assistantResponse: string,
  conversationId: string,
  options?: { scope?: string; sourceKind?: MemoryFile['sourceKind'] },
): Promise<void> {
  const scope = options?.scope
  const sourceKind = options?.sourceKind ?? 'chat'
  try {
    const { activeModel } = useModelStore.getState()
    if (!activeModel) return

    const memState = useMemoryStore.getState()
    if (!memState.settings.autoExtractEnabled) return

    // Skip short responses (not enough signal to extract)
    if (assistantResponse.length < MIN_RESPONSE_LENGTH) return

    // Rate limit: only extract every Nth turn
    _extractCounter++
    if (_extractCounter % EXTRACT_EVERY_N !== 0) return

    // Warn-check: if cloud provider, check if user has opted in
    const providerState = useProviderStore.getState()
    const isCloud = (providerState.providers.openai.enabled && !providerState.providers.openai.isLocal) ||
      providerState.providers.anthropic.enabled
    if (isCloud && !memState.settings.autoExtractInAllModes) return

    // Cost gate + suitable model (plan A7). Null means policy forbids the call.
    const call = resolveSilentCall(activeModel)
    if (!call) return
    const { provider, modelId, callModel } = call
    let expectedEntries = memState.entries
    const collectionRevision = memState.memoryCollectionRevision
    let revoked = false
    const guard: MemoryWriteGuard = {
      current: () => {
        const current = useMemoryStore.getState()
        if (current.entries !== expectedEntries || current.memoryCollectionRevision !== collectionRevision || !current.settings.autoExtractEnabled) revoked = true
        return !revoked
      },
      wrote: () => { expectedEntries = useMemoryStore.getState().entries },
    }

    // Runde 4 (review-lanes.md Blocker 1+6): this silent call books into the
    // local lane too. Before this it ran straight against
    // `provider.chatStream`, unregistered anywhere run-lanes.ts could see it.
    // The visible turn that triggers it (`void extractMemoriesFromPair(...)`
    // in useAgentChat.ts and useCodex.ts) fires this call WHILE ITS OWN
    // `runInLane` body is still running, unawaited. An unmanaged local call
    // here could then land on the built-in engine or Ollama at the exact
    // moment the visible turn finishes and the next queued conversation gets
    // admitted: the VRAM-swap race this whole module exists to prevent,
    // started one level up from where run-lanes.ts can see it.
    //
    // The booking identity below is deliberately NOT `conversationId` itself.
    // `run-slot.ts` tracks same-conversation re-entry with a depth counter so
    // a foreground sub-agent can call back into its own parent's lane without
    // deadlocking; that counter is still greater than zero right now, because
    // the visible turn's own `runInLane` body has not returned yet. Booking
    // under the real id would silently take the fast re-entry path, run this
    // call immediately, and register nothing that keeps the lane held once
    // the visible turn's own body finishes and releases behind it: exactly
    // the unmanaged race this change is meant to close. A distinct suffixed
    // id is a different identity to `admit`, so it queues for real behind
    // whichever run currently holds the lane (the visible turn, still
    // running) and gets its own real `release`. It cannot deadlock the way
    // the sub-agent case can: extraction never blocks the visible turn on
    // itself (it is `void`-fired, never awaited by the turn), so there is no
    // cycle for a real queue wait to close.
    //
    // Runde 5 Folgeposten 3 (review-lanes.md Runde 2, Punkt 5 Fund 4): a
    // RUNNING extraction used to be unstoppable: `abort: () => {}` was a
    // literal no-op, so `stopAllBackgroundWork` (sign-out, window close, app
    // quit) reached a QUEUED extraction (pulls it out of the waiting room,
    // it never runs) but not a running one: the stream kept going to
    // completion after the user believed they had stopped background work. A
    // real `AbortController` closes
    // that: `abort()` cancels the in-flight fetch, the `for await` loop below
    // sees its `AbortError`, and the outer `catch` already swallows every
    // extraction failure (silent by contract, always was).
    const extractionAbort = new AbortController()
    await runInLane(
      { conversationId: `${conversationId}::memory-extraction`, lane: laneOf(callModel, currentLaneFacts()), abort: () => extractionAbort.abort() },
      async () => {
        // Same num_ctx as the chat that just ran on this model. Ollama reloads
        // the model whenever num_ctx changes between requests, so an
        // options-less extraction call silently dropped the user's context
        // back to the default and paid a second model load per turn. Resolved
        // for the model this call actually runs on.
        const numCtx = await resolveAgentNumCtx(
          modelId,
          getProviderIdFromModel(callModel),
          useSettingsStore.getState().settings.contextWindowOverride,
          callModel,
        )
        if (!guard.current()) return

        // Re-read immediately before the request; protected or other-project
        // titles must not leak through the extraction deduplication summary.
        const existingSummary = useMemoryStore.getState().entries
          .filter(e => !e.sensitive && !e.stale && e.scope === scope)
          .slice(-20).map(e => `- [${e.type}] ${e.title}`).join('\n')
        const messages = buildExtractionPrompt(userMessage, assistantResponse, existingSummary)
        // Collect full response via streaming
        let fullResponse = ''
        const stream = provider.chatStream(modelId, messages, {
          temperature: 0.1,
          // 800 tokens leaves headroom for models that pad the JSON with prose
          // or a short think block. At 500 the extraction tore off mid-object
          // and the whole turn was lost without a word. Same number as the web.
          maxTokens: 800,
          contextWindow: numCtx,
          signal: extractionAbort.signal,
        })

        for await (const chunk of stream) {
          if (!guard.current()) return
          if (chunk.content) fullResponse += chunk.content
          if (chunk.done) break
        }

        // Parse and save: each memory goes through embedding-based
        // write-decision resolution (ADD / UPDATE / NOOP) instead of a blind
        // addMemory.
        const result = parseExtractionResponse(fullResponse)
        if (result.shouldSave) {
          for (const memory of result.memories) {
            if (!guard.current()) return
            // Serial per-memory so the second (resolution) LLM call is
            // bounded and we don't fire N concurrent inferences. Each is
            // wrapped so one bad memory never aborts the rest.
            try {
              await resolveAndSaveMemory(memory, conversationId, scope, sourceKind, guard, extractionAbort.signal)
            } catch {
              if (!guard.current()) return
              // Per-memory failure: fall back to a plain add so the fact
              // isn't lost.
              memState.addMemory({
                type: memory.type,
                title: memory.title,
                description: memory.description,
                content: memory.content,
                tags: memory.tags,
                source: conversationId,
                scope,
                sourceKind,
              })
              guard.wrote()
            }
          }
        }
      },
    )
  } catch {
    // Extraction failures are non-critical — silently swallowed
  }
}

/**
 * Resolve a single freshly-extracted memory against existing SAME-TYPE
 * memories using embedding similarity, then write it via the right path:
 *
 *   - sim < ADD_THRESHOLD          → addMemory (today's behavior)
 *   - ADD_THRESHOLD ≤ sim < NOOP   → "merge band": one temp:0.1 resolution
 *                                    call → applyWriteDecision (ADD/UPDATE/NOOP)
 *   - sim ≥ NOOP_THRESHOLD         → near-duplicate → skip (NO LLM call)
 *
 * Fire-and-forget contract: any embedding/LLM failure falls back to a plain
 * addMemory so a fact is never silently dropped. Never blocks the chat turn.
 */
async function resolveAndSaveMemory(memory: ExtractedMemory, conversationId: string, scope: string | undefined, sourceKind: MemoryFile['sourceKind'], guard: MemoryWriteGuard, abortSignal: AbortSignal): Promise<void> {
  const memState = useMemoryStore.getState()
  const addPlain = (): string => {
    if (!guard.current()) return ''
    const id = memState.addMemory({
      type: memory.type,
      title: memory.title,
      description: memory.description,
      content: memory.content,
      tags: memory.tags,
      source: conversationId,
      sourceKind,
      scope,
    })
    guard.wrote()
    return id
  }

  // Same-type, non-stale existing memories are the only merge candidates —
  // a "user" fact never merges into a "reference", etc.
  const sameType: MemoryFile[] = memState.entries.filter(
    (e) => e.type === memory.type && e.stale !== true && !e.sensitive && e.scope === scope,
  )
  if (sameType.length === 0) {
    addPlain()
    return
  }

  // Embed the new fact (title + content, mirroring the store's embedText).
  let newVec: number[] | null = null
  try {
    const [vec] = await generateEmbeddings([`${memory.title}\n${memory.content}`], 'nomic-embed-text')
    if (vec && vec.length > 0) newVec = vec
  } catch {
    // Ollama unreachable → can't compute similarity → just add (offline-safe).
  }
  if (!guard.current()) return
  if (!newVec) {
    addPlain()
    return
  }

  // Hydrate vectors for same-type candidates and find the most similar one.
  const vecMap = await loadVectors(sameType.map((e) => e.id))
  if (!guard.current()) return
  let bestSim = -1
  let bestEntry: MemoryFile | null = null
  const scored: Array<{ entry: MemoryFile; sim: number }> = []
  for (const e of sameType) {
    const rec = vecMap.get(e.id)
    if (!rec || rec.dim !== newVec.length) continue
    const sim = cosineSimilarity(newVec, rec.vector)
    scored.push({ entry: e, sim })
    if (sim > bestSim) {
      bestSim = sim
      bestEntry = e
    }
  }

  // No comparable vectors yet (candidates not embedded) → treat as new.
  if (!bestEntry || bestSim < 0) {
    addPlain()
    return
  }

  // Near-duplicate → already captured → skip entirely (NO second LLM call).
  if (bestSim >= NOOP_THRESHOLD) return

  // Clearly distinct → add as new (NO second LLM call).
  if (bestSim < ADD_THRESHOLD) {
    addPlain()
    return
  }

  // ── Merge band: ambiguous. Ask the LLM to resolve. ────────────
  const topK: SimilarExisting[] = scored
    .sort((a, b) => b.sim - a.sim)
    .slice(0, RESOLUTION_TOP_K)
    .map(({ entry }) => ({ id: entry.id, title: entry.title, content: entry.content }))

  // Add the candidate first so an UPDATE can mark it superseded and a parse
  // failure (→ ADD) still keeps the fact. NOOP removes it again below.
  const newId = addPlain()

  let decision
  try {
    const { activeModel } = useModelStore.getState()
    if (!activeModel) return // candidate already added; leave as ADD
    // Second silent call of the turn — same cost policy as the extraction
    // itself (plan A7). Gated out means the candidate simply stays a plain
    // ADD, which is the same outcome a failed resolution already produces.
    const call = resolveSilentCall(activeModel)
    if (!call) return
    const { provider, modelId } = call
    if (!guard.current()) return
    const currentEntries = useMemoryStore.getState().entries
    if (topK.some(candidate => !currentEntries.some(entry => entry.id === candidate.id && !entry.sensitive && entry.scope === scope && entry.content === candidate.content))) return
    const messages = buildResolutionPrompt(
      { title: memory.title, content: memory.content },
      topK,
    )
    let full = ''
    const stream = provider.chatStream(modelId, messages, { temperature: 0.1, maxTokens: 300, signal: abortSignal })
    for await (const chunk of stream) {
      if (!guard.current()) return
      if (chunk.content) full += chunk.content
      if (chunk.done) break
    }
    decision = parseResolutionResponse(full, topK.map((t) => t.id))
  } catch {
    // Resolution call failed → leave the candidate as a plain ADD.
    return
  }

  if (!guard.current()) return

  if (decision.action === 'ADD') {
    // Already added as `newId` — nothing more to do.
    return
  }
  if (decision.action === 'NOOP') {
    // Duplicate after all → undo the speculative add.
    if (newId) useMemoryStore.getState().removeMemory(newId)
    guard.wrote()
    return
  }
  // UPDATE: merge into the target, mark the speculative candidate superseded.
  useMemoryStore.getState().applyWriteDecision(decision, { newId: newId || undefined })
  guard.wrote()
}

/**
 * The hook's surface, built once at module load.
 *
 * `extractMemoriesFromPair` is a module function — it closes over nothing from
 * a render, so it is already as stable as a value gets and there was nothing
 * for `useCallback` to memoise. Wrapping it also broke React 19's `use-memo`
 * rule, which insists the memo hooks take an inline function so the compiler
 * can see what it is memoising. Handing back a frozen object keeps the
 * identity every consumer had.
 */
const MEMORY_API = Object.freeze({
  /**
   * Fire-and-forget extraction: asks the active LLM to analyze a conversation
   * exchange and save any extracted memories. Rate-limited to every 3rd turn
   * and skips short responses.
   */
  extractAndSave: extractMemoriesFromPair,
})

export function useMemory() {
  return MEMORY_API
}
