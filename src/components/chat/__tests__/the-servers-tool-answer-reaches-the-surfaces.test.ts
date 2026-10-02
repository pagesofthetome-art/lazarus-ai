/**
 * @vitest-environment jsdom
 *
 * Does the desktop believe the server about tool calling on a cloud model, or
 * does it guess?
 *
 * Checked on 2026-09-11 for the 3.0.0 leftovers. It believes it, and nothing
 * here needed fixing: `/api/inference/v1/models` emits `supports_tools` per
 * model, `toModelEntry` parses it (openai-provider.ts), `listModels` maps it
 * as `supportsTools: m.supports_tools ?? true`, `providerModelRow` carries it,
 * and both surfaces hand it to the one precedence
 * function: the Agent toggle at AgentModeToggle.tsx:53-56 and the picker at
 * ModelSelector.tsx:1116 and :1451. For a cloud model a declared false becomes
 * 'none' (tool-support.ts:60-62), which is right, because the proxy already
 * does the prompt translation server side and the app has nothing left to fall
 * back to.
 *
 * What was missing was the proof. The Ollama branch of `useModels` has a
 * guard against exactly this loss (ollama-capabilities.test.ts) because the
 * field HAS died in a literal of that shape before. This exercises the same
 * row mapper with a user-configured OpenAI-compatible provider.
 *
 * So this drives the real chain, the way effort-reaches-the-composer does: an
 * HTTP response, the real OpenAIProvider, the real row mapper, the real store,
 * the real toggle. Nothing between the wire and the button is stubbed.
 *
 * Run: npx vitest run src/components/chat/__tests__/the-servers-tool-answer-reaches-the-surfaces.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { render, screen, cleanup } from '@testing-library/react'
import { OpenAIProvider } from '../../../api/providers/openai-provider'
import { providerModelRow } from '../../../lib/provider-model-row'
import { resolveToolSupport, canUseTools } from '../../../lib/tool-support'
import { useModelStore } from '../../../stores/modelStore'
import { useChatStore } from '../../../stores/chatStore'
import { useAgentModeStore } from '../../../stores/agentModeStore'
import { AgentModeToggle } from '../AgentModeToggle'
import type { CloudModel } from '../../../types/models'

const CLOUD_BASE = 'https://models.example.invalid/v1'

/**
 * The shape the route really answers with, cut to what this file is about.
 * `supports_tools` is emitted on EVERY entry, unlike `unfiltered` and the
 * effort ladder, which are only spread in when present.
 */
const CATALOGUE = [
  {
    id: 'example/tool-model', object: 'model', owned_by: 'example-provider', name: 'Tool model',
    context_length: 200000, input_modalities: ['text'], supports_tools: true,
  },
  {
    id: 'example/no-tools', object: 'model', owned_by: 'example-provider', name: 'No tools model',
    context_length: 131072, input_modalities: ['text'], supports_tools: false,
  },
  {
    // An older deployment that does not carry the field at all. Optimistic on
    // purpose: nobody should lose tools because a server predates a key.
    id: 'legacy/no-field', object: 'model', owned_by: 'example-provider', name: 'Legacy',
    context_length: 32768, input_modalities: ['text'],
  },
]

const src = (rel: string) =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), 'utf8')

function serveCatalogue() {
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (url: unknown) => {
    if (String(url).endsWith('/v1/models')) {
      return new Response(JSON.stringify({ object: 'list', tier: 'pro', data: CATALOGUE }), { status: 200 })
    }
    // This fixture exposes only its model list endpoint.
    return new Response('Not Found', { status: 404 })
  }) as typeof fetch)
}

/** HTTP, provider, rebrand, row mapper, store. The whole road. */
async function loadCatalogue(): Promise<CloudModel[]> {
  const provider = new OpenAIProvider({
    id: 'openai', name: 'Test provider', enabled: true,
    baseUrl: CLOUD_BASE, apiKey: 'test-token', isLocal: false,
  })
  const listed = await provider.listModels()
  const rows = listed.map((pm) => providerModelRow({ ...pm, provider: 'openai', providerName: 'Test provider' }))
  useModelStore.setState({ models: rows, activeModel: rows[0].name })
  return rows
}

