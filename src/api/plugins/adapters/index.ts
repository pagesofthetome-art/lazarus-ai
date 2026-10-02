import { toolRegistry } from '../../mcp/tool-registry'
import type { ProviderAdapter, ProviderConnection, ProviderCredentials } from './types'
import { googleDriveAdapter } from './googleDrive'
import { githubAdapter } from './github'
import { supabaseAdapter } from './supabase'
import { notionAdapter } from './notion'
import { airtableAdapter, amplitudeAdapter, asanaAdapter, bigQueryAdapter, bitbucketAdapter, boxAdapter, browserAutomationAdapter, calendlyAdapter, canvaAdapter, civitaiAdapter, codaAdapter, clickUpAdapter, confluenceAdapter, datadogAdapter, digitalOceanAdapter, dropboxAdapter, exaAdapter, figmaAdapter, firecrawlAdapter, gammaAdapter, gmailAdapter, gitlabAdapter, githubActionsAdapter, googleCalendarAdapter, googleContactsAdapter, googleDocsAdapter, googleSheetsAdapter, googleSlidesAdapter, huggingFaceAdapter, hubspotAdapter, jiraAdapter, linearAdapter, miroAdapter, mondayAdapter, neonAdapter, oneDriveAdapter, outlookCalendarAdapter, outlookEmailAdapter, posthogAdapter, railwayAdapter, renderAdapter, resendAdapter, salesforceAdapter, sentryAdapter, sharePointAdapter, shopifyAdapter, slackAdapter, stripeAdapter, tavilyAdapter, teamsAdapter, tldrawAdapter, trelloAdapter, vercelAdapter, webflowAdapter, webSearchAdapter, wordpressAdapter, zapierAdapter, zoomAdapter, zohoCrmAdapter } from './tokenApi'

export type { ProviderAdapter, ProviderConnection, ProviderCredentials } from './types'
export { googleDriveAdapter } from './googleDrive'
export { githubAdapter } from './github'
export { supabaseAdapter } from './supabase'
export { notionAdapter } from './notion'
export { airtableAdapter, amplitudeAdapter, asanaAdapter, bigQueryAdapter, bitbucketAdapter, boxAdapter, browserAutomationAdapter, calendlyAdapter, canvaAdapter, civitaiAdapter, codaAdapter, clickUpAdapter, confluenceAdapter, datadogAdapter, digitalOceanAdapter, dropboxAdapter, exaAdapter, figmaAdapter, firecrawlAdapter, gammaAdapter, gmailAdapter, gitlabAdapter, githubActionsAdapter, googleCalendarAdapter, googleContactsAdapter, googleDocsAdapter, googleSheetsAdapter, googleSlidesAdapter, huggingFaceAdapter, hubspotAdapter, jiraAdapter, linearAdapter, miroAdapter, mondayAdapter, neonAdapter, oneDriveAdapter, outlookCalendarAdapter, outlookEmailAdapter, posthogAdapter, railwayAdapter, renderAdapter, resendAdapter, salesforceAdapter, sentryAdapter, sharePointAdapter, shopifyAdapter, slackAdapter, stripeAdapter, tavilyAdapter, teamsAdapter, tldrawAdapter, trelloAdapter, vercelAdapter, webflowAdapter, webSearchAdapter, wordpressAdapter, zapierAdapter, zoomAdapter, zohoCrmAdapter } from './tokenApi'

