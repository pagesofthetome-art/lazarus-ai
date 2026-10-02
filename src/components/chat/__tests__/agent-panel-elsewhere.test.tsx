// @vitest-environment jsdom
/**
 * B1 (3.0.1, Orchestrator-Entscheid): "Unterhaltung wechseln beendet NICHT"
 * einen Hintergrundauftrag, der Kunde darf ihn bewusst weiterlaufen lassen.
 * Vorher haengte das ganze Panel an `activeConversationId`, beim Wechsel in
 * eine andere Unterhaltung verschwand jede Spur, obwohl anderswo noch etwas
 * lief und Credits kostete. Diese Tests fahren den echten agentTaskStore und
 * das echte AgentPanel, keine Attrappe.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AgentPanel } from '../AgentPanel'
import { useAgentTaskStore } from '../../../stores/agentTaskStore'
import { useChatStore } from '../../../stores/chatStore'
import { useUIStore } from '../../../stores/uiStore'

const HERE = 'conv-here'
const THERE = 'conv-there'

function starte(id: string, convId: string, controller = new AbortController()) {
  useAgentTaskStore.getState().start({
    id,
    convId,
    goal: 'goal ' + id,
    context: '',
    background: true,
    startedAt: Date.now(),
    controller,
  })
  return controller
}

beforeEach(() => {
  cleanup()
  useAgentTaskStore.setState({ byConv: {} })
  useChatStore.setState({ activeConversationId: HERE })
  useUIStore.getState().setAgentPanelCollapsed(false)
})

describe('AgentPanel: background work in another chat stays visible', () => {
  it('shows nothing when no conversation has a background task', () => {
    render(<AgentPanel />)
    expect(screen.queryByTestId('agent-panel')).toBeNull()
    expect(screen.queryByTestId('agent-panel-elsewhere-bar')).toBeNull()
  })

  it('the active chat has none, but another chat is still running: the panel says so', () => {
    starte('t1', THERE)
    render(<AgentPanel />)
    expect(screen.getByTestId('agent-panel-elsewhere-bar')).toBeTruthy()
    expect(screen.getByText(/1 background agent running in another chat/)).toBeTruthy()
    expect(screen.getByText(/costs credits/)).toBeTruthy()
  })

  it('Stop all in the elsewhere bar cancels the OTHER conversation, not the active one', () => {
    const hereCtrl = starte('t-here', HERE)
    const thereCtrl = starte('t-there', THERE)
    render(<AgentPanel />)
    fireEvent.click(screen.getByTestId('agent-panel-elsewhere-stop-all'))
    expect(thereCtrl.signal.aborted).toBe(true)
    expect(hereCtrl.signal.aborted).toBe(false)
  })

  it('stays visible even collapsed, as an amber badge distinct from the own-chat one', () => {
    starte('t2', THERE)
    useUIStore.getState().setAgentPanelCollapsed(true)
    render(<AgentPanel />)
    expect(screen.getByTestId('agent-panel-elsewhere-badge')).toBeTruthy()
  })
})
