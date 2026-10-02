/**
 * The chat mode a conversation runs under, with the legacy default applied.
 *
 * `Conversation.mode` (src/types/chat.ts) is optional. It was introduced on
 * 2026-04-05 (5382d831); every conversation saved before that date has no
 * `mode` field at all, `migratePersistedChat` (chatStore.ts) does not add one
 * on load, and the store deliberately has no version/migrate step. Imported
 * conversations are the same story: `chatbot-export.ts` builds Conversation
 * objects with no `mode` field either.
 *
 * The house rule for an absent `mode` has always been "treat it as `lu`"
 * (RecentChats.tsx originally, `(c.mode ?? 'lu') === 'lu'`). Review Teil 15
 * found that rule re-implemented ad hoc in ChatView.tsx and, in one spot,
 * dropped: `conv.mode !== 'lu' && conv.mode !== 'remote'` reads `false` for
 * `undefined`, so a pre-migration or imported conversation with no messages
 * showed a blank main area instead of the empty-state landing block. One
 * reader here keeps that rule in exactly one place.
 */

import type { Conversation } from '../types/chat'

/** The conversation shape this needs. Kept structural, like
 *  conversation-model.ts, so a partial conversation can ask too. */
export interface ConversationModeSource {
  mode?: Conversation['mode']
}

/** `conv.mode`, defaulted to `'lu'` for a conversation that predates the
 *  field or came in through an importer that never set it. */
export function conversationMode(
  conv: ConversationModeSource | null | undefined,
): NonNullable<Conversation['mode']> {
  return conv?.mode ?? 'lu'
}
