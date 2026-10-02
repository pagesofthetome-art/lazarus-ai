/**
 * @vitest-environment jsdom
 *
 * Auflage C2 (Abnahme 19.09.2026, review-ui-flashchip-memchips.md): the
 * regression guard in e2e/memory-hook-sources.spec.ts only checked for the
 * literal text "Memory sources". A reply renamed to something like "Sources
 * from memory" would still pass that check. This file adds a real render
 * test instead: it mounts the actual ChatView with an assistant message,
 * including one that still carries the retired `memorySources` field from an
 * old saved chat (see chatStore-migration.test.ts), and asserts no chip and
 * no <details>/<summary> element renders under the answer.
 *
 * NEGATIVE CONTROL for the query itself: a separate describe block mounts a
 * plain stand-in `<details><summary>Memory sources (1)</summary>...</details>`
 * markup (not the deleted component, which no longer exists) and proves the
 * same assertions used above WOULD fail against it. That is the evidence the
 * checks below are not vacuously true.
 *
 * Run: npx vitest run src/components/chat/__tests__/memory-sources-chip-is-gone.test.ts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { ChatView } from '../ChatView'
import { useChatStore } from '../../../stores/chatStore'
import { useModelStore } from '../../../stores/modelStore'
import { useUIStore } from '../../../stores/uiStore'
import { useCompareStore } from '../../../stores/compareStore'
import { useMemoryStore } from '../../../stores/memoryStore'
import type { Conversation, Message } from '../../../types/chat'
import type { MemoryFile } from '../../../types/agent-mode'

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0)
const MODEL = 'openai::Qwen3-4B-Q4_K_M'

/** An entry the retired MemorySources chip would have matched and shown. */
const memoryEntry: MemoryFile = {
  id: 'old-1',
  type: 'user',
  title: 'A remembered fact',
  description: 'test entry',
  content: 'SOURCEPROOF content',
  tags: [],
  createdAt: NOW - 5000,
  updatedAt: NOW - 5000,
  source: 'manual',
  scope: 'legacy',
}

/** An assistant answer still carrying the field an older build persisted.
 *  `Message` no longer declares `memorySources`; the cast mirrors what an
 *  old saved chat looks like once loaded, same shape as
 *  chatStore-migration.test.ts. */
function legacyAnswer(): Message {
  return {
    id: 'm2',
    role: 'assistant',
    content: 'the answer',
    timestamp: NOW - 1000,
    modelId: MODEL,
    memorySources: { ids: ['old-1'], scope: 'legacy', owner: 'A' },
  } as unknown as Message
}

const conversation = (assistant: Message): Conversation => ({
  id: 'c1',
  title: 'MEMCHIP-TEST',
  messages: [
    { id: 'm1', role: 'user', content: 'q', timestamp: NOW - 2000 },
    assistant,
  ],
  model: MODEL,
  systemPrompt: '',
  mode: 'lu',
  createdAt: NOW - 3000,
  updatedAt: NOW - 1000,
} as Conversation)

function show(conv: Conversation) {
  useChatStore.setState({ conversations: [conv], activeConversationId: conv.id })
  useModelStore.setState({ activeModel: MODEL, models: [] })
  render(createElement(ChatView))
}

beforeEach(() => {
  useUIStore.setState({ currentView: 'chat', sidebarOpen: false })
  useCompareStore.setState({ isComparing: false })
  useMemoryStore.setState({ entries: [memoryEntry], activeMemoryOwner: 'A' })
})

afterEach(() => {
  cleanup()
})

describe('no per-answer memory chip renders, real component, real store', () => {
  it('an ordinary assistant answer shows no "Memory sources" text', () => {
    show(conversation({ id: 'm2', role: 'assistant', content: 'the answer', timestamp: NOW - 1000, modelId: MODEL }))
    expect(screen.queryByText(/Memory sources/i)).toBeNull()
  })

  it('an ordinary assistant answer has no <details>/<summary> under it', () => {
    show(conversation({ id: 'm2', role: 'assistant', content: 'the answer', timestamp: NOW - 1000, modelId: MODEL }))
    expect(document.querySelectorAll('details, summary')).toHaveLength(0)
  })

  it('an OLD message carrying the retired memorySources field renders the same: nothing', () => {
    // The matching entry is in the store (memoryEntry, owner 'A') on purpose:
    // if MessageBubble still read message.memorySources, this is exactly the
    // input that would have produced "Memory sources (1)".
    show(conversation(legacyAnswer()))
    expect(screen.queryByText(/Memory sources/i)).toBeNull()
    expect(document.querySelectorAll('details, summary')).toHaveLength(0)
    expect(screen.getByText('the answer')).not.toBeNull()
  })
})

describe('NEGATIVE CONTROL: the assertions above are not vacuous', () => {
  function ChipStandIn() {
    // Mirrors the shape of the deleted MemorySources.tsx output, not the
    // component itself (which no longer exists). Only proves the queries
    // used above can find a chip when one is actually there.
    return createElement('details', { className: 'mt-2 text-xs' },
      createElement('summary', null, 'Memory sources (1)'))
  }

  it('the same queries DO find a chip when one is rendered', () => {
    render(createElement(ChipStandIn))
    expect(screen.queryByText(/Memory sources/i)).not.toBeNull()
    expect(document.querySelectorAll('details, summary')).toHaveLength(2)
  })
})
