import type { MCPToolDefinition } from '../../mcp/types'
import { providerJson, requireCredential, stringArg } from './http'
import type { ProviderAdapter, ProviderCredentials, ProviderConnection } from './types'

type TokenApiConfig = {
  providerId: string
  displayName: string
  verifyUrl: string
  searchUrl: (query: string) => string
  auth: 'bearer' | 'token'
}

/** Shared, read-first connector for providers with a personal token API. */
export function createTokenApiAdapter(config: TokenApiConfig): ProviderAdapter {
  const tools: MCPToolDefinition[] = [
    {
      name: `${config.providerId}_search`,
      description: `Search the connected ${config.displayName} account. Read-only.`,
      category: 'workflow', source: 'external', serverId: `plugin:${config.providerId}`,
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
    {
      name: `${config.providerId}_profile`,
      description: `Read the connected ${config.displayName} account profile. Read-only.`,
      category: 'workflow', source: 'external', serverId: `plugin:${config.providerId}`,
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
  ]

  return {
    providerId: config.providerId,
    displayName: config.displayName,
    transport: 'api-key',
    async connect(credentials: ProviderCredentials): Promise<ProviderConnection> {
      const token = requireCredential(credentials, config.displayName)
      const request = <T,>(url: string) => providerJson<T>(url, {
        headers: config.auth === 'bearer' ? { Authorization: `Bearer ${token}` } : { Authorization: `token ${token}` },
      })
      return {
        providerId: config.providerId,
        tools,
        async verify() { await request(config.verifyUrl) },
        async call(toolName, args) {
          if (toolName === `${config.providerId}_profile`) return JSON.stringify(await request(config.verifyUrl))
          if (toolName === `${config.providerId}_search`) return JSON.stringify(await request(config.searchUrl(stringArg(args, 'query'))))
          throw new Error(`Unknown ${config.displayName} tool: ${toolName}`)
        },
        async disconnect() {},
      }
    },
  }
}

export const gitlabAdapter = createTokenApiAdapter({ providerId: 'gitlab', displayName: 'GitLab', verifyUrl: 'https://gitlab.com/api/v4/user', searchUrl: (q) => `https://gitlab.com/api/v4/projects?simple=true&per_page=20&search=${encodeURIComponent(q)}`, auth: 'bearer' })
export const bitbucketAdapter = createTokenApiAdapter({ providerId: 'bitbucket', displayName: 'Bitbucket', verifyUrl: 'https://api.bitbucket.org/2.0/user', searchUrl: (q) => `https://api.bitbucket.org/2.0/repositories/?q=name~"${encodeURIComponent(q)}"&pagelen=20`, auth: 'bearer' })
export const asanaAdapter = createTokenApiAdapter({ providerId: 'asana', displayName: 'Asana', verifyUrl: 'https://app.asana.com/api/1.0/users/me', searchUrl: () => `https://app.asana.com/api/1.0/workspaces`, auth: 'bearer' })
export const clickUpAdapter = createTokenApiAdapter({ providerId: 'clickup', displayName: 'ClickUp', verifyUrl: 'https://api.clickup.com/api/v2/user', searchUrl: () => 'https://api.clickup.com/api/v2/team', auth: 'bearer' })

/** Linear uses GraphQL rather than a REST endpoint, so keep its request shape explicit. */
export const linearAdapter: ProviderAdapter = {
  providerId: 'linear',
  displayName: 'Linear',
  transport: 'api-key',
  async connect(credentials) {
    const token = requireCredential(credentials, 'Linear')
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const request = async <T,>(query: string, variables: Record<string, unknown> = {}) => providerJson<{ data?: T; errors?: Array<{ message?: string }> }>('https://api.linear.app/graphql', {
      method: 'POST', headers, body: JSON.stringify({ query, variables }),
    }).then((payload) => {
      if (payload.errors?.length) throw new Error(`Linear request failed: ${payload.errors[0]?.message ?? 'GraphQL error'}`)
      return payload.data as T
    })
    const tools: MCPToolDefinition[] = [
      { name: 'linear_search', description: 'Search Linear issues by text.', category: 'workflow', source: 'external', serverId: 'plugin:linear', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
      { name: 'linear_profile', description: 'Read the connected Linear account.', category: 'workflow', source: 'external', serverId: 'plugin:linear', inputSchema: { type: 'object', properties: {}, required: [] } },
    ]
    return {
      providerId: 'linear', tools,
      async verify() { await request('{ viewer { id name email } }') },
      async call(toolName, args) {
        if (toolName === 'linear_profile') return JSON.stringify(await request('{ viewer { id name email } }'))
        if (toolName === 'linear_search') return JSON.stringify(await request('query($query: String!) { issues(filter: { search: { eq: $query } }, first: 20) { nodes { id identifier title state { name } } } }', { query: stringArg(args, 'query') }))
        throw new Error(`Unknown Linear tool: ${toolName}`)
      },
      async disconnect() {},
    }
  },
}

export const dropboxAdapter = createTokenApiAdapter({ providerId: 'dropbox', displayName: 'Dropbox', verifyUrl: 'https://api.dropboxapi.com/2/users/get_current_account', searchUrl: () => 'https://api.dropboxapi.com/2/files/search_v2', auth: 'bearer' })
export const airtableAdapter = createTokenApiAdapter({ providerId: 'airtable', displayName: 'Airtable', verifyUrl: 'https://api.airtable.com/v0/meta/whoami', searchUrl: () => 'https://api.airtable.com/v0/meta/bases', auth: 'bearer' })
export const codaAdapter = createTokenApiAdapter({ providerId: 'coda', displayName: 'Coda', verifyUrl: 'https://coda.io/apis/v1/whoami', searchUrl: () => 'https://coda.io/apis/v1/docs', auth: 'bearer' })
export const mondayAdapter: ProviderAdapter = {
  providerId: 'monday-com', displayName: 'monday.com', transport: 'api-key',
  async connect(credentials) {
    const token = requireCredential(credentials, 'monday.com')
    const headers = { Authorization: token, 'Content-Type': 'application/json' }
    const request = async <T,>(query: string) => providerJson<{ data?: T; errors?: Array<{ message?: string }> }>('https://api.monday.com/v2', { method: 'POST', headers, body: JSON.stringify({ query }) }).then((payload) => {
      if (payload.errors?.length) throw new Error(`monday.com request failed: ${payload.errors[0]?.message ?? 'GraphQL error'}`)
      return payload.data as T
    })
    const tools: MCPToolDefinition[] = [
      { name: 'monday_com_search', description: 'List accessible monday.com boards.', category: 'workflow', source: 'external', serverId: 'plugin:monday-com', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
      { name: 'monday_com_profile', description: 'Read the connected monday.com account.', category: 'workflow', source: 'external', serverId: 'plugin:monday-com', inputSchema: { type: 'object', properties: {}, required: [] } },
    ]
    return { providerId: 'monday-com', tools, async verify() { await request('{ me { id name email } }') }, async call(toolName) {
      if (toolName === 'monday_com_profile') return JSON.stringify(await request('{ me { id name email } }'))
      if (toolName === 'monday_com_search') return JSON.stringify(await request('{ boards(limit: 50) { id name state } }'))
      throw new Error(`Unknown monday.com tool: ${toolName}`)
    }, async disconnect() {} }
  },
}
export const vercelAdapter = createTokenApiAdapter({ providerId: 'vercel', displayName: 'Vercel', verifyUrl: 'https://api.vercel.com/v2/user', searchUrl: (q) => `https://api.vercel.com/v9/projects?limit=20&search=${encodeURIComponent(q)}`, auth: 'bearer' })
export const hubspotAdapter = createTokenApiAdapter({ providerId: 'hubspot', displayName: 'HubSpot', verifyUrl: 'https://api.hubapi.com/oauth/v1/access-tokens', searchUrl: () => 'https://api.hubapi.com/crm/v3/objects/contacts?limit=20', auth: 'bearer' })
export const shopifyAdapter = createTokenApiAdapter({ providerId: 'shopify', displayName: 'Shopify', verifyUrl: 'https://shopify.com/admin/api/2024-10/shop.json', searchUrl: () => 'https://shopify.com/admin/api/2024-10/products.json?limit=20', auth: 'bearer' })
export const resendAdapter = createTokenApiAdapter({ providerId: 'resend', displayName: 'Resend', verifyUrl: 'https://api.resend.com/api-keys', searchUrl: () => 'https://api.resend.com/domains', auth: 'bearer' })
export const sentryAdapter = createTokenApiAdapter({ providerId: 'sentry', displayName: 'Sentry', verifyUrl: 'https://sentry.io/api/0/organizations/', searchUrl: (q) => `https://sentry.io/api/0/projects/?query=${encodeURIComponent(q)}`, auth: 'bearer' })
export const posthogAdapter = createTokenApiAdapter({ providerId: 'posthog', displayName: 'PostHog', verifyUrl: 'https://app.posthog.com/api/projects/', searchUrl: () => 'https://app.posthog.com/api/projects/', auth: 'bearer' })
export const digitalOceanAdapter = createTokenApiAdapter({ providerId: 'digitalocean', displayName: 'DigitalOcean', verifyUrl: 'https://api.digitalocean.com/v2/account', searchUrl: () => 'https://api.digitalocean.com/v2/droplets?per_page=20', auth: 'bearer' })
export const railwayAdapter = createTokenApiAdapter({ providerId: 'railway', displayName: 'Railway', verifyUrl: 'https://backboard.railway.app/graphql/v2', searchUrl: () => 'https://backboard.railway.app/graphql/v2', auth: 'bearer' })
export const renderAdapter = createTokenApiAdapter({ providerId: 'render', displayName: 'Render', verifyUrl: 'https://api.render.com/v1/owners?limit=1', searchUrl: () => 'https://api.render.com/v1/services?limit=20', auth: 'bearer' })
export const datadogAdapter = createTokenApiAdapter({ providerId: 'datadog', displayName: 'Datadog', verifyUrl: 'https://api.datadoghq.com/api/v1/validate', searchUrl: () => 'https://api.datadoghq.com/api/v1/monitor', auth: 'bearer' })
export const amplitudeAdapter = createTokenApiAdapter({ providerId: 'amplitude', displayName: 'Amplitude', verifyUrl: 'https://api2.amplitude.com/2/userprofile', searchUrl: () => 'https://api2.amplitude.com/2/userprofile', auth: 'bearer' })
export const salesforceAdapter = createTokenApiAdapter({ providerId: 'salesforce', displayName: 'Salesforce', verifyUrl: 'https://login.salesforce.com/services/oauth2/userinfo', searchUrl: () => 'https://login.salesforce.com/services/data/v60.0/query/?q=SELECT+Id,Name+FROM+Account+LIMIT+20', auth: 'bearer' })
export const zohoCrmAdapter = createTokenApiAdapter({ providerId: 'zoho-crm', displayName: 'Zoho CRM', verifyUrl: 'https://www.zohoapis.com/crm/v6/users?type=CurrentUser', searchUrl: () => 'https://www.zohoapis.com/crm/v6/Accounts?per_page=20', auth: 'bearer' })
export const calendlyAdapter = createTokenApiAdapter({ providerId: 'calendly', displayName: 'Calendly', verifyUrl: 'https://api.calendly.com/users/me', searchUrl: () => 'https://api.calendly.com/event_types?count=20', auth: 'bearer' })
export const zoomAdapter = createTokenApiAdapter({ providerId: 'zoom', displayName: 'Zoom', verifyUrl: 'https://api.zoom.us/v2/users/me', searchUrl: () => 'https://api.zoom.us/v2/users/me/meetings?page_size=20', auth: 'bearer' })
export const figmaAdapter = createTokenApiAdapter({ providerId: 'figma', displayName: 'Figma', verifyUrl: 'https://api.figma.com/v1/me', searchUrl: () => 'https://api.figma.com/v1/me', auth: 'bearer' })
export const oneDriveAdapter = createTokenApiAdapter({ providerId: 'onedrive', displayName: 'OneDrive', verifyUrl: 'https://graph.microsoft.com/v1.0/me', searchUrl: () => 'https://graph.microsoft.com/v1.0/me/drive/root/children', auth: 'bearer' })
export const boxAdapter = createTokenApiAdapter({ providerId: 'box', displayName: 'Box', verifyUrl: 'https://api.box.com/2.0/users/me', searchUrl: (q) => `https://api.box.com/2.0/search?query=${encodeURIComponent(q)}&limit=20`, auth: 'bearer' })
export const jiraAdapter = createTokenApiAdapter({ providerId: 'jira', displayName: 'Jira', verifyUrl: 'https://api.atlassian.com/me', searchUrl: (q) => `https://api.atlassian.com/ex/jira/cloud/search?jql=text~%22${encodeURIComponent(q)}%22&maxResults=20`, auth: 'bearer' })
export const confluenceAdapter = createTokenApiAdapter({ providerId: 'confluence', displayName: 'Confluence', verifyUrl: 'https://api.atlassian.com/me', searchUrl: (q) => `https://api.atlassian.com/ex/confluence/cloud/rest/api/content/search?cql=text~%22${encodeURIComponent(q)}%22&limit=20`, auth: 'bearer' })
export const trelloAdapter = createTokenApiAdapter({ providerId: 'trello', displayName: 'Trello', verifyUrl: 'https://api.trello.com/1/members/me', searchUrl: () => 'https://api.trello.com/1/members/me/boards', auth: 'bearer' })
export const slackAdapter = createTokenApiAdapter({ providerId: 'slack', displayName: 'Slack', verifyUrl: 'https://slack.com/api/auth.test', searchUrl: (q) => `https://slack.com/api/search.all?query=${encodeURIComponent(q)}`, auth: 'bearer' })
export const githubActionsAdapter = createTokenApiAdapter({ providerId: 'github-actions', displayName: 'GitHub Actions', verifyUrl: 'https://api.github.com/user', searchUrl: () => 'https://api.github.com/repos', auth: 'bearer' })
export const tavilyAdapter = createTokenApiAdapter({ providerId: 'tavily', displayName: 'Tavily', verifyUrl: 'https://api.tavily.com/search', searchUrl: () => 'https://api.tavily.com/search', auth: 'bearer' })
export const exaAdapter = createTokenApiAdapter({ providerId: 'exa', displayName: 'Exa', verifyUrl: 'https://api.exa.ai/search', searchUrl: () => 'https://api.exa.ai/search', auth: 'bearer' })
export const firecrawlAdapter = createTokenApiAdapter({ providerId: 'firecrawl', displayName: 'Firecrawl', verifyUrl: 'https://api.firecrawl.dev/v1/team', searchUrl: (q) => `https://api.firecrawl.dev/v1/search?q=${encodeURIComponent(q)}`, auth: 'bearer' })
export const gmailAdapter = createTokenApiAdapter({ providerId: 'gmail', displayName: 'Gmail', verifyUrl: 'https://gmail.googleapis.com/gmail/v1/users/me/profile', searchUrl: (q) => `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=20`, auth: 'bearer' })
export const googleCalendarAdapter = createTokenApiAdapter({ providerId: 'google-calendar', displayName: 'Google Calendar', verifyUrl: 'https://www.googleapis.com/calendar/v3/users/me/calendarList', searchUrl: () => 'https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=20', auth: 'bearer' })
export const googleContactsAdapter = createTokenApiAdapter({ providerId: 'google-contacts', displayName: 'Google Contacts', verifyUrl: 'https://people.googleapis.com/v1/people/me?personFields=names,emailAddresses', searchUrl: () => 'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses&pageSize=20', auth: 'bearer' })
export const outlookEmailAdapter = createTokenApiAdapter({ providerId: 'outlook-email', displayName: 'Outlook Email', verifyUrl: 'https://graph.microsoft.com/v1.0/me', searchUrl: (q) => `https://graph.microsoft.com/v1.0/me/messages?$top=20&$search=%22${encodeURIComponent(q)}%22`, auth: 'bearer' })
export const outlookCalendarAdapter = createTokenApiAdapter({ providerId: 'outlook-calendar', displayName: 'Outlook Calendar', verifyUrl: 'https://graph.microsoft.com/v1.0/me', searchUrl: () => 'https://graph.microsoft.com/v1.0/me/calendar/events?$top=20', auth: 'bearer' })
export const googleDocsAdapter = createTokenApiAdapter({ providerId: 'google-docs', displayName: 'Google Docs', verifyUrl: 'https://www.googleapis.com/drive/v3/about?fields=user', searchUrl: (q) => `https://www.googleapis.com/drive/v3/files?q=fullText%20contains%20%27${encodeURIComponent(q)}%27&spaces=drive&pageSize=20`, auth: 'bearer' })
export const googleSheetsAdapter = createTokenApiAdapter({ providerId: 'google-sheets', displayName: 'Google Sheets', verifyUrl: 'https://www.googleapis.com/drive/v3/about?fields=user', searchUrl: () => 'https://sheets.googleapis.com/v4/spreadsheets', auth: 'bearer' })
export const googleSlidesAdapter = createTokenApiAdapter({ providerId: 'google-slides', displayName: 'Google Slides', verifyUrl: 'https://www.googleapis.com/drive/v3/about?fields=user', searchUrl: () => 'https://slides.googleapis.com/v1/presentations', auth: 'bearer' })
export const teamsAdapter = createTokenApiAdapter({ providerId: 'microsoft-teams', displayName: 'Microsoft Teams', verifyUrl: 'https://graph.microsoft.com/v1.0/me', searchUrl: () => 'https://graph.microsoft.com/v1.0/teams', auth: 'bearer' })
export const stripeAdapter = createTokenApiAdapter({ providerId: 'stripe', displayName: 'Stripe', verifyUrl: 'https://api.stripe.com/v1/account', searchUrl: () => 'https://api.stripe.com/v1/customers?limit=20', auth: 'bearer' })
export const neonAdapter = createTokenApiAdapter({ providerId: 'neon', displayName: 'Neon', verifyUrl: 'https://console.neon.tech/api/v2/projects?limit=1', searchUrl: () => 'https://console.neon.tech/api/v2/projects?limit=20', auth: 'bearer' })
export const bigQueryAdapter = createTokenApiAdapter({ providerId: 'bigquery', displayName: 'BigQuery', verifyUrl: 'https://bigquery.googleapis.com/bigquery/v2/projects', searchUrl: () => 'https://bigquery.googleapis.com/bigquery/v2/projects', auth: 'bearer' })
export const huggingFaceAdapter = createTokenApiAdapter({ providerId: 'hugging-face', displayName: 'Hugging Face', verifyUrl: 'https://huggingface.co/api/whoami-v2', searchUrl: (q) => `https://huggingface.co/api/models?search=${encodeURIComponent(q)}&limit=20`, auth: 'bearer' })
export const civitaiAdapter = createTokenApiAdapter({ providerId: 'civitai', displayName: 'Civitai', verifyUrl: 'https://civitai.com/api/v1/user', searchUrl: (q) => `https://civitai.com/api/v1/models?query=${encodeURIComponent(q)}&limit=20`, auth: 'bearer' })
export const canvaAdapter = createTokenApiAdapter({ providerId: 'canva', displayName: 'Canva', verifyUrl: 'https://api.canva.com/rest/v1/user', searchUrl: (q) => `https://api.canva.com/rest/v1/designs?query=${encodeURIComponent(q)}&limit=20`, auth: 'bearer' })
export const miroAdapter = createTokenApiAdapter({ providerId: 'miro', displayName: 'Miro', verifyUrl: 'https://api.miro.com/v1/users/me', searchUrl: () => 'https://api.miro.com/v1/boards?limit=20', auth: 'bearer' })
export const tldrawAdapter = createTokenApiAdapter({ providerId: 'tldraw', displayName: 'tldraw', verifyUrl: 'https://api.tldraw.com/v1/me', searchUrl: () => 'https://api.tldraw.com/v1/boards', auth: 'bearer' })
export const gammaAdapter = createTokenApiAdapter({ providerId: 'gamma', displayName: 'Gamma', verifyUrl: 'https://api.gamma.app/v1/me', searchUrl: () => 'https://api.gamma.app/v1/documents', auth: 'bearer' })
export const wordpressAdapter = createTokenApiAdapter({ providerId: 'wordpress', displayName: 'WordPress', verifyUrl: 'https://public-api.wordpress.com/rest/v1.1/me', searchUrl: (q) => `https://public-api.wordpress.com/rest/v1.1/sites?search=${encodeURIComponent(q)}&number=20`, auth: 'bearer' })
export const sharePointAdapter = createTokenApiAdapter({ providerId: 'sharepoint', displayName: 'SharePoint', verifyUrl: 'https://graph.microsoft.com/v1.0/sites/root', searchUrl: (q) => `https://graph.microsoft.com/v1.0/search/query?query=${encodeURIComponent(q)}`, auth: 'bearer' })
export const webflowAdapter = createTokenApiAdapter({ providerId: 'webflow', displayName: 'Webflow', verifyUrl: 'https://api.webflow.com/v2/workspaces', searchUrl: () => 'https://api.webflow.com/v2/sites', auth: 'bearer' })
export const zapierAdapter = createTokenApiAdapter({ providerId: 'zapier', displayName: 'Zapier', verifyUrl: 'https://api.zapier.com/v1/me', searchUrl: () => 'https://api.zapier.com/v1/zaps', auth: 'bearer' })
export const browserAutomationAdapter = createTokenApiAdapter({ providerId: 'browser-automation', displayName: 'Browser automation', verifyUrl: 'https://api.browserbase.com/v1/sessions?limit=1', searchUrl: () => 'https://api.browserbase.com/v1/sessions?limit=20', auth: 'bearer' })
export const webSearchAdapter = createTokenApiAdapter({ providerId: 'web-search', displayName: 'Web search', verifyUrl: 'https://api.search.brave.com/res/v1/web/search?q=lazarus', searchUrl: (q) => `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}`, auth: 'bearer' })
export const genericRestAdapter = createTokenApiAdapter({ providerId: 'generic-rest-api', displayName: 'Generic REST API', verifyUrl: 'https://example.invalid/health', searchUrl: (q) => `https://example.invalid/search?q=${encodeURIComponent(q)}`, auth: 'bearer' })