export const providerAdapters: Record<string, ProviderAdapter> = {
  'google-drive': googleDriveAdapter,
  github: githubAdapter,
  supabase: supabaseAdapter,
  notion: notionAdapter,
  gitlab: gitlabAdapter,
  bitbucket: bitbucketAdapter,
  asana: asanaAdapter,
  clickup: clickUpAdapter,
  linear: linearAdapter,
  dropbox: dropboxAdapter,
  airtable: airtableAdapter,
  coda: codaAdapter,
  'monday-com': mondayAdapter,
  vercel: vercelAdapter,
  hubspot: hubspotAdapter,
  shopify: shopifyAdapter,
  resend: resendAdapter,
  sentry: sentryAdapter,
  posthog: posthogAdapter,
  digitalocean: digitalOceanAdapter,
  railway: railwayAdapter,
  render: renderAdapter,
  datadog: datadogAdapter,
  amplitude: amplitudeAdapter,
  salesforce: salesforceAdapter,
  'zoho-crm': zohoCrmAdapter,
  calendly: calendlyAdapter,
  zoom: zoomAdapter,
  figma: figmaAdapter,
  onedrive: oneDriveAdapter,
  box: boxAdapter,
  jira: jiraAdapter,
  confluence: confluenceAdapter,
  trello: trelloAdapter,
  slack: slackAdapter,
  'github-actions': githubActionsAdapter,
  tavily: tavilyAdapter,
  exa: exaAdapter,
  firecrawl: firecrawlAdapter,
  gmail: gmailAdapter,
  'google-calendar': googleCalendarAdapter,
  'google-contacts': googleContactsAdapter,
  'outlook-email': outlookEmailAdapter,
  'outlook-calendar': outlookCalendarAdapter,
  'google-docs': googleDocsAdapter,
  'google-sheets': googleSheetsAdapter,
  'google-slides': googleSlidesAdapter,
  'microsoft-teams': teamsAdapter,
  stripe: stripeAdapter,
  neon: neonAdapter,
  bigquery: bigQueryAdapter,
  'hugging-face': huggingFaceAdapter,
  civitai: civitaiAdapter,
  canva: canvaAdapter,
  miro: miroAdapter,
  tldraw: tldrawAdapter,
  gamma: gammaAdapter,
  wordpress: wordpressAdapter,
  sharepoint: sharePointAdapter,
  webflow: webflowAdapter,
  zapier: zapierAdapter,
  'browser-automation': browserAutomationAdapter,
  'web-search': webSearchAdapter,
}

const activeConnections = new Map<string, ProviderConnection>()

export function getActiveProviderConnections(): Array<{ providerId: string; toolNames: string[] }> {
  return Array.from(activeConnections, ([providerId, connection]) => ({
    providerId,
    toolNames: connection.tools.map((tool) => tool.name),
  }))
}

/** Connect an adapter and publish its tools under an isolated provider id. */
export async function connectProviderAdapter(providerId: string, credentials: ProviderCredentials): Promise<ProviderConnection> {
  const adapter = providerAdapters[providerId]
  if (!adapter) throw new Error(`No provider adapter is available for ${providerId}.`)
  const connection = await adapter.connect(credentials)
  const serverId = `plugin:${providerId}`
  if (connection.tools.length === 0) throw new Error(`${adapter.displayName} returned no tools to connect.`)
  const names = connection.tools.map((tool) => tool.name)
  if (new Set(names).size !== names.length) throw new Error(`${adapter.displayName} returned duplicate tool names.`)
  for (const name of names) {
    const existing = toolRegistry.getToolByName(name)
    if (existing && existing.serverId !== serverId) {
      throw new Error(`${adapter.displayName} tool "${name}" conflicts with another registered tool.`)
    }
  }

  // Check credentials before the UI can say Connected or publish tool schemas.
  try {
    await connection.verify()
    toolRegistry.registerExternal(serverId, connection.tools, (toolName, args) => connection.call(toolName, args))
    const missing = names.filter((name) => toolRegistry.getToolByName(name)?.serverId !== serverId)
    if (missing.length) throw new Error(`${adapter.displayName} tools could not be registered: ${missing.join(', ')}.`)
  } catch (error) {
    toolRegistry.unregisterServer(serverId)
    const previous = activeConnections.get(providerId)
    if (previous) {
      toolRegistry.registerExternal(serverId, previous.tools, (toolName, args) => previous.call(toolName, args))
    }
    await connection.disconnect().catch(() => undefined)
    throw error
  }

  const previous = activeConnections.get(providerId)
  activeConnections.set(providerId, connection)
  if (previous && previous !== connection) await previous.disconnect().catch(() => undefined)
  return connection
}

export async function disconnectProviderAdapter(providerId: string) {
  const connection = activeConnections.get(providerId)
  if (connection) await connection.disconnect()
  activeConnections.delete(providerId)
  toolRegistry.unregisterServer(`plugin:${providerId}`)
}
