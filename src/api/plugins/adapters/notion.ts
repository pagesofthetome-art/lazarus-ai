import type { MCPToolDefinition, ToolArgs } from '../../mcp/types'
import { providerJson, requireCredential, stringArg } from './http'
import type { ProviderAdapter, ProviderCredentials, ProviderConnection } from './types'

const NOTION_VERSION = '2022-06-28'

const tools: MCPToolDefinition[] = [
  {
    name: 'notion_search',
    description: 'Search pages and databases visible to the connected Notion integration. Read-only.',
    category: 'workflow', source: 'external', serverId: 'plugin:notion',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, pageSize: { type: 'number', minimum: 1, maximum: 50, default: 20 } }, required: ['query'] },
  },
  {
    name: 'notion_get_page',
    description: 'Read the properties of a Notion page by ID. Read-only.',
    category: 'workflow', source: 'external', serverId: 'plugin:notion',
    inputSchema: { type: 'object', properties: { pageId: { type: 'string' } }, required: ['pageId'] },
  },
  {
    name: 'notion_update_page',
    description: 'Update properties on a Notion page. This changes remote data and is permission-gated.',
    category: 'workflow', source: 'external', serverId: 'plugin:notion',
    inputSchema: { type: 'object', properties: { pageId: { type: 'string' }, properties: { type: 'object', additionalProperties: true, description: 'Notion property JSON to replace or update' } }, required: ['pageId', 'properties'] },
  },
]

function notionRequest<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('Notion-Version', NOTION_VERSION)
  headers.set('Content-Type', 'application/json')
  return providerJson<T>(url, { ...init, headers })
}

export const notionAdapter: ProviderAdapter = {
  providerId: 'notion', displayName: 'Notion', transport: 'api-key',
  async connect(credentials: ProviderCredentials): Promise<ProviderConnection> {
    const token = requireCredential(credentials, 'Notion')
    return {
      providerId: 'notion', tools,
      async verify() {
        await notionRequest(token, 'https://api.notion.com/v1/users/me')
      },
      async call(toolName: string, args: ToolArgs) {
        if (toolName === 'notion_search') {
          const pageSize = Math.min(50, Math.max(1, Number(args.pageSize) || 20))
          const data = await notionRequest<{ results?: unknown[] }>(token, 'https://api.notion.com/v1/search', {
            method: 'POST',
            body: JSON.stringify({ query: stringArg(args, 'query'), page_size: pageSize }),
          })
          return JSON.stringify(data.results ?? [])
        }
        if (toolName === 'notion_get_page') {
          const pageId = encodeURIComponent(stringArg(args, 'pageId'))
          const data = await notionRequest(token, `https://api.notion.com/v1/pages/${pageId}`)
          return JSON.stringify(data)
        }
        if (toolName === 'notion_update_page') {
          const pageId = encodeURIComponent(stringArg(args, 'pageId'))
          const properties = args.properties
          if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
            throw new Error('Notion page properties must be a JSON object.')
          }
          const data = await notionRequest(token, `https://api.notion.com/v1/pages/${pageId}`, {
            method: 'PATCH',
            body: JSON.stringify({ properties }),
          })
          return JSON.stringify(data)
        }
        throw new Error(`Unknown Notion tool: ${toolName}`)
      },
      async disconnect() {},
    }
  },
}
