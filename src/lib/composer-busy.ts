/**
 * Who is busy: this chat, or another one.
 *
 * The composer used to read ONE boolean, `useChat().isGenerating`, which is
 * true while anything anywhere is answering. So every other conversation lost
 * its Send button and grew a Stop button that aborted the foreign run
 * (measured on the box, T1 nebenfund 4 and T1 point 4). The per-conversation
 * truth already existed in `generationStore.generating`; only the composer
 * never asked it.
 *
 * Runde 4 (review-lanes.md Blocker 1+6): `otherChat` used to reach the
 * composer too, as `busyElsewhere`, a lock that dropped this chat's Send
 * button and put up a line whenever ANY other conversation was generating.
 * That lock is gone: a local second send now queues visibly instead of
 * racing the first one for the built-in engine's one slot (`lib/run-slot.ts`,
 * `lib/run-lanes.ts`), and a cloud second send just runs alongside the first,
 * so there is nothing left for a cross-conversation lock to protect against.
 * `otherChat` stays computed here, unexported to a caller by choice, purely
 * because `thisChat` below still needs it: `hookGenerating` is wider than the
 * map (see below), and without excluding a run that another conversation
 * clearly owns, a stale or orphaned hook flag could hand THIS chat's Stop
 * button to a run that belongs elsewhere.
 *
 * `hookGenerating` stays in the answer on purpose. It is wider than the map:
 * it also covers a run this app instance did not register, an orphaned run
 * picked up after a reload, and the window between starting a stream and
 * registering it. When it is true and no OTHER conversation owns a run, the
 * run belongs to the chat on screen, and that chat keeps its Stop button. The
 * rule never turns a Stop into a bare Send, so nothing becomes unstoppable.
 */
export interface ComposerBusy {
  /** The conversation on screen is answering: it shows Stop. */
  thisChat: boolean
}

export function composerBusy(
  hookGenerating: boolean,
  generatingMap: Record<string, boolean>,
  activeConversationId: string | null,
): ComposerBusy {
  const otherChat = Object.entries(generatingMap)
    .some(([id, on]) => on && id !== activeConversationId)
  const own = !!activeConversationId && !!generatingMap[activeConversationId]
  return {
    thisChat: own || (hookGenerating && !otherChat),
  }
}
