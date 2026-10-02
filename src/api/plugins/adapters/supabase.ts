import type { MCPToolDefinition, ToolArgs } from '../../mcp/types'
import { providerJson, requireCredential, stringArg } from './http'
import type { ProviderAdapter, ProviderCredentials, ProviderConnection } from './types'

const tools: MCPToolDefinition[] = [
  { name: 'supabase_select', description: 'Read rows from an explicitly named Supabase table. Read-only.', category: 'database', source: 'external', serverId: 'plugin:supabase', inputSchema: { type: 'object', properties: { table: { type: 'string' }, select: { type: 'string', default: '*' }, limit: { type: 'number', minimum: 1, maximum: 100, default: 20 } }, required: ['table'] } },
]

function normalizedBaseUrl(raw: string): string {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('Supabase project URL is not a valid URL.') }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !localHttp) throw new Error('Supabase credentials may only be sent to an HTTPS URL (HTTP is allowed for localhost).')
  if (url.username || url.password || url.search || url.hash) throw new Error('Supabase project URL must not contain credentials, a query string, or a fragment.')
  const hostedSupabase = url.protocol === 'https:' && url.hostname.toLowerCase().endsWith('.supabase.co')
  if (!hostedSupabase && !localHttp) throw new Error('Use a hosted Supabase project URL ending in .supabase.co, or a local localhost URL.')
  return url.toString().replace(/\/+$/, '')
}

export const supabaseAdapter: ProviderAdapter = {
  providerId: 'supabase', displayName: 'Supabase', transport: 'api-key',
  async connect(credentials: ProviderCredentials): Promise<ProviderConnection> {
    requireCredential(credentials, 'Supabase')
    if (!credentials.baseUrl) throw new Error('Supabase needs a project URL before connecting.')
    const baseUrl = normalizedBaseUrl(credentials.baseUrl)
    const key = credentials.apiKey || credentials.accessToken || ''
    const headers = { apikey: key }
    return {
      providerId: 'supabase', tools,
      async verify() {
        // The public health endpoint validates the API key without requiring
        // elevated schema access. Do not use /rest/v1/ here: recent Supabase
        // projects intentionally restrict schema discovery to secret keys.
        await providerJson(`${baseUrl}/auth/v1/health`, { headers }, {})
      },
      async call(toolName: string, args: ToolArgs) {
        if (toolName === 'supabase_select') {
          const table = stringArg(args, 'table')
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) throw new Error('Supabase table name is invalid.')
          const select = encodeURIComponent(stringArg(args, 'select', '*'))
          const limit = Math.min(100, Math.max(1, Number(args.limit) || 20))
          return JSON.stringify(await providerJson(`${baseUrl}/rest/v1/${encodeURIComponent(table)}?select=${select}&limit=${limit}`, { headers }, {}))
        }
        throw new Error(`Unknown Supabase tool: ${toolName}`)
      },
      async disconnect() {},
    }
  },
}
