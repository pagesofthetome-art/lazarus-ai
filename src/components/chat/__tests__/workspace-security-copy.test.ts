// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AgentWorkspaceDialog } from '../AgentWorkspaceDialog'

afterEach(cleanup)

describe('workspace security explanation', () => {
  it('explains the boundary before a workspace is selected', () => {
    render(createElement(AgentWorkspaceDialog, {
      open: true, conversationId: 'security-copy', onChoose: vi.fn(), onClose: vi.fn(),
    }))
    const note = screen.getByTestId('workspace-security-boundary')
    expect(note.textContent).toContain('folder path jail, not a container or virtual machine')
    expect(note.textContent).toContain('Commands run on this computer')
    expect(screen.queryByText(/Nothing outside it can be touched/)).toBeNull()
  })
})
