import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { PipecatClient, RTVIMessage, RTVIMessageType } from '@pipecat-ai/client-js'
import { VoiceToolSession } from '../../src/components/astra/VoiceToolSession'
import { VoiceTestTransport } from '../../src/api/__tests__/helpers/voice-transport'
import { ToolRegistry } from '../../src/api/mcp/tool-registry'
import { DEFAULT_PERMISSIONS } from '../../src/api/mcp/types'
import type { AgentRunContext } from '../../src/api/agent-context'

export function mount() {
  const transport = new VoiceTestTransport()
  const client = new PipecatClient({ transport, enableMic: false, enableCam: false })
  const registry = new ToolRegistry()
  let calls = 0
  registry.registerBuiltin({ name: 'file_write', category: 'filesystem', source: 'builtin', description: 'Proof-only executor',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }, async () => {
    document.getElementById('executions')!.textContent = String(++calls)
    return 'Proof-only result, no file written.'
  })
  const run: AgentRunContext = { token: 'browser-proof', chatId: 'proof', conversationId: 'proof', workspace: null,
    artifactMode: false, readOnlyShellTurn: false, mode: null, artifacts: [] }
  const options = { registry, run, offeredTools: ['file_write'],
    permissions: () => ({ categories: DEFAULT_PERMISSIONS, overrides: {} }) }
  createRoot(document.getElementById('root')!).render(createElement(VoiceToolSession, { client, options, profile: 'local' }))
  let id = 0
  window.addEventListener('proof-call', () => transport.receive(new RTVIMessage(RTVIMessageType.LLM_FUNCTION_CALL_IN_PROGRESS,
    { tool_call_id: `call-${++id}`, function_name: 'file_write', arguments: { path: 'report.txt' } })))
}
