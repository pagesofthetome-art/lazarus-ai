import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemoryFile } from '../../types/agent-mode'
vi.mock('../../api/backend', () => ({ backendCall: vi.fn(), isTauri: () => true }))
import { backendCall } from '../../api/backend'
import { useMemoryStore, __setMemoryEmbedFn } from '../memoryStore'
import { useRemoteStore, remoteMemoryChanged, REMOTE_MEMORY_CHANGED } from '../remoteStore'

const call = vi.mocked(backendCall)
const entry: MemoryFile = {
  id: 'proof-memory', type: 'user', title: 'Preference', description: '',
  content: 'Synthetic remembered preference', tags: [], source: 'manual',
  createdAt: Date.now(), updatedAt: Date.now(),
}
const started = { port: 11435, passcode: 'fixture', lanUrl: '', mobileUrl: '', passcodeExpiresAt: 1 }
const retrieve = useMemoryStore.getState().getMemoriesForPromptAsync
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => {
  call.mockReset().mockResolvedValue(started)
  useRemoteStore.setState({ enabled: false, loading: false, error: null, qrVisible: false })
  useMemoryStore.setState({ entries: [{ ...entry }], getMemoriesForPromptAsync: retrieve })
  __setMemoryEmbedFn(async () => [])
})
afterEach(async () => {
  call.mockResolvedValue(started)
  useRemoteStore.setState({ loading: false })
  await useRemoteStore.getState().stopServer()
  __setMemoryEmbedFn()
})

