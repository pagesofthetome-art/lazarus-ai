import { describe, expect, it } from 'vitest'
import { toolRegistry } from '../../mcp'

describe('tool integration audit', () => {
  it('checks the live shared tool registry used by Chat and Code', async () => {
    const module = await import('../toolIntegrationAudit').catch(() => null)
    expect(module).not.toBeNull()
    if (!module) return

    const report = module.auditToolIntegrations()
    const chatCode = report.checks.find((check) => check.id === 'chat-code-tools')
    const codePlugins = report.checks.find((check) => check.id === 'code-plugin-categories')
    const imageVideo = report.checks.find((check) => check.id === 'image-video-tools')
    const mcpCode = report.checks.find((check) => check.id === 'mcp-code-route')

    expect(chatCode?.status).toBe('ready')
    expect(codePlugins?.status).toBe('ready')
    expect(imageVideo?.status).toBe('ready')
    expect(mcpCode?.status).toBe('not-connected')
    expect(toolRegistry.getToolByName('web_search')).toBeDefined()
  })

  it('reports provider tools only when the live registry contains them', async () => {
    const module = await import('../toolIntegrationAudit').catch(() => null)
    expect(module).not.toBeNull()
    if (!module) return

    const report = module.auditToolIntegrations()
    const providers = report.checks.filter((check) => check.id.startsWith('provider:'))

    expect(providers).toHaveLength(3)
    expect(providers.every((check) => check.status === 'not-connected')).toBe(true)
  })
})
