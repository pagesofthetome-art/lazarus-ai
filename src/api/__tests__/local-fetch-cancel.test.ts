/**
 * localFetch cancellation tests (R3 Nachbesserung 3: the TS half of "Stop
 * means stop" for non-streaming local-engine calls).
 *
 * proxy_localhost now takes a callId the JS side mints, and an abort on the
 * caller's signal invokes cancel_proxy_call(callId) so Rust actually drops
 * the connection (see cancel_registry.rs and commands/proxy.rs). These tests
 * pin the JS-side contract: a fresh id per call, the listener firing the
 * right command, cleanup of that listener, and the rule that an aborted call
 * never falls back to a direct fetch or retries.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

import { localFetch } from '../backend'
import { isRecord } from '../../types/json-guards'

const fetchMock = vi.fn()

type ProxyLocalhostArgs = {
  url: string
  method: string
  body: string | null
  timeoutMs: number | null
  headers: Record<string, string> | null
  callId: string
}

function tauriMode(on: boolean) {
  const existing: unknown = Reflect.get(globalThis, 'window')
  const w: Record<string, unknown> = isRecord(existing) ? existing : {}
  Reflect.set(globalThis, 'window', w)
  if (on) w.__TAURI_INTERNALS__ = {}
  else { delete w.__TAURI_INTERNALS__; delete w.__TAURI__ }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  tauriMode(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  tauriMode(false)
})

describe('localFetch mints a fresh callId per call', () => {
  it('sends a different callId for two separate calls', async () => {
    invokeMock.mockResolvedValue('{}')

    await localFetch('http://localhost:11434/api/chat', { method: 'POST', body: '{}' })
    await localFetch('http://localhost:11434/api/chat', { method: 'POST', body: '{}' })

    expect(invokeMock).toHaveBeenCalledTimes(2)
    const first = invokeMock.mock.calls[0][1] as ProxyLocalhostArgs
    const second = invokeMock.mock.calls[1][1] as ProxyLocalhostArgs
    expect(first.callId).toEqual(expect.any(String))
    expect(first.callId.length).toBeGreaterThan(0)
    expect(second.callId).not.toBe(first.callId)
  })
})

describe('localFetch forwards timeoutMs, never the snake_case key', () => {
  it('sends the camelCase key Tauri auto-converts, not timeout_ms', async () => {
    invokeMock.mockResolvedValue('{}')

    await localFetch('http://localhost:11434/api/tags', { timeoutMs: 2000 })

    expect(invokeMock).toHaveBeenCalledTimes(1)
    const args = invokeMock.mock.calls[0][1] as Record<string, unknown>
    expect(args.timeoutMs).toBe(2000)
    expect('timeout_ms' in args).toBe(false)
  })
})

describe('localFetch abort wires into cancel_proxy_call', () => {
  it('calls cancel_proxy_call with the same callId used for proxy_localhost, on abort', async () => {
    const controller = new AbortController()
    let rejectProxy!: (reason: unknown) => void
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'proxy_localhost') {
        return new Promise<string>((_resolve, reject) => { rejectProxy = reject })
      }
      if (cmd === 'cancel_proxy_call') return Promise.resolve()
      throw new Error(`unexpected invoke: ${cmd}`)
    })

    const pending = localFetch('http://localhost:11434/api/chat', {
      method: 'POST',
      body: '{}',
      signal: controller.signal,
    })

    // Let the microtask that issues the proxy_localhost invoke run
    // (localFetch awaits getInvoke() before it ever touches the signal).
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    const callArgs = invokeMock.mock.calls.find((c) => c[0] === 'proxy_localhost')?.[1] as ProxyLocalhostArgs
    expect(callArgs).toBeTruthy()

    controller.abort()
    await Promise.resolve()

    const cancelCall = invokeMock.mock.calls.find((c) => c[0] === 'cancel_proxy_call')
    expect(cancelCall).toBeTruthy()
    expect((cancelCall?.[1] as { callId: string }).callId).toBe(callArgs.callId)

    // The real Rust side answers a cancelled call with an error (see
    // cancellable_request in commands/proxy.rs); settle the mock the same
    // way so the awaited promise below resolves through the abort path
    // instead of hanging the test.
    rejectProxy('proxy_localhost: cancelled')
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects immediately, without ever calling invoke, for an already-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      localFetch('http://localhost:11434/api/chat', { method: 'POST', body: '{}', signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(invokeMock).not.toHaveBeenCalled()
  })
})

describe('localFetch detaches its abort listener after the call settles', () => {
  it('removes the abort listener once proxy_localhost resolves, so a later abort on the same signal is a no-op', async () => {
    invokeMock.mockResolvedValue('{}')
    const controller = new AbortController()
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')

    await localFetch('http://localhost:11434/api/chat', { method: 'POST', body: '{}', signal: controller.signal })

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function))

    // The listener is gone: aborting afterwards must not invoke
    // cancel_proxy_call for a call that has already finished.
    invokeMock.mockClear()
    controller.abort()
    await Promise.resolve()
    expect(invokeMock).not.toHaveBeenCalled()
  })
})

describe('an aborted call never falls back to direct fetch and never retries', () => {
  it('does not call fetch() after proxy_localhost rejects because the signal was aborted', async () => {
    const controller = new AbortController()
    let rejectProxy!: (reason: unknown) => void
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'proxy_localhost') {
        return new Promise<string>((_resolve, reject) => { rejectProxy = reject })
      }
      if (cmd === 'cancel_proxy_call') return Promise.resolve()
      throw new Error(`unexpected invoke: ${cmd}`)
    })

    const pending = localFetch('http://localhost:11434/api/chat', {
      method: 'POST',
      body: '{}',
      signal: controller.signal,
    })
    // Let the getInvoke() await resolve so proxy_localhost is actually
    // invoked and the abort listener is attached before we abort.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    controller.abort()
    // The abort listener calls cancel_proxy_call; the real Rust side then
    // answers the still-pending proxy_localhost call with an error.
    rejectProxy('proxy_localhost: cancelled')

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()

    // And only the one proxy_localhost invocation happened: no retry.
    expect(invokeMock.mock.calls.filter((c) => c[0] === 'proxy_localhost')).toHaveLength(1)
  })
})
