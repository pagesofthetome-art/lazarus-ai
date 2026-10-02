import { RTVIEvent, RTVIMessage, RTVIMessageType, messageSizeWithinLimit } from '@pipecat-ai/client-js'
import type { PipecatClient, LLMFunctionCallInProgressData, LLMFunctionCallStoppedData } from '@pipecat-ai/client-js'
import { executeParallel } from './agents/tool-executor'
import { stableArgsHash } from './agents/block-helpers'
import type { AgentRunContext } from './agent-context'
import type { ToolRegistry } from './mcp/tool-registry'
import type { PermissionMap, PermissionLevel } from './mcp/types'
import { resolveApprovalLevel } from '../lib/agent-approval-policy'
import { MUTATING_TOOLS } from '../lib/mutating-tools'
import type { VoiceLoopStore, VoiceLoopState } from '../stores/voiceLoopStore'

type Client = Pick<PipecatClient, 'on' | 'off' | 'transport' | 'connected'>
export interface VoiceToolPermissions {
  categories: PermissionMap
  overrides: Record<string, PermissionLevel>
}
export interface VoiceToolBridgeOptions {
  client: Client
  registry: ToolRegistry
  run: AgentRunContext
  store: VoiceLoopStore
  // Both values originate in the app, never from an RTVI message.
  offeredTools: readonly string[]
  permissions: () => VoiceToolPermissions
  autonomous?: boolean
  toolTimeoutMs?: number
}

// Only the app executes tools. This bridge owns one session and is not reused
// after stop/disconnect. Bounded receipts prevent duplicate side effects.
export class VoiceToolBridge {
  private readonly options: VoiceToolBridgeOptions
  private readonly generation: number
  private readonly abort = new AbortController()
  private readonly offered: Set<string>
  private readonly receipts = new Map<string, string>()
  private readonly calls = new Map<string, AbortController>()
  private queue: Promise<void> = Promise.resolve()
  private resolveApproval: ((approved: boolean) => void) | null = null
  private readonly parentAbort = () => this.stop()
  private readonly connected = () => this.update({ status: 'connected' })

  constructor(options: VoiceToolBridgeOptions) {
    this.options = options
    this.generation = options.store.getState().generation + 1
    options.store.setState({ generation: this.generation, error: null })
    this.offered = new Set(options.offeredTools)
    options.client.on(RTVIEvent.LLMFunctionCallInProgress, this.receive)
    options.client.on(RTVIEvent.LLMFunctionCallStopped, this.cancel)
    options.client.on(RTVIEvent.Disconnected, this.parentAbort)
    options.client.on(RTVIEvent.Connected, this.connected)
    options.run.abortSignal?.addEventListener('abort', this.parentAbort, { once: true })
    options.store.setState({ status: options.client.connected ? 'connected' : 'idle' })
    if (options.run.abortSignal?.aborted) this.stop()
  }

  answer(approved: boolean): void {
    this.resolveApproval?.(approved)
  }

  private update(state: Partial<VoiceLoopState>): void {
    if (this.options.store.getState().generation === this.generation) this.options.store.setState(state)
  }

  stop(): void {
    if (this.abort.signal.aborted) return
    this.abort.abort()
    this.resolveApproval?.(false)
    const { client, run } = this.options
    client.off(RTVIEvent.LLMFunctionCallInProgress, this.receive)
    client.off(RTVIEvent.LLMFunctionCallStopped, this.cancel)
    client.off(RTVIEvent.Disconnected, this.parentAbort)
    client.off(RTVIEvent.Connected, this.connected)
    run.abortSignal?.removeEventListener('abort', this.parentAbort)
    this.calls.clear()
    this.receipts.clear()
    this.update({ status: 'stopped', pendingApproval: null, currentTool: null })
  }

  private fail(): void {
    this.stop()
    this.update({ status: 'error', error: 'The voice tool session stopped safely. Start a new session to continue.' })
  }

  private cancel = (data: LLMFunctionCallStoppedData): void => {
    if (data.cancelled) this.calls.get(data.tool_call_id)?.abort()
  }