describe('automatic Remote memory revocation', () => {
  it('stops an unknown busy native operation before accepting recovered state', async () => {
    call.mockResolvedValue({ ...started, running: false, lifecycleBusy: true })
    await useRemoteStore.getState().refreshStatus()
    expect(call).toHaveBeenCalledWith('stop_remote_server')
    expect(useRemoteStore.getState().enabled).toBe(false)
    expect(useRemoteStore.getState().memoryNotice).toContain('was stopped during recovery')
  })

  it('retains an uncertain running state when busy recovery cannot stop native work', async () => {
    call.mockImplementation(async name => {
      if (name === 'stop_remote_server') throw new Error('Synthetic busy failure')
      return { ...started, running: false, lifecycleBusy: true }
    })
    await useRemoteStore.getState().refreshStatus()
    expect(useRemoteStore.getState().enabled).toBe(true)
    expect(useRemoteStore.getState().memoryNotice).toContain('could not be stopped')
    expect(useRemoteStore.getState().memoryNotice).not.toContain('Synthetic busy failure')
    expect(useRemoteStore.getState().qrVisible).toBe(false)
  })

  it.each(['startServer', 'restart'] as const)('stops after pending native %s completes without exposing its QR', async method => {
    const native = deferred<typeof started>()
    const command = method === 'restart' ? 'restart_remote_server' : 'start_remote_server'
    call.mockImplementation(async name => name === command ? native.promise : started)
    const start = useRemoteStore.getState()[method]()
    const cancelled = expect(start).rejects.toThrow('cancelled by a stop request')
    await vi.waitFor(() => expect(call.mock.calls.some(([name]) => name === command)).toBe(true))
    const stop = useRemoteStore.getState().stopServer()
    expect(call).not.toHaveBeenCalledWith('stop_remote_server')
    await expect(useRemoteStore.getState().startServer()).rejects.toThrow('starting or stopping')
    native.resolve(started)
    await cancelled
    await stop
    expect(call).toHaveBeenCalledWith('stop_remote_server')
    expect(call).not.toHaveBeenCalledWith('remote_qr_code')
    expect(useRemoteStore.getState().enabled).toBe(false)
    expect(useRemoteStore.getState().loading).toBe(false)
    expect(useRemoteStore.getState().qrVisible).toBe(false)
  })

  it('cancels during enrichment without sending a native start', async () => {
    const context = deferred<string>()
    const pending = vi.fn(() => context.promise)
    useMemoryStore.setState({ getMemoriesForPromptAsync: pending })
    const start = useRemoteStore.getState().startServer()
    const cancelled = expect(start).rejects.toThrow('cancelled by a stop request')
    await vi.waitFor(() => expect(pending).toHaveBeenCalled())
    const stop = useRemoteStore.getState().stopServer()
    context.resolve('Synthetic context')
    await cancelled
    await stop
    expect(call.mock.calls.some(([name]) => name === 'start_remote_server')).toBe(false)
    expect(useRemoteStore.getState().enabled).toBe(false)
  })

  it('retains the running state if stop after startup fails', async () => {
    const native = deferred<typeof started>()
    call.mockImplementation(async name => {
      if (name === 'start_remote_server') return native.promise
      if (name === 'stop_remote_server') throw new Error('Synthetic stop failure')
      return started
    })
    const start = useRemoteStore.getState().startServer()
    const cancelled = expect(start).rejects.toThrow('cancelled by a stop request')
    await vi.waitFor(() => expect(call.mock.calls.some(([name]) => name === 'start_remote_server')).toBe(true))
    const stop = useRemoteStore.getState().stopServer()
    native.resolve(started)
    await cancelled
    await stop
    expect(useRemoteStore.getState().enabled).toBe(true)
    expect(useRemoteStore.getState().error).toContain('Synthetic stop failure')
    expect(useRemoteStore.getState().qrVisible).toBe(false)
  })

  it('revokes a running native snapshot discovered after frontend state was lost', async () => {
    call.mockResolvedValue({ ...started, running: true })
    await useRemoteStore.getState().refreshStatus()
    expect(call).toHaveBeenCalledWith('revoke_remote_memory')
    expect(useRemoteStore.getState().memoryNotice).toBe(REMOTE_MEMORY_CHANGED)
    call.mockClear()
    await useRemoteStore.getState().refreshStatus()
    expect(call).not.toHaveBeenCalledWith('revoke_remote_memory')
  })

  it('does not treat a normally started session as an unknown snapshot', async () => {
    await useRemoteStore.getState().startServer()
    call.mockClear().mockResolvedValue({ ...started, running: true })
    await useRemoteStore.getState().refreshStatus()
    expect(call).not.toHaveBeenCalledWith('revoke_remote_memory')
  })

  it('ignores a late running status response after explicit stop', async () => {
    const status = deferred<typeof started & { running: boolean }>()
    call.mockImplementation(async name => name === 'remote_server_status' ? status.promise : started)
    const refresh = useRemoteStore.getState().refreshStatus()
    await useRemoteStore.getState().stopServer()
    status.resolve({ ...started, running: true })
    await refresh
    expect(useRemoteStore.getState().enabled).toBe(false)
    expect(call).not.toHaveBeenCalledWith('revoke_remote_memory')
  })

  it('ignores a status response from before a fresh start', async () => {
    const status = deferred<typeof started & { running: boolean }>()
    call.mockImplementation(async name => name === 'remote_server_status' ? status.promise : started)
    const refresh = useRemoteStore.getState().refreshStatus()
    await useRemoteStore.getState().startServer()
    status.resolve({ ...started, running: false })
    await refresh
    expect(useRemoteStore.getState().enabled).toBe(true)
    expect(call).not.toHaveBeenCalledWith('revoke_remote_memory')
  })

  it.each(['delete', 'edit', 'sensitive', 'scope', 'clear'] as const)('revokes a running prompt on %s', async kind => {
    await useRemoteStore.getState().startServer()
    expect(call.mock.calls.find(([name]) => name === 'start_remote_server')?.[1]?.systemPrompt).toContain(entry.content)
    if (kind === 'delete') useMemoryStore.getState().removeMemory(entry.id)
    if (kind === 'clear') useMemoryStore.getState().clearAll()
    if (kind === 'edit') useMemoryStore.getState().updateMemory(entry.id, { content: 'Replacement' })
    if (kind === 'sensitive') useMemoryStore.getState().updateMemory(entry.id, { sensitive: true })
    if (kind === 'scope') useMemoryStore.getState().updateMemory(entry.id, { scope: 'private-project' })
    await vi.waitFor(() => expect(useRemoteStore.getState().error).toBe(REMOTE_MEMORY_CHANGED))
    expect(call).toHaveBeenCalledWith('revoke_remote_memory')
    expect(useRemoteStore.getState().qrVisible).toBe(false)
  })

  it('does not interrupt an existing prompt for additions or excluded entries', () => {
    expect(remoteMemoryChanged([entry], [entry, { ...entry, id: 'new' }])).toBe(false)
    expect(remoteMemoryChanged([{ ...entry, sensitive: true }], [])).toBe(false)
    expect(remoteMemoryChanged([{ ...entry, scope: 'project' }], [])).toBe(false)
    expect(remoteMemoryChanged([entry], [{ ...entry, stale: true }])).toBe(true)
  })

  it('rejects mutation during enrichment before submitting the stale prompt', async () => {
    const context = deferred<string>()
    const pendingRetrieval = vi.fn(() => context.promise)
    useMemoryStore.setState({ getMemoriesForPromptAsync: pendingRetrieval })
    const start = useRemoteStore.getState().startServer()
    const assertion = expect(start).rejects.toThrow(REMOTE_MEMORY_CHANGED)
    await vi.waitFor(() => expect(pendingRetrieval).toHaveBeenCalled())
    useMemoryStore.getState().removeMemory(entry.id)
    context.resolve(entry.content)
    await assertion
    expect(call.mock.calls.some(([name]) => name === 'start_remote_server')).toBe(false)
  })

  it.each(['startServer', 'restart'] as const)('revokes again after mutation during native %s, before showing QR', async method => {
    const native = deferred<typeof started>()
    const command = method === 'restart' ? 'restart_remote_server' : 'start_remote_server'
    call.mockImplementation(async name => name === command ? native.promise : started)
    const start = useRemoteStore.getState()[method]()
    const assertion = expect(start).rejects.toThrow(REMOTE_MEMORY_CHANGED)
    await vi.waitFor(() => expect(call.mock.calls.some(([name]) => name === command)).toBe(true))
    useMemoryStore.getState().removeMemory(entry.id)
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith('revoke_remote_memory'))
    native.resolve(started)
    await assertion
    expect(call.mock.calls.filter(([name]) => name === 'revoke_remote_memory')).toHaveLength(2)
    expect(call.mock.calls.some(([name]) => name === 'remote_qr_code')).toBe(false)
    expect(useRemoteStore.getState().enabled).toBe(true)
    expect(useRemoteStore.getState().qrVisible).toBe(false)
  })

  it('stops the native server if the revocation command fails', async () => {
    await useRemoteStore.getState().startServer()
    call.mockImplementation(async name => {
      if (name === 'revoke_remote_memory') throw new Error('synthetic private diagnostic')
      return started
    })
    useMemoryStore.getState().removeMemory(entry.id)
    await vi.waitFor(() => expect(useRemoteStore.getState().enabled).toBe(false))
    expect(call).toHaveBeenCalledWith('stop_remote_server')
    expect(useRemoteStore.getState().error).toBe(REMOTE_MEMORY_CHANGED)
  })

  it('does not claim a failed revoke and failed stop made the server safe', async () => {
    await useRemoteStore.getState().startServer()
    call.mockRejectedValue(new Error('synthetic private diagnostic'))
    useMemoryStore.getState().removeMemory(entry.id)
    await vi.waitFor(() => expect(useRemoteStore.getState().error).toContain('could not be confirmed'))
    expect(useRemoteStore.getState().enabled).toBe(true)
    expect(useRemoteStore.getState().error).not.toContain('synthetic private diagnostic')
    await expect(useRemoteStore.getState().restart()).rejects.toThrow('could not be confirmed')
  })

  it('does not permit overlapping starts', async () => {
    const native = deferred<typeof started>()
    call.mockImplementation(async name => name === 'start_remote_server' ? native.promise : started)
    const start = useRemoteStore.getState().startServer()
    await expect(useRemoteStore.getState().restart()).rejects.toThrow('already starting')
    native.resolve(started)
    await start
  })

  it('waits for a delayed stop fallback before restarting with current memory', async () => {
    await useRemoteStore.getState().startServer()
    const stopped = deferred<typeof started>()
    const stoppedAgain = deferred<typeof started>()
    let stops = 0
    call.mockImplementation(async name => {
      if (name === 'revoke_remote_memory') throw new Error('Synthetic failure')
      if (name === 'stop_remote_server') return ++stops === 1 ? stopped.promise : stoppedAgain.promise
      return started
    })
    useMemoryStore.getState().removeMemory(entry.id)
    await vi.waitFor(() => expect(call).toHaveBeenCalledWith('stop_remote_server'))
    const restart = useRemoteStore.getState().restart()
    await Promise.resolve()
    expect(call.mock.calls.some(([name]) => name === 'restart_remote_server')).toBe(false)
    // Queue another revocation after restart has begun waiting on the first.
    useMemoryStore.setState({ entries: [{ ...entry, id: 'second' }] })
    useMemoryStore.getState().removeMemory('second')
    stopped.resolve(started)
    await vi.waitFor(() => expect(stops).toBe(2))
    expect(call.mock.calls.some(([name]) => name === 'restart_remote_server')).toBe(false)
    stoppedAgain.resolve(started)
    await restart
    const args = call.mock.calls.find(([name]) => name === 'restart_remote_server')?.[1]
    expect(args?.systemPrompt).toBeUndefined()
    expect(useRemoteStore.getState().enabled).toBe(true)
    expect(useRemoteStore.getState().memoryNotice).toBeNull()
  })
})
