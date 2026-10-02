import { describe, it, expect } from 'vitest'
import { CODEX_CONFIRM_TOOLS, codexNeedsConfirm, codexConfirmEnabled } from '../codexShellGate'
import { DEFAULT_SETTINGS } from '../../lib/constants'

// H2: the coding-agent shell/code confirm gate. These tests lock the contract
// that (a) the autonomous workflow is unchanged when the gate is off, (b) the
// gate covers exactly the arbitrary-exec tools, and (c) file_write — which is
// path-jailed + stageable — is never caught by it.

describe('codexShellGate (H2)', () => {
  describe('CODEX_CONFIRM_TOOLS membership', () => {
    it('includes the arbitrary-exec tools', () => {
      expect(CODEX_CONFIRM_TOOLS.has('shell_execute')).toBe(true)
      expect(CODEX_CONFIRM_TOOLS.has('code_execute')).toBe(true)
      expect(CODEX_CONFIRM_TOOLS.has('shell_execute_background')).toBe(true)
    })

    it('does NOT include file_write (path-jailed + Stage mode handles it)', () => {
      expect(CODEX_CONFIRM_TOOLS.has('file_write')).toBe(false)
    })

    it('does NOT include read-only tools', () => {
      for (const t of ['file_read', 'file_list', 'file_search', 'git_status', 'web_search']) {
        expect(CODEX_CONFIRM_TOOLS.has(t)).toBe(false)
      }
    })
  })

  describe('codexNeedsConfirm', () => {
    it('off by default: never confirms even for shell_execute (autonomous workflow preserved)', () => {
      expect(codexNeedsConfirm('shell_execute', false)).toBe(false)
      expect(codexNeedsConfirm('code_execute', false)).toBe(false)
    })

    it('on: confirms the arbitrary-exec tools', () => {
      expect(codexNeedsConfirm('shell_execute', true)).toBe(true)
      expect(codexNeedsConfirm('code_execute', true)).toBe(true)
      expect(codexNeedsConfirm('shell_execute_background', true)).toBe(true)
    })

    it('on: does NOT confirm file_write or read-only tools', () => {
      expect(codexNeedsConfirm('file_write', true)).toBe(false)
      expect(codexNeedsConfirm('file_read', true)).toBe(false)
      expect(codexNeedsConfirm('web_search', true)).toBe(false)
    })
  })

  // History: the 2.5.7 review hard-wired providerId === 'lu-cloud' into the
  // gate, so the confirm toggle silently did nothing on a cloud model (David
  // 2026-07-24, "auto approve bei cloud modellen setting nicht funktional").
  // 2.5.9 made it a visible setting that still defaulted ON, and G15a
  // (2026-08-07) carried the same default to the Agent surface.
  //
  describe('codexConfirmEnabled applies the optional remote-provider checkpoint', () => {
    it('the shipped default does not add a remote-provider checkpoint', () => {
      expect(DEFAULT_SETTINGS.codexRemoteConfirmOptIn).toBe(false)
      expect(
        codexConfirmEnabled({
          confirmShell: false,
          remoteOptIn: DEFAULT_SETTINGS.codexRemoteConfirmOptIn,
          remoteProvider: true,
        })
      ).toBe(false)
    })

    it('the opt-in adds a checkpoint for remote providers', () => {
      expect(codexConfirmEnabled({ confirmShell: false, remoteOptIn: true, remoteProvider: true })).toBe(true)
    })

    it('the opt-in does not gate local providers', () => {
      expect(codexConfirmEnabled({ confirmShell: false, remoteOptIn: true, remoteProvider: false })).toBe(false)
    })

    it('the global setting confirms every provider', () => {
      expect(codexConfirmEnabled({ confirmShell: true, remoteOptIn: false, remoteProvider: false })).toBe(true)
    })
  })
})