/** The Agent button as the user sees it, with `name` the active model. */
function agentButtonFor(name: string): HTMLButtonElement {
  useModelStore.setState({ activeModel: name })
  render(createElement(AgentModeToggle))
  return screen.getByTitle(/Agent Mode|not agent-compatible/) as HTMLButtonElement
}

beforeEach(() => {
  serveCatalogue()
  useChatStore.setState({
    conversations: [{
      id: 'c1', title: 'x', messages: [], model: 'openai::example/tool-model',
      systemPrompt: '', createdAt: Date.now(), updatedAt: Date.now(),
    }],
    activeConversationId: 'c1',
  })
  useAgentModeStore.setState({ agentModeActive: {}, workspaces: {} })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('the field survives the road from the wire to the store', () => {
  it('carries the server answer for each model, true and false alike', async () => {
    const rows = await loadCatalogue()
    expect(rows.map((r) => [r.model, r.supportsTools])).toEqual([
      ['example/tool-model', true],
      ['example/no-tools', false],
      // Absent means absent, and the provider fills it optimistically.
      ['legacy/no-field', true],
    ])
  })

  it('COUNTER-CHECK: the false is the server talking, not a default', async () => {
    // If the row were built from the id alone, every model would come back
    // capable and this file would pass for the wrong reason.
    const rows = await loadCatalogue()
    const declared = rows.filter((r) => r.supportsTools === false)
    expect(declared).toHaveLength(1)
    expect(declared[0].model).toBe('example/no-tools')
  })
})

describe('and the verdict the surfaces read follows it', () => {
  it('refuses tools on the model the server says cannot take them', async () => {
    const rows = await loadCatalogue()
    const euryale = rows[1]
    expect(resolveToolSupport({ name: euryale.name, supportsTools: euryale.supportsTools })).toBe('none')
    expect(canUseTools({ name: euryale.name, supportsTools: euryale.supportsTools })).toBe(false)
  })

  it('allows them on the two the server does not refuse', async () => {
    const rows = await loadCatalogue()
    for (const row of [rows[0], rows[2]]) {
      expect(canUseTools({ name: row.name, supportsTools: row.supportsTools })).toBe(true)
    }
  })
})

describe('the Agent toggle shows it', () => {
  it('greys the button out for the model the server refuses', async () => {
    const rows = await loadCatalogue()
    const button = agentButtonFor(rows[1].name)
    expect(button.disabled).toBe(true)
    expect(button.title).toBe('This model is not agent-compatible')
  })

  it('leaves it live for the model the server allows', async () => {
    const rows = await loadCatalogue()
    const button = agentButtonFor(rows[0].name)
    expect(button.disabled).toBe(false)
    expect(button.title).toContain('Agent Mode is off')
  })

  it('asks with the row from the server rather than deriving from the name', () => {
    // The two names are one family apart and neither carries a capability;
    // a name heuristic could not tell them apart, so the button being right
    // above is only meaningful because it asked.
    const toggle = src('../AgentModeToggle.tsx')
    expect(toggle).toMatch(/supportsTools' in activeModelMeta \? activeModelMeta\.supportsTools/)
    expect(toggle).toMatch(/canUseTools\(\{\s*name: activeModel,\s*supportsTools: serverTools\s*\}\)/)
  })
})

describe('the picker shows it', () => {
  it('drops a tool-less model from the Code surface and badges it in chat', () => {
    const picker = src('../../models/ModelSelector.tsx')
    // The Code list filter and the per-row badge both hand the row's own
    // server answer to the same function.
    expect(picker).toMatch(/canUseTools\(\{ name: m\.name, supportsTools: m\.supportsTools \}\)/)
    expect(picker).toMatch(/supportsTools' in model \? model\.supportsTools : undefined/)
  })

  it('and the row mapper is the single place that carries the field', () => {
    expect(src('../../../lib/provider-model-row.ts')).toMatch(/supportsTools: pm\.supportsTools/)
  })
})