  private receive = (data: LLMFunctionCallInProgressData): void => {
    if (this.abort.signal.aborted) return
    if (!this.options.client.connected || this.options.store.getState().mode !== 'assistant') {
      this.fail()
      return
    }
    const id = data?.tool_call_id
    const name = data?.function_name
    const args = data?.arguments
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)
      || typeof name !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(name)
      || !args || typeof args !== 'object' || Array.isArray(args)) {
      this.fail()
      return
    }
    let snapshot: Record<string, unknown>
    let fingerprint: string
    try {
      const serialized = JSON.stringify(args)
      if (new TextEncoder().encode(serialized).byteLength > 16_384) throw new Error('Oversized arguments')
      snapshot = JSON.parse(serialized) as Record<string, unknown>
      fingerprint = name + ':' + stableArgsHash(snapshot)
    } catch {
      this.fail()
      return
    }
    const prior = this.receipts.get(id)
    if (prior) {
      if (prior !== fingerprint) this.fail()
      return
    }
    // Never evict a receipt and allow an old mutation to run again.
    if (this.receipts.size >= 256 || this.calls.size >= 16) {
      this.fail()
      return
    }
    this.receipts.set(id, fingerprint)
    const control = new AbortController()
    this.calls.set(id, control)
    // One serial app queue also orders calls arriving in different RTVI events.
    this.queue = this.queue.then(() => this.execute(id, name, snapshot, control))
      .catch(() => this.fail())
  }

  private level(name: string): PermissionLevel {
    const { registry, permissions, run, autonomous } = this.options
    const tool = registry.getToolByName(name)
    if (!tool || !this.offered.has(name)) return 'blocked'
    const p = permissions()
    const level = resolveApprovalLevel(name, {
      categoryLevel: p.categories[tool.category], override: p.overrides[name],
      codexMode: run.mode, execConfirm: run.execApproval?.confirmExec,
      readOnlyRun: run.readOnlyShellTurn,
    })
    if (level === 'auto' && !autonomous && MUTATING_TOOLS.has(name)) return 'confirm'
    return level
  }

  private async approve(id: string, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false
    const level = this.level(name)
    if (level === 'blocked') return false
    if (level === 'auto') return true
    return new Promise<boolean>((resolve) => {
      const finish = (approved: boolean) => {
        signal.removeEventListener('abort', aborted)
        this.resolveApproval = null
        this.update({ pendingApproval: null })
        resolve(approved && !signal.aborted && this.level(name) !== 'blocked')
      }
      const aborted = () => finish(false)
      this.resolveApproval = finish
      signal.addEventListener('abort', aborted, { once: true })
      this.update({ pendingApproval: { id, name, args } })
    })
  }

  private async execute(id: string, name: string, args: Record<string, unknown>, control: AbortController): Promise<void> {
    const { registry, run, client } = this.options
    if (this.abort.signal.aborted) return
    const signal = AbortSignal.any([this.abort.signal, control.signal])
    const timeout = Math.min(600_000, Math.max(100, this.options.toolTimeoutMs ?? 120_000))
    const timer = setTimeout(() => control.abort(), timeout)
    this.update({ currentTool: name })
    let approvalLevel: PermissionLevel = 'blocked'
    try {
      const [result] = await executeParallel([{ id, toolName: name, args, run: { ...run, abortSignal: signal } }], {
        getTool: (toolName) => this.offered.has(toolName) ? registry.getToolByName(toolName) : undefined,
        awaitApproval: (request) => {
          approvalLevel = this.level(name)
          return this.approve(id, name, request.args, signal)
        },
        execute: async (toolName, validatedArgs, context) => {
          const current = this.level(toolName)
          if (signal.aborted || current === 'blocked' || (current === 'confirm' && approvalLevel !== 'confirm')) {
            return 'Error: Tool permission changed before dispatch.'
          }
          return registry.execute(toolName, validatedArgs, 0, context, signal)
        },
      }, { abortSignal: signal })
      if (!this.abort.signal.aborted) {
        const message = new RTVIMessage(RTVIMessageType.LLM_FUNCTION_CALL_RESULT, {
          function_name: name, tool_call_id: id, arguments: args,
          result: result.status === 'completed'
            ? { status: 'completed', text: (result.result ?? '').slice(0, 65_536), truncated: (result.result?.length ?? 0) > 65_536 }
            : { status: result.status, error: 'The tool did not complete. It may have been denied, cancelled or failed validation.' },
        })
        if (!messageSizeWithinLimit(message, client.transport.maxMessageSize)) {
          this.fail()
          return
        }
        client.transport.sendMessage(message)
      }
    } finally {
      clearTimeout(timer)
      this.calls.delete(id)
      this.update({ currentTool: null })
    }
  }
}
