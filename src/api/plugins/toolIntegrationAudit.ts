import { toolRegistry } from '../mcp'
import { CODEX_CATEGORIES } from '../../lib/codex-tool-categories'
import { getActiveProviderConnections, providerAdapters } from './adapters'
import { PLUGIN_CATALOG } from './catalog'

export type IntegrationAuditStatus = 'ready' | 'not-connected' | 'needs-attention'

export interface IntegrationAuditCheck {
  id: string
  label: string
  status: IntegrationAuditStatus
  detail: string
}

export interface ToolIntegrationAudit {
  checkedAt: string
  checks: IntegrationAuditCheck[]
  toolCount: number
}

const CHAT_CODE_TOOLS = ['web_search', 'web_fetch', 'file_read', 'file_list', 'shell_execute']
const IMAGE_VIDEO_TOOLS = ['image_generate', 'video_generate']

/**
 * Read-only runtime diagnostic. It checks the exact singleton tool registry
 * used to build model requests, rather than trusting persisted UI connection flags.
 */
export function auditToolIntegrations(): ToolIntegrationAudit {
  const tools = toolRegistry.getAll()
  const byName = new Map(tools.map((tool) => [tool.name, tool]))
  const adaptersMissing = PLUGIN_CATALOG
    .filter((plugin) => plugin.adapterId && !providerAdapters[plugin.adapterId])
    .map((plugin) => plugin.name)
  const activeProviders = getActiveProviderConnections()

  const checks: IntegrationAuditCheck[] = [
    {
      id: 'chat-code-tools',
      label: 'Chat and Code tool route',
      status: CHAT_CODE_TOOLS.every((name) => byName.has(name)) ? 'ready' : 'needs-attention',
      detail: CHAT_CODE_TOOLS.every((name) => byName.has(name))
        ? 'Web, file, and coding tools are registered in the shared model-tool registry. Model tool support, the Chat Tools toggle, and permission settings still apply.'
        : `Missing built-in tools: ${CHAT_CODE_TOOLS.filter((name) => !byName.has(name)).join(', ')}.`,
    },
    {
      id: 'image-video-tools',
      label: 'Image and Video tool route',
      status: IMAGE_VIDEO_TOOLS.every((name) => byName.has(name)) ? 'ready' : 'needs-attention',
      detail: IMAGE_VIDEO_TOOLS.every((name) => byName.has(name))
        ? 'Image and video generation tools are registered. They route to Lazarus media backends; catalog connectors do not automatically become ComfyUI nodes.'
        : `Missing generation tools: ${IMAGE_VIDEO_TOOLS.filter((name) => !byName.has(name)).join(', ')}.`,
    },
    {
      id: 'code-plugin-categories',
      label: 'Code plugin categories',
      status: CODEX_CATEGORIES.includes('database') ? 'ready' : 'needs-attention',
      detail: CODEX_CATEGORIES.includes('database')
        ? 'The Code surface includes database tools such as Supabase, subject to your permission settings.'
        : 'The Code surface is filtering out database tools, so connected database adapters cannot be used there.',
    },
    {
      id: 'adapter-coverage',
      label: 'Catalog adapter coverage',
      status: adaptersMissing.length ? 'needs-attention' : 'ready',
      detail: adaptersMissing.length
        ? `Missing adapter implementation: ${adaptersMissing.join(', ')}.`
        : `${Object.keys(providerAdapters).length} providers have real adapters. Other catalog entries are reference/roadmap items, not active connectors.`,
    },
  ]

  for (const [providerId, adapter] of Object.entries(providerAdapters)) {
    const active = activeProviders.find((item) => item.providerId === providerId)
    const prefix = `plugin:${providerId}`
    const registered = tools.filter((tool) => tool.serverId === prefix && tool.source === 'external')
    const registeredNames = new Set(registered.map((tool) => tool.name))
    const missingNames = active?.toolNames.filter((name) => !registeredNames.has(name)) ?? []
    const codeExcluded = registered.filter((tool) => !CODEX_CATEGORIES.includes(tool.category))
    checks.push({
      id: `provider:${providerId}`,
      label: adapter.displayName,
      status: !active ? 'not-connected' : missingNames.length || codeExcluded.length || registered.length !== active.toolNames.length ? 'needs-attention' : 'ready',
      detail: !active
        ? 'Not connected in this Lazarus session.'
        : missingNames.length || codeExcluded.length || registered.length !== active.toolNames.length
          ? `The adapter is active, but its tool route is incomplete. Registered ${registered.length}; expected ${active.toolNames.length}; excluded from Code by category: ${codeExcluded.map((tool) => tool.name).join(', ') || 'none'}.`
          : `${registered.length} verified tools are registered and available to Chat and Code when their tool setting, model support, and permissions allow it.`,
    })
  }

  const externalTools = tools.filter((tool) => tool.source === 'external')
  const mcpTools = externalTools.filter((tool) => !tool.serverId?.startsWith('plugin:'))
  checks.push({
    id: 'mcp-tools',
    label: 'Custom MCP servers',
    status: mcpTools.length ? 'ready' : 'not-connected',
    detail: mcpTools.length
      ? `${new Set(mcpTools.map((tool) => tool.serverId)).size} connected server(s) published ${mcpTools.length} tools to the shared registry.`
      : 'No custom MCP server tools are registered right now.',
  })
  const mcpCodeExcluded = mcpTools.filter((tool) => !CODEX_CATEGORIES.includes(tool.category))
  checks.push({
    id: 'mcp-code-route',
    label: 'Custom MCP tools in Code',
    status: !mcpTools.length ? 'not-connected' : mcpCodeExcluded.length ? 'needs-attention' : 'ready',
    detail: !mcpTools.length
      ? 'No custom MCP tools are connected to check.'
      : mcpCodeExcluded.length
        ? `${mcpCodeExcluded.length} registered MCP tool(s) are filtered out of Code by category: ${mcpCodeExcluded.map((tool) => tool.name).join(', ')}.`
        : `${mcpTools.length} registered MCP tool(s) fit Code’s category filter and are available to Chat and Code when settings and model support allow it.`,
  })

  return { checkedAt: new Date().toISOString(), checks, toolCount: tools.length }
}
