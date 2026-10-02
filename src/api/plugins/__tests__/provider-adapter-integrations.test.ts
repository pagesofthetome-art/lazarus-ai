import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PERMISSIONS, toolRegistry } from '../../mcp'
import { connectProviderAdapter, disconnectProviderAdapter } from '../adapters'
import { selectRelevantTools } from '../../../lib/tool-selection'
import { CODEX_CATEGORIES } from '../../../lib/codex-tool-categories'

const originalFetch = globalThis.fetch

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(async () => {
  globalThis.fetch = originalFetch
  await Promise.all(['google-drive', 'github', 'supabase', 'gitlab', 'bitbucket', 'asana', 'clickup', 'linear', 'notion'].map(disconnectProviderAdapter))
  vi.restoreAllMocks()
})

describe('provider adapters are only exposed after a real connection', () => {
  it('does not register Google Drive tools when OAuth credentials are rejected', async () => {
    globalThis.fetch = vi.fn(async () => json({ error: 'invalid token' }, 401)) as typeof fetch

    await expect(connectProviderAdapter('google-drive', { accessToken: 'expired-token' }))
      .rejects.toThrow(/401/)

    expect(toolRegistry.getToolByName('google_drive_search')).toBeUndefined()
  })

  it('returns readable Google Docs content from google_drive_get_file', async () => {
    const requests: string[] = []
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.includes('/about?')) return json({ user: { emailAddress: 'owner@example.test' } })
      if (url.includes('/files/file-123?')) return json({
        id: 'file-123',
        name: 'notes',
        mimeType: 'application/vnd.google-apps.document',
      })
      if (url.includes('/export?')) return new Response('Readable document body')
      return json({}, 404)
    }) as typeof fetch

    await connectProviderAdapter('google-drive', { accessToken: 'drive-token' })
    const result = await toolRegistry.execute('google_drive_get_file', { fileId: 'file-123' })

    expect(requests.some((url) => url.includes('/files/file-123/export?mimeType=text%2Fplain'))).toBe(true)
    expect(requests.some((url) => url.includes('/about?fields=user'))).toBe(true)
    expect(result).toContain('Readable document body')
  })

  it('refreshes an expired Google access token before the next tool request', async () => {
    const apiAuthorization: string[] = []
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input)
      if (url === 'https://oauth2.googleapis.com/token') return json({ access_token: 'fresh-token', expires_in: 3600 })
      const headers = new Headers(init?.headers)
      apiAuthorization.push(headers.get('Authorization') ?? '')
      if (url.includes('/about?')) return json({ user: {} })
      if (url.includes('/files?')) return json({ files: [] })
      return json({}, 404)
    }) as typeof fetch

    await connectProviderAdapter('google-drive', {
      accessToken: 'expired-token',
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: Date.now() - 1000,
      clientId: 'desktop-client-id',
    })
    await toolRegistry.execute('google_drive_search', { query: "name contains 'notes'" })

    expect(apiAuthorization).toEqual(['Bearer fresh-token', 'Bearer fresh-token'])
    expect(globalThis.fetch).toHaveBeenCalledWith('https://oauth2.googleapis.com/token', expect.objectContaining({
      method: 'POST',
      body: expect.any(URLSearchParams),
    }))
  })

  it('checks the Supabase API key at connection time and sends publishable keys only as apikey', async () => {
    const requests: Array<{ url: string; headers: Headers }> = []
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input)
      requests.push({ url, headers: new Headers(init?.headers) })
      if (url.endsWith('/auth/v1/health')) return json({ version: 'test' })
      if (url.includes('/rest/v1/users?')) return json([{ id: 1 }])
      return json([])
    }) as typeof fetch

    await connectProviderAdapter('supabase', { apiKey: 'anon-key', baseUrl: 'https://demo.supabase.co' })
    const result = await toolRegistry.execute('supabase_select', { table: 'users' })

    expect(requests[0].url).toBe('https://demo.supabase.co/auth/v1/health')
    expect(requests[0].headers.get('apikey')).toBe('anon-key')
    expect(requests[0].headers.get('Authorization')).toBeNull()
    expect(JSON.parse(result)).toEqual([{ id: 1 }])
    expect(toolRegistry.getToolByName('supabase_list_tables')).toBeUndefined()
  })

  it('routes a connected database plugin into Chat and Code tool catalogs', async () => {
    globalThis.fetch = vi.fn(async () => json({ version: 'test' })) as typeof fetch
    await connectProviderAdapter('supabase', { apiKey: 'anon-key', baseUrl: 'https://demo.supabase.co' })

    const chatTools = selectRelevantTools('read the users table', toolRegistry.getAll(), DEFAULT_PERMISSIONS)
    const codeTools = toolRegistry.getAvailableTools(DEFAULT_PERMISSIONS)
      .filter((tool) => (CODEX_CATEGORIES as readonly string[]).includes(tool.category))

    expect(chatTools.map((tool) => tool.name)).toContain('supabase_select')
    expect(codeTools.map((tool) => tool.name)).toContain('supabase_select')
    expect(DEFAULT_PERMISSIONS.database).toBe('confirm')
  })

  it('does not register Supabase tools if the API key is rejected', async () => {
    globalThis.fetch = vi.fn(async () => json({ message: 'invalid API key' }, 401)) as typeof fetch

    await expect(connectProviderAdapter('supabase', { apiKey: 'wrong-key', baseUrl: 'https://demo.supabase.co' }))
      .rejects.toThrow(/401/)

    expect(toolRegistry.getToolByName('supabase_select')).toBeUndefined()
  })

  it('refuses to send a Supabase API key over an insecure non-local URL', async () => {
    globalThis.fetch = vi.fn(async () => json({ version: 'test' })) as typeof fetch

    await expect(connectProviderAdapter('supabase', { apiKey: 'key', baseUrl: 'http://supabase.example.com' }))
      .rejects.toThrow(/HTTPS/)

    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('decodes GitHub file contents instead of returning opaque base64', async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input)
      if (url.endsWith('/user')) return json({ login: 'shadow' })
      return json({
        name: 'README.md',
        type: 'file',
        encoding: 'base64',
        content: btoa('# Hello Lazarus'),
        html_url: 'https://github.com/example/repo/blob/main/README.md',
      })
    }) as typeof fetch

    await connectProviderAdapter('github', { accessToken: 'github-token' })
    const result = await toolRegistry.execute('github_get_file', {
      owner: 'example', repo: 'repo', path: 'README.md',
    })

    expect(result).toContain('# Hello Lazarus')
    expect(result).not.toContain('IyBIZWxsbyBMYXphcnVz')
  })

  it('connects the GitLab token adapter and routes its tools after verification', async () => {
    const requests: string[] = []
    globalThis.fetch = vi.fn(async (input, init) => {
      requests.push(String(input))
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gitlab-token')
      if (String(input).endsWith('/user')) return json({ username: 'shadow' })
      return json({ projects: [{ id: 1, name: 'Lazarus' }] })
    }) as typeof fetch

    await connectProviderAdapter('gitlab', { apiKey: 'gitlab-token' })
    const result = await toolRegistry.execute('gitlab_search', { query: 'Lazarus' })

    expect(requests[0]).toBe('https://gitlab.com/api/v4/user')
    expect(result).toContain('Lazarus')
  })

  it('uses Linear GraphQL for profile verification and issue search', async () => {
    const bodies: string[] = []
    globalThis.fetch = vi.fn(async (_input, init) => {
      bodies.push(String(init?.body))
      return json({ data: { viewer: { id: 'u1' }, issues: { nodes: [{ identifier: 'LAZ-1' }] } } })
    }) as typeof fetch

    await connectProviderAdapter('linear', { apiKey: 'linear-token' })
    await toolRegistry.execute('linear_search', { query: 'sandbox' })

    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toContain('sandbox')
    expect(bodies[1]).toContain('issues')
  })
})
