import type { MCPToolDefinition, ToolArgs } from '../../mcp/types'
import { providerJson, requireCredential, stringArg } from './http'
import type { ProviderAdapter, ProviderCredentials, ProviderConnection } from './types'

const tools: MCPToolDefinition[] = [
  { name: 'github_search_repositories', description: 'Search GitHub repositories the connected account can access. Read-only.', category: 'workflow', source: 'external', serverId: 'plugin:github', inputSchema: { type: 'object', properties: { query: { type: 'string' }, page: { type: 'number', minimum: 1, maximum: 10, default: 1 } }, required: ['query'] } },
  { name: 'github_list_issues', description: 'List issues for a repository. Read-only.', category: 'workflow', source: 'external', serverId: 'plugin:github', inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, state: { type: 'string', enum: ['open', 'closed', 'all'], default: 'open' } }, required: ['owner', 'repo'] } },
  { name: 'github_get_file', description: 'Read a file from a repository at a requested ref. Read-only.', category: 'filesystem', source: 'external', serverId: 'plugin:github', inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, path: { type: 'string' }, ref: { type: 'string' } }, required: ['owner', 'repo', 'path'] } },
]

type GitHubContent = {
  name?: string
  path?: string
  type?: string
  encoding?: string
  content?: string
  html_url?: string
  download_url?: string | null
}

function decodeGitHubText(encoded: string, maxBytes = 96 * 1024): { text: string; truncated: boolean } {
  const binary = atob(encoded.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const truncated = bytes.byteLength > maxBytes
  return { text: new TextDecoder().decode(bytes.subarray(0, maxBytes)), truncated }
}

export const githubAdapter: ProviderAdapter = {
  providerId: 'github', displayName: 'GitHub', transport: 'api-key',
  async connect(credentials: ProviderCredentials): Promise<ProviderConnection> {
    requireCredential(credentials, 'GitHub')
    const request = <T,>(url: string) => providerJson<T>(url, { headers: { Authorization: `Bearer ${credentials.accessToken || credentials.apiKey}`, Accept: 'application/vnd.github+json' } }, {})
    return {
      providerId: 'github', tools,
      async verify() {
        await request('https://api.github.com/user')
      },
      async call(toolName: string, args: ToolArgs) {
        if (toolName === 'github_search_repositories') {
          const page = Math.min(10, Math.max(1, Number(args.page) || 1))
          return JSON.stringify(await request(`https://api.github.com/search/repositories?q=${encodeURIComponent(stringArg(args, 'query'))}&page=${page}`))
        }
        if (toolName === 'github_list_issues') return JSON.stringify(await request(`https://api.github.com/repos/${encodeURIComponent(stringArg(args, 'owner'))}/${encodeURIComponent(stringArg(args, 'repo'))}/issues?state=${encodeURIComponent(stringArg(args, 'state', 'open'))}`))
        if (toolName === 'github_get_file') {
          const path = stringArg(args, 'path').split('/').map(encodeURIComponent).join('/')
          const ref = stringArg(args, 'ref')
          const result = await request<GitHubContent | GitHubContent[]>(`https://api.github.com/repos/${encodeURIComponent(stringArg(args, 'owner'))}/${encodeURIComponent(stringArg(args, 'repo'))}/contents/${path}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`)
          if (!Array.isArray(result) && result.type === 'file' && result.encoding === 'base64' && result.content) {
            const decoded = decodeGitHubText(result.content)
            return JSON.stringify({ name: result.name, path: result.path, html_url: result.html_url, content: decoded.text, truncated: decoded.truncated })
          }
          return JSON.stringify(result)
        }
        throw new Error(`Unknown GitHub tool: ${toolName}`)
      },
      async disconnect() {},
    }
  },
}
