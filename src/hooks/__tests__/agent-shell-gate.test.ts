/**
 * One optional remote-provider shell policy for both surfaces: the Code tab
 * and Agent mode read the SAME helper and the SAME setting, because R23 found
 * Agent running the exec tools on a remote model unattended while the Code tab
 * confirmed them.
 *
 * The remote confirmation is an opt-in and ships OFF. With it off, the run is
 * gated by the per-tool permission level. With it on, confirmation adds a
 * checkpoint on top of that level.
 *
 * Run: npx vitest run src/hooks/__tests__/agent-shell-gate.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { CODEX_CONFIRM_TOOLS, codexConfirmEnabled } from '../codexShellGate'
import { DEFAULT_SETTINGS } from '../../lib/constants'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8')
const agent = read('../useAgentChat.ts')

// The two lines useAgentChat runs per tool call, kept in the same shape as the
// source (pinned below, so this stops being a paraphrase the moment it drifts).
const remoteGate = (toolName: string, providerId: string, remoteOptIn: boolean) =>
  CODEX_CONFIRM_TOOLS.has(toolName) && codexConfirmEnabled({
    confirmShell: false,
    remoteOptIn,
    remoteProvider: providerId === 'remote-api',
  })
const needsApproval = (permLevel: string, toolName: string, providerId: string, remoteOptIn: boolean) =>
  permLevel !== 'auto' || remoteGate(toolName, providerId, remoteOptIn)

const OPT_IN_DEFAULT = DEFAULT_SETTINGS.codexRemoteConfirmOptIn

describe('the shipped default: remote confirmation is opt-in', () => {
  it('ships with the remote-provider opt-in off', () => {
    expect(OPT_IN_DEFAULT).toBe(false)
  })

  it('permission level auto runs remote shell commands unattended by default', () => {
    expect(needsApproval('auto', 'shell_execute', 'remote-api', OPT_IN_DEFAULT)).toBe(false)
    expect(needsApproval('auto', 'code_execute', 'remote-api', OPT_IN_DEFAULT)).toBe(false)
    expect(needsApproval('auto', 'shell_execute_background', 'remote-api', OPT_IN_DEFAULT)).toBe(false)
  })

  it('remote and local models are gated identically by default', () => {
    for (const providerId of ['remote-api', 'ollama', 'openai']) {
      expect(needsApproval('auto', 'shell_execute', providerId, OPT_IN_DEFAULT)).toBe(false)
    }
  })

  it('NEGATIVE CONTROL: the permission level itself still gates, it was never loosened', () => {
    expect(needsApproval('ask', 'shell_execute', 'remote-api', OPT_IN_DEFAULT)).toBe(true)
    expect(needsApproval('ask', 'shell_execute', 'ollama', OPT_IN_DEFAULT)).toBe(true)
  })
})

describe('the remote-provider opt-in', () => {
  it('an opted-in user is asked before remote shell execution', () => {
    expect(needsApproval('auto', 'shell_execute', 'remote-api', true)).toBe(true)
  })

  it('opting in does not touch local providers', () => {
    expect(needsApproval('auto', 'shell_execute', 'ollama', true)).toBe(false)
    expect(needsApproval('auto', 'shell_execute', 'openai', true)).toBe(false)
  })

  it('only the arbitrary-exec tools are gated, never the jailed file tools', () => {
    expect(remoteGate('shell_execute', 'remote-api', true)).toBe(true)
    expect(remoteGate('code_execute', 'remote-api', true)).toBe(true)
    expect(remoteGate('shell_execute_background', 'remote-api', true)).toBe(true)
    expect(remoteGate('file_write', 'remote-api', true)).toBe(false)
    expect(remoteGate('web_fetch', 'remote-api', true)).toBe(false)
  })
})

describe('wiring in useAgentChat', () => {
  it('the remote-provider gate rides ON TOP of the permission level', () => {
    expect(agent).toContain("const needsApproval = permLevel !== 'auto' || remoteShellConfirm")
  })

  it('the gate reads the SAME shared helper and setting as the Code tab', () => {
    expect(agent).toContain("import { CODEX_CONFIRM_TOOLS, codexConfirmEnabled } from './codexShellGate'")
    expect(agent).toContain('remoteOptIn: settings.codexRemoteConfirmOptIn')
    expect(agent).toContain('CODEX_CONFIRM_TOOLS.has(tc.function.name)')
    // Negative control: the retired key must be gone from this surface, or a
    // profile that still has it on disk would quietly keep the old policy.
    expect(agent).not.toContain('codexCloudConfirmShell')
  })

  it('a gated call lands in the EXISTING approval flow, not a new dialog', () => {
    // pending_approval blocks enqueue through waitForApproval; the gate only
    // flips needsApproval, so the run pauses in the same inline approve UI.
    expect(agent).toContain("status: needsApproval ? 'pending_approval' : 'running'")
    // The conversation id joined the call with G29b (the queue moved to module
    // scope so an approval survives the view being torn down); the gate itself
    // still goes through this one flow.
    expect(agent).toContain('await waitForApproval(convId!, entry.ac, abort.signal)')
  })

  it('the Codex side feeds the same two settings into the same helper', () => {
    const codex = read('../useCodex.ts')
    // Since 2.6.6 C1 the Code tab reaches the gate through the mode preset
    // instead of calling it inline. Same inputs, same helper, same opt-in.
    expect(codex).toContain('codexModeKnobs({')
    expect(codex).toContain('codexConfirmShell: settings.codexConfirmShell')
    expect(codex).toContain('codexRemoteConfirmOptIn: settings.codexRemoteConfirmOptIn')
    expect(codex).not.toContain('codexCloudConfirmShell')
  })

  it('the settings toggle stays visible, and reads as the opt-in it now is', () => {
    const page = read('../../components/settings/SettingsPage.tsx')
    expect(page).toContain('configured remote providers')
    expect(page).toContain('off by default')
    expect(page).toContain('settings.codexRemoteConfirmOptIn')
    expect(page).not.toContain('{!settings.codexConfirmShell && (')
  })

  it('the mode dropdown no longer carries the cloud exception, there is none', () => {
    const dropdown = read('../../components/chat/CodexModeDropdown.tsx')
    expect(dropdown).not.toContain('Bypass never lifts')
    expect(dropdown).not.toMatch(/cloud shell confirm/i)
  })
})
