// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { PipecatClient, RTVIMessage, RTVIMessageType } from '@pipecat-ai/client-js'
import { VoiceTestTransport } from './helpers/voice-transport'
import { VoiceToolBridge } from '../voice-tool-bridge'
import type { VoiceToolBridgeOptions } from '../voice-tool-bridge'
import { ToolRegistry } from '../mcp/tool-registry'
import { DEFAULT_PERMISSIONS } from '../mcp/types'
import type { PermissionLevel } from '../mcp/types'
import type { AgentRunContext } from '../agent-context'
import { createVoiceLoopStore } from '../../stores/voiceLoopStore'
import { VoiceToolSession } from '../../components/astra/VoiceToolSession'

const bridges: VoiceToolBridge[] = []
afterEach(() => { cleanup(); for (const b of bridges.splice(0)) b.stop() })

function setup(attach = true) {
  const transport = new VoiceTestTransport()
  const client = new PipecatClient({ transport, enableMic: false, enableCam: false })
  const registry = new ToolRegistry()
  const execute = vi.fn(async (_args: Record<string, unknown>, _run?: AgentRunContext, _signal?: AbortSignal) => 'done')
  for (const [name, category] of [['file_write', 'filesystem'], ['web_fetch', 'web']] as const) {
    registry.registerBuiltin({ name, category, source: 'builtin', description: 'Test tool',
      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } }, execute)
  }
  const store = createVoiceLoopStore('local', 'assistant')
  const parent = new AbortController()
  const run: AgentRunContext = { token: 'voice-test', chatId: 'chat-1', conversationId: 'chat-1', workspace: null,
    artifactMode: false, readOnlyShellTurn: false, mode: null, artifacts: [], abortSignal: parent.signal }
  const permissions = { categories: { ...DEFAULT_PERMISSIONS }, overrides: {} as Record<string, PermissionLevel> }
  const options: VoiceToolBridgeOptions = { client, registry, run, store, offeredTools: ['file_write', 'web_fetch'], permissions: () => permissions }
  const bridge = attach ? new VoiceToolBridge(options) : null
  if (bridge) bridges.push(bridge)
  const call = (id = 'call-1', name = 'file_write', args: Record<string, unknown> = { value: 'hello' }) =>
    transport.receive(new RTVIMessage(RTVIMessageType.LLM_FUNCTION_CALL_IN_PROGRESS, { tool_call_id: id, function_name: name, arguments: args }))
  return { transport, client, execute, store, parent, run, permissions, options, bridge, call }
}

it('uses actual SDK events and result envelopes, then executes a permitted read in its run', async () => {
  const s = setup()
  s.call('read-1', 'web_fetch')
  await waitFor(() => expect(s.transport.sent).toHaveLength(1))
  expect(s.execute).toHaveBeenCalledTimes(1)
  expect(s.execute.mock.calls[0][1]?.conversationId).toBe('chat-1')
  expect(s.transport.sent[0]).toMatchObject({ label: 'rtvi-ai', type: 'llm-function-call-result',
    data: { tool_call_id: 'read-1', result: { status: 'completed', text: 'done' } } })
})

it('requires confirmation and does not execute a duplicate call twice', async () => {
  const s = setup()
  s.call(); s.call()
  await waitFor(() => expect(s.store.getState().pendingApproval?.name).toBe('file_write'))
  expect(s.execute).not.toHaveBeenCalled()
  s.bridge!.answer(true)
  await waitFor(() => expect(s.execute).toHaveBeenCalledTimes(1))
  s.call()
  await waitFor(() => expect(s.transport.sent).toHaveLength(1))
  expect(s.execute).toHaveBeenCalledTimes(1)
})

it('stops on reuse of a call ID with different arguments', async () => {
  const s = setup()
  s.call(); s.call('call-1', 'file_write', { value: 'changed' })
  expect(s.store.getState().status).toBe('error')
  await Promise.resolve()
  expect(s.execute).not.toHaveBeenCalled()
})

for (const reason of ['blocked', 'not-offered', 'invalid-schema', 'denied', 'revoked', 'read-only'] as const) {
  it(`does not dispatch a ${reason} call`, async () => {
    const s = setup()
    if (reason === 'blocked') s.permissions.categories.filesystem = 'blocked'
    if (reason === 'read-only') s.run.readOnlyShellTurn = true
    s.call('call-1', reason === 'not-offered' ? 'shell_execute' : 'file_write', reason === 'invalid-schema' ? {} : { value: 'x' })
    if (reason === 'denied' || reason === 'revoked') {
      await waitFor(() => expect(s.store.getState().pendingApproval).not.toBeNull())
      if (reason === 'revoked') s.permissions.categories.filesystem = 'blocked'
      s.bridge!.answer(reason === 'revoked')
    }
    await waitFor(() => expect(s.transport.sent).toHaveLength(1))
    expect(s.execute).not.toHaveBeenCalled()
  })
}

