import { Cable, Check, CircleCheck, KeyRound, Search, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { isTauri } from '../../api/backend'
import { PLUGIN_CATALOG, PLUGIN_CATEGORIES } from '../../api/plugins/catalog'
import { connectProviderAdapter, disconnectProviderAdapter, getActiveProviderConnections, providerAdapters } from '../../api/plugins/adapters'
import { connectGoogleDrive } from '../../api/plugins/googleOAuth'
import { auditToolIntegrations, type ToolIntegrationAudit } from '../../api/plugins/toolIntegrationAudit'
import { usePluginStore } from '../../stores/pluginStore'
import type { PluginCapability, PluginManifest } from '../../api/plugins/types'
import { MCPServerSettings } from '../settings/MCPServerSettings'

/**
 * Shows implemented adapters separately from reference catalog entries and
 * exposes the live model-tool registry diagnostic next to connection controls.
 */
export function PluginsPage() {
  const [query, setQuery] = useState('')
  const [capability, setCapability] = useState<PluginCapability | 'all'>('all')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [connectionPlugin, setConnectionPlugin] = useState<PluginManifest | null>(null)
  const [credential, setCredential] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [googleClientId, setGoogleClientId] = useState(() =>
    usePluginStore.getState().googleOAuthClientId || import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID?.trim() || '',
  )
  const [audit, setAudit] = useState<ToolIntegrationAudit | null>(null)
  const [auditRunning, setAuditRunning] = useState(false)
  const connectionPanelRef = useRef<HTMLElement | null>(null)
  const { installed, install, setConnected, setGoogleOAuthClientId } = usePluginStore()
  const connectedProviderIds = useMemo(
    () => new Set(getActiveProviderConnections().map((connection) => connection.providerId)),
    [installed, audit],
  )
  const filtered = useMemo(() => PLUGIN_CATALOG.filter((plugin) => {
    const matchesQuery = !query.trim() || `${plugin.name} ${plugin.description}`.toLowerCase().includes(query.toLowerCase())
    const matchesCapability = capability === 'all' || plugin.capabilities.includes(capability)
    const category = categoryId ? PLUGIN_CATEGORIES.find((item) => item.id === categoryId) : undefined
    const matchesCategory = !category || category.capabilities.some((item) => plugin.capabilities.includes(item))
    return matchesQuery && matchesCapability && matchesCategory
  }), [capability, categoryId, query])

  const openConnection = (plugin: PluginManifest) => {
    setConnectionPlugin(plugin)
    setCredential('')
    setBaseUrl('')
    setConnectionError(null)
  }

  useEffect(() => {
    if (!connectionPlugin) return
    requestAnimationFrame(() => connectionPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }, [connectionPlugin])

  useEffect(() => {
    const applyFilter = (detail?: { query?: string; categoryId?: string }) => {
      setQuery(detail?.query ?? '')
      setCategoryId(detail?.categoryId ?? null)
      setCapability('all')
    }
    const pending = window.sessionStorage.getItem('lazarus:plugin-filter')
    if (pending) {
      try { applyFilter(JSON.parse(pending) as { query?: string; categoryId?: string }) } catch { /* ignore malformed transient state */ }
      window.sessionStorage.removeItem('lazarus:plugin-filter')
    }
    const handleFilter = (event: Event) => applyFilter((event as CustomEvent<{ query?: string; categoryId?: string }>).detail)
    window.addEventListener('lazarus:plugin-filter', handleFilter)
    return () => window.removeEventListener('lazarus:plugin-filter', handleFilter)
  }, [])

  const connect = async () => {
    if (!connectionPlugin?.adapterId) return
    setConnectionError(null)
    try {
      let accessToken = credential
      let refreshToken: string | undefined
      let accessTokenExpiresAt: number | undefined
      if (connectionPlugin.id === 'google-drive' && !accessToken) {
        if (!googleClientId.trim()) throw new Error('Enter a Google OAuth client ID for a Desktop app, then try again.')
        const tokens = await connectGoogleDrive(googleClientId)
        accessToken = tokens.accessToken
        refreshToken = tokens.refreshToken
        accessTokenExpiresAt = tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined
      }
      await connectProviderAdapter(connectionPlugin.adapterId, {
        accessToken: connectionPlugin.id === 'github' || connectionPlugin.id === 'google-drive' ? accessToken : undefined,
        refreshToken: connectionPlugin.id === 'google-drive' ? refreshToken : undefined,
        accessTokenExpiresAt: connectionPlugin.id === 'google-drive' ? accessTokenExpiresAt : undefined,
        clientId: connectionPlugin.id === 'google-drive' ? googleClientId.trim() : undefined,
        apiKey: connectionPlugin.id === 'supabase' || connectionPlugin.id === 'notion' ||
          ['gitlab', 'bitbucket', 'asana', 'clickup', 'linear', 'dropbox', 'airtable', 'coda', 'monday-com', 'vercel', 'hubspot', 'shopify', 'resend', 'sentry', 'posthog', 'digitalocean', 'railway', 'render', 'datadog', 'amplitude', 'salesforce', 'zoho-crm', 'calendly', 'zoom', 'figma', 'onedrive', 'box', 'jira', 'confluence', 'trello', 'slack', 'github-actions', 'tavily', 'exa', 'firecrawl', 'gmail', 'google-calendar', 'google-contacts', 'outlook-email', 'outlook-calendar', 'google-docs', 'google-sheets', 'google-slides', 'microsoft-teams', 'stripe', 'neon', 'bigquery', 'hugging-face', 'civitai', 'canva', 'miro', 'tldraw', 'gamma', 'wordpress', 'sharepoint', 'webflow', 'zapier', 'browser-automation', 'web-search'].includes(connectionPlugin.id) ? credential : undefined,
        baseUrl: connectionPlugin.id === 'supabase' ? baseUrl : undefined,
      })
      install(connectionPlugin.id)
      setConnected(connectionPlugin.id, true)
      setAudit(auditToolIntegrations())
      setConnectionPlugin(null)
      setCredential('')
      setBaseUrl('')
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : String(error))
    }
  }

  const disconnect = async (plugin: PluginManifest) => {
    if (plugin.adapterId) await disconnectProviderAdapter(plugin.adapterId)
    setConnected(plugin.id, false)
    setAudit(auditToolIntegrations())
  }

  const runAudit = async () => {
    setAuditRunning(true)
    try {
      setAudit(auditToolIntegrations())
    } finally {
      setAuditRunning(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-transparent">
      <div className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-8 sm:py-8">
        <header className="mb-7">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-xl border border-purple-400/25 bg-purple-500/10 p-2 text-purple-300 shadow-[0_0_24px_rgba(168,85,247,0.2)]">
              <Cable size={20} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-white">Plugins</h1>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-gray-400">
                Connect local MCP servers so Lazarus can work with files, services, and custom workflows.
              </p>
            </div>
          </div>
        </header>

        <section className="mb-7 rounded-2xl border border-purple-300/15 bg-black/20 p-4 shadow-[0_0_34px_rgba(126,34,206,0.08)] sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-100">Plugin catalog</h2>
                <p className="mt-1 text-xs text-gray-500">{Object.keys(providerAdapters).length} working service adapters. Other entries are catalog ideas and cannot be connected yet.</p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search plugins"
                aria-label="Search plugins"
                className="w-full rounded-lg border border-white/10 bg-white/[0.04] py-1.5 pl-8 pr-2 text-xs text-gray-200 outline-none placeholder:text-gray-600 focus:border-purple-400/40"
              />
            </div>
          </div>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {(['all', 'files', 'documents', 'code', 'database', 'web', 'media', 'calendar', 'email'] as const).map((value) => (
              <button
                key={value}
                onClick={() => { setCapability(value); setCategoryId(null) }}
                className={`rounded-full border px-2.5 py-1 text-[0.62rem] transition-colors ${capability === value ? 'border-purple-300/40 bg-purple-500/15 text-purple-200' : 'border-white/[0.08] text-gray-500 hover:border-white/20 hover:text-gray-300'}`}
              >
                {value === 'all' ? 'All' : value}
              </button>
            ))}
          </div>
          {categoryId && (
            <div className="mb-4 flex items-center gap-2 text-[0.65rem] text-purple-200/80">
              <span>Function: {PLUGIN_CATEGORIES.find((item) => item.id === categoryId)?.label}</span>
              <button onClick={() => setCategoryId(null)} className="rounded border border-purple-300/20 px-1.5 py-0.5 text-purple-200 hover:bg-purple-500/15">Clear</button>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((plugin) => (
              <PluginCard key={plugin.id} plugin={plugin} installed={Boolean(plugin.adapterId && installed[plugin.id])} connected={Boolean(plugin.adapterId && connectedProviderIds.has(plugin.adapterId))} onConnect={openConnection} onDisconnect={disconnect} />
            ))}
          </div>
          {!filtered.length && <p className="py-6 text-center text-xs text-gray-500">No plugins match that search.</p>}
        </section>

        {connectionPlugin && (
          <section ref={connectionPanelRef} className="mb-7 rounded-2xl border border-purple-300/25 bg-purple-950/20 p-4 shadow-[0_0_30px_rgba(168,85,247,0.12)] sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-100">Connect {connectionPlugin.name}</h2>
                <p className="mt-1 text-xs text-gray-500">The credential is held in memory for this session and is never written to the plugin store.</p>
              </div>
              <button onClick={() => setConnectionPlugin(null)} className="text-xs text-gray-500 hover:text-gray-200">Cancel</button>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {connectionPlugin.id === 'supabase' && (
                <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://your-project.supabase.co" aria-label="Supabase project URL" className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-gray-200 outline-none focus:border-purple-400/40" />
            )}
              {connectionPlugin.id === 'google-drive' && (
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[0.65rem] text-gray-400" htmlFor="google-oauth-client-id">Google OAuth client ID</label>
                  <input id="google-oauth-client-id" value={googleClientId} onChange={(event) => {
                    setGoogleClientId(event.target.value)
                    setGoogleOAuthClientId(event.target.value)
                  }} placeholder="123456789.apps.googleusercontent.com" className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-gray-200 outline-none focus:border-purple-400/40" />
                  <p className="mt-1 text-[0.6rem] leading-relaxed text-gray-500">Use a Desktop app OAuth client from your Google Cloud project, with the Drive API enabled. Lazarus remembers this public ID; access and refresh tokens remain in memory and must be reconnected after restarting Lazarus.</p>
                </div>
              )}
              {connectionPlugin.id !== 'google-drive' && <input type="password" value={credential} onChange={(event) => setCredential(event.target.value)} placeholder={connectionPlugin.id === 'supabase' ? 'Supabase API key' : connectionPlugin.id === 'notion' ? 'Notion integration token' : 'GitHub personal access token'} aria-label={`${connectionPlugin.name} credential`} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-gray-200 outline-none focus:border-purple-400/40" />}
              {connectionPlugin.id === 'supabase' && <p className="text-[0.6rem] leading-relaxed text-gray-500 sm:col-span-2">Use a publishable or anon key. Lazarus sends it as an API key and follows your row-level security. Do not paste a secret or service-role key; table discovery is intentionally not enabled.</p>}
            </div>
            {connectionPlugin.id === 'google-drive' && !isTauri() && (
              <p className="mt-3 rounded-lg border border-purple-300/15 bg-purple-500/[0.07] px-3 py-2 text-xs leading-relaxed text-purple-200/80">
                Preview mode can show this connection panel, but Google sign-in requires the Lazarus desktop build so it can receive the secure OAuth callback.
              </p>
            )}
            {connectionError && <p className="mt-2 text-xs text-red-300">{connectionError}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {connectionPlugin.id === 'google-drive' && <button onClick={() => void connect()} disabled={!isTauri() || !googleClientId.trim()} className="rounded-lg border border-purple-300/30 bg-purple-500/15 px-3 py-2 text-xs font-medium text-purple-100 transition-colors hover:bg-purple-500/25 disabled:cursor-not-allowed disabled:opacity-50">{!isTauri() ? 'Desktop sign-in required' : 'Sign in with Google'}</button>}
              {connectionPlugin.id !== 'google-drive' && <button onClick={() => void connect()} disabled={!credential || (connectionPlugin.id === 'supabase' && !baseUrl)} className="rounded-lg border border-purple-300/30 bg-purple-500/15 px-3 py-2 text-xs font-medium text-purple-100 transition-colors hover:bg-purple-500/25 disabled:cursor-not-allowed disabled:opacity-40">Connect tools</button>}
            </div>
          </section>
        )}

        <div className="mb-7 grid gap-3 sm:grid-cols-3">
          <InfoCard icon={Cable} title="Local connections" detail="MCP servers run through the local app connection." />
          <InfoCard icon={ShieldCheck} title="Permission gated" detail="Tool access still follows your existing permission settings." />
          <InfoCard icon={KeyRound} title="Bring your services" detail="Add the servers you trust instead of relying on a hidden catalog." />
        </div>

        <section className="mb-7 rounded-2xl border border-purple-300/15 bg-black/20 p-4 shadow-[0_0_34px_rgba(126,34,206,0.08)] sm:p-5" aria-label="Integration health">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-100">Integration health</h2>
              <p className="mt-1 text-xs text-gray-500">Checks actual tool registration, not just the saved Connected label.</p>
            </div>
            <button onClick={() => void runAudit()} disabled={auditRunning} className="rounded-lg border border-purple-300/25 bg-purple-500/10 px-3 py-1.5 text-xs text-purple-100 hover:bg-purple-500/20 disabled:opacity-50">
              {auditRunning ? 'Checking…' : 'Run integration check'}
            </button>
          </div>
          {audit && (
            <div className="mt-4 space-y-2">
              {audit.checks.map((check) => (
                <div key={check.id} className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                  {check.status === 'ready' ? <CircleCheck size={14} className="mt-0.5 shrink-0 text-green-400" /> : check.status === 'needs-attention' ? <ShieldAlert size={14} className="mt-0.5 shrink-0 text-amber-300" /> : <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-gray-600" />}
                  <div className="min-w-0">
                    <p className="text-[0.68rem] font-medium text-gray-200">{check.label}</p>
                    <p className="mt-0.5 text-[0.6rem] leading-relaxed text-gray-500">{check.detail}</p>
                  </div>
                </div>
              ))}
              <p className="text-right text-[0.55rem] text-gray-600">{audit.toolCount} live tools checked · {new Date(audit.checkedAt).toLocaleTimeString()}</p>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-purple-300/15 bg-black/20 p-4 shadow-[0_0_34px_rgba(126,34,206,0.08)] sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles size={15} className="text-purple-300" />
            <div>
              <h2 className="text-sm font-semibold text-gray-100">Connected tools</h2>
              <p className="text-xs text-gray-500">Add an MCP server, connect it, and its tools will become available to the agent.</p>
            </div>
          </div>
          <MCPServerSettings />
        </section>

        <section className="mt-5 rounded-2xl border border-white/[0.07] bg-black/10 p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-gray-200">Plugin roadmap</h2>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">Google Drive, GitHub, and Supabase are the currently implemented service adapters. The rest of this catalog is reference material until a real sign-in flow, adapter, and tool-registration check are added.</p>
        </section>
      </div>
    </div>
  )
}

function PluginCard({
  plugin,
  installed,
  connected,
  onConnect,
  onDisconnect,
}: {
  plugin: PluginManifest
  installed: boolean
  connected: boolean
  onConnect: (plugin: PluginManifest) => void
  onDisconnect: (plugin: PluginManifest) => void
}) {
  return (
    <article className="flex min-h-36 flex-col rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 transition-colors hover:border-purple-300/25">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-medium text-gray-200">{plugin.name}</h3>
          <p className="mt-1 text-[0.62rem] leading-relaxed text-gray-500">{plugin.description}</p>
        </div>
        {connected && <Check size={14} className="shrink-0 text-green-300" aria-label="Connected and registered" />}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <span className="text-[0.56rem] uppercase tracking-wide text-gray-600">{plugin.adapterId ? connected ? 'tools registered' : installed ? 'ready to connect' : 'working adapter' : 'catalog only'}</span>
        <button
          onClick={() => plugin.adapterId && (connected ? onDisconnect(plugin) : onConnect(plugin))}
          disabled={!plugin.adapterId}
          title={plugin.adapterId ? undefined : 'A connector for this catalog entry has not been implemented.'}
          className={`rounded-md border px-2 py-1 text-[0.6rem] transition-colors ${plugin.adapterId ? installed ? 'border-purple-300/25 text-purple-200 hover:border-red-300/30 hover:text-red-300' : 'border-white/10 text-gray-400 hover:border-purple-300/30 hover:text-purple-200' : 'cursor-not-allowed border-white/[0.05] text-gray-600'}`}
        >
          {plugin.adapterId ? (connected ? 'Disconnect' : 'Connect') : 'Coming soon'}
        </button>
      </div>
    </article>
  )
}

function InfoCard({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof Cable
  title: string
  detail: string
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5">
      <Icon size={15} className="mb-2 text-purple-300" />
      <h3 className="text-xs font-medium text-gray-200">{title}</h3>
      <p className="mt-1 text-[0.68rem] leading-relaxed text-gray-500">{detail}</p>
    </div>
  )
}
