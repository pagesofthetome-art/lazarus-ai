// @vitest-environment jsdom
/**
 * R2-20: der DRITTE gemerkte Ordner, `codexStore.workingDirectory`.
 *
 * `api/agents/workspace-validate.ts` beschreibt zwei Wege, auf denen ein
 * gemerkter Ordner OHNE Dialog gesetzt wird und deshalb stumm ins Leere
 * laufen kann, wenn die Rust-Erlaubnisliste ihn nicht mehr kennt: der Knopf
 * "Use last folder" (AgentWorkspaceDialog) und `settings.defaultWorkspace`
 * (AgentModeToggle). Beide fragen `rememberedFolderRefusal`, BEVOR sie den
 * Ordner benutzen.
 *
 * `codexStore.workingDirectory`, der Ordner der Code-Reiter-Kopfzeile, ist
 * derselbe Fall: `partialize` in codexStore.ts haelt ihn ueber einen Neustart
 * am Leben, ohne dass je wieder der native Dialog laeuft. Vor diesem Fix rief
 * die Kopfzeile bei jedem Root-Wechsel direkt `fs_list`, ohne vorher zu
 * fragen, ob die Rust-Seite den Ordner ueberhaupt noch als Arbeitsordner
 * kennt; die Fehlermeldung war dann die generische "Failed to read
 * directory" statt des erklaerenden Satzes aus
 * `rememberedWorkspaceRefusedMessage`.
 *
 * Run: npx vitest run src/components/chat/__tests__/der-code-ordner-wird-gefragt.test.tsx
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

describe('die Code-Reiter-Kopfzeile fragt den gemerkten Ordner zuerst', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('zeigt den erklaerenden Ablehnungssatz statt fs_list zu rufen', async () => {
    const { render, screen, act, cleanup } = await import('@testing-library/react')
    const { createElement } = await import('react')
    const { useCodexStore } = await import('../../../stores/codexStore')
    const backend = await import('../../../api/backend')
    const { ExplorerPanel } = await import('../ExplorerPanel')

    vi.spyOn(backend, 'isTauri').mockReturnValue(true)
    const fsListCalls: string[] = []
    vi.spyOn(backend, 'backendCall').mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'validate_workspace_folder') {
        throw new Error('a home or mount container is not a workspace')
      }
      if (cmd === 'fs_list') {
        fsListCalls.push((args as { path?: string })?.path ?? '')
        return { entries: [], truncated: false } as never
      }
      return null as never
    })
    // Ein Ordner aus einer frueheren Sitzung, den die Erlaubnisliste dieser
    // Installation nicht mehr kennt (geleerte Daten, frischer Rechner).
    useCodexStore.setState({ workingDirectory: '/Users/x/stale-project' })

    render(createElement(ExplorerPanel, { onApprovePlan: () => {} }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })

    const fehler = screen.queryByTestId('explorer-error')
    expect(fehler, 'die Ablehnung wird nicht angezeigt').not.toBeNull()
    expect(fehler!.textContent).toContain('a home or mount container is not a workspace')
    expect(fehler!.textContent).toContain('stale-project')
    expect(fsListCalls, 'fs_list wurde trotz Ablehnung gerufen').toHaveLength(0)
    cleanup()
  })

  it('Negativkontrolle: ein weiterhin erlaubter Ordner laedt normal, kein Ablehnungssatz', async () => {
    const { render, screen, act, cleanup } = await import('@testing-library/react')
    const { createElement } = await import('react')
    const { useCodexStore } = await import('../../../stores/codexStore')
    const backend = await import('../../../api/backend')
    const { ExplorerPanel } = await import('../ExplorerPanel')

    vi.spyOn(backend, 'isTauri').mockReturnValue(true)
    const fsListCalls: string[] = []
    vi.spyOn(backend, 'backendCall').mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === 'validate_workspace_folder') return null as never
      if (cmd === 'fs_list') {
        fsListCalls.push((args as { path?: string })?.path ?? '')
        return { entries: [], truncated: false } as never
      }
      return null as never
    })
    useCodexStore.setState({ workingDirectory: '/Users/x/still-allowed' })

    render(createElement(ExplorerPanel, { onApprovePlan: () => {} }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })

    expect(screen.queryByTestId('explorer-error'), 'ein erlaubter Ordner zeigt trotzdem einen Fehler').toBeNull()
    expect(fsListCalls, 'fs_list wurde nie gerufen, obwohl der Ordner erlaubt ist').toContain(
      '/Users/x/still-allowed',
    )
    cleanup()
  })
})