it('parent stop clears approvals and prevents queued work and late results', async () => {
  const s = setup()
  s.call(); s.call('call-2', 'web_fetch')
  await waitFor(() => expect(s.store.getState().pendingApproval).not.toBeNull())
  s.parent.abort(); s.bridge!.answer(true)
  await Promise.resolve()
  expect(s.store.getState().pendingApproval).toBeNull()
  expect(s.store.getState().status).toBe('stopped')
  expect(s.execute).not.toHaveBeenCalled()
  expect(s.transport.sent).toHaveLength(0)
})

it('honors per-call cancellation while waiting for approval', async () => {
  const s = setup()
  s.call()
  await waitFor(() => expect(s.store.getState().pendingApproval).not.toBeNull())
  s.transport.receive(new RTVIMessage(RTVIMessageType.LLM_FUNCTION_CALL_STOPPED, { tool_call_id: 'call-1', cancelled: true }))
  await waitFor(() => expect(s.transport.sent).toHaveLength(1))
  expect(s.execute).not.toHaveBeenCalled()
  expect(s.store.getState().pendingApproval).toBeNull()
})

it('forwards stop to an already running tool', async () => {
  const s = setup()
  let signal: AbortSignal | undefined
  s.execute.mockImplementation(async (_args, _run, abort) => {
    signal = abort
    return new Promise((resolve) => abort!.addEventListener('abort', () => resolve('cancelled'), { once: true }))
  })
  s.call('read-1', 'web_fetch')
  await waitFor(() => expect(signal).toBeDefined())
  s.bridge!.stop()
  expect(signal!.aborted).toBe(true)
  await Promise.resolve()
  expect(s.transport.sent).toHaveLength(0)
})

it('never enables tools in Live mode and bounds oversized arguments', () => {
  const live = setup()
  live.store.setState({ mode: 'live' }); live.call()
  expect(live.store.getState().status).toBe('error')
  const large = setup()
  large.call('call-1', 'file_write', { value: 'x'.repeat(17000) })
  expect(large.store.getState().status).toBe('error')
  expect(large.execute).not.toHaveBeenCalled()
})

it('requires confirmation for mutations even when the category is auto in a supervised session', async () => {
  const s = setup()
  s.permissions.categories.filesystem = 'auto'
  s.call()
  await waitFor(() => expect(s.store.getState().pendingApproval).not.toBeNull())
  expect(s.execute).not.toHaveBeenCalled()
  s.bridge!.answer(false)
  await waitFor(() => expect(s.transport.sent).toHaveLength(1))
})

it('fails closed when the inbound queue exceeds its bound', async () => {
  const s = setup()
  for (let i = 0; i < 17; i++) s.call(`call-${i}`)
  expect(s.store.getState().status).toBe('error')
  await Promise.resolve()
  expect(s.execute).not.toHaveBeenCalled()
})

it('does not let an old bridge cleanup overwrite a replacement session store', async () => {
  const s = setup()
  s.call()
  await waitFor(() => expect(s.store.getState().pendingApproval).not.toBeNull())
  s.bridge!.stop()
  const next = new VoiceToolBridge(s.options)
  bridges.push(next)
  s.call('next-call')
  await waitFor(() => expect(s.store.getState().pendingApproval?.id).toBe('next-call'))
  expect(s.store.getState().generation).toBe(2)
  expect(s.store.getState().status).toBe('connected')
  expect(s.store.getState().currentTool).toBe('file_write')
})

it('renders actual React SDK bindings, displays the full payload and allows one approved call', async () => {
  const s = setup(false)
  render(createElement(VoiceToolSession, { client: s.client, options: s.options, profile: 'local' }))
  act(() => s.call('ui-call', 'file_write', { value: '<script>not markup</script>' }))
  const allow = await screen.findByRole('button', { name: 'Allow this call' })
  expect(screen.getByText(/<script>not markup<\/script>/)).toBeTruthy()
  expect(document.querySelector('section script')).toBeNull()
  expect(s.execute).not.toHaveBeenCalled()
  fireEvent.click(allow)
  await waitFor(() => expect(s.execute).toHaveBeenCalledTimes(1))
  fireEvent.click(screen.getByRole('button', { name: 'Stop voice tools' }))
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('stopped'))
})
