import type { PluginCapability, PluginManifest, PluginTransport } from './types'

export interface PluginCategory {
  id: string
  label: string
  description: string
  capabilities: PluginCapability[]
}

/** Broad groups used by the compact Plugins menu and the catalog filters. */
export const PLUGIN_CATEGORIES: PluginCategory[] = [
  { id: 'files-documents', label: 'Files & documents', description: 'Drive, PDFs, office files, notes, and storage.', capabilities: ['files', 'documents'] },
  { id: 'developer-tools', label: 'Developer tools', description: 'Repositories, runtimes, code, and deployments.', capabilities: ['code'] },
  { id: 'data-databases', label: 'Data & databases', description: 'SQL, data warehouses, tables, and APIs.', capabilities: ['database'] },
  { id: 'web-automation', label: 'Web & automation', description: 'Search, browsers, websites, and workflows.', capabilities: ['web'] },
  { id: 'media-generation', label: 'Media generation', description: 'Images, video, audio, models, and LoRAs.', capabilities: ['media'] },
  { id: 'design-diagrams', label: 'Design & diagrams', description: 'Design files, canvases, slides, and diagrams.', capabilities: ['documents', 'media'] },
  { id: 'communication', label: 'Communication', description: 'Email, chat, contacts, and team workspaces.', capabilities: ['email'] },
  { id: 'calendar-productivity', label: 'Calendar & productivity', description: 'Events, tasks, projects, and scheduling.', capabilities: ['calendar', 'project-management'] },
  { id: 'analytics-monitoring', label: 'Analytics & monitoring', description: 'Product analytics, logs, errors, and reports.', capabilities: ['analytics'] },
  { id: 'security-local', label: 'Security & local runtime', description: 'Scanning, secrets, local tools, and controlled execution.', capabilities: ['code', 'files'] },
]

const cloud = (name: string, capabilities: PluginCapability[], description: string, transport: PluginTransport = 'oauth', adapterId?: string): PluginManifest => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  name,
  publisher: name,
  description,
  transport,
  capabilities,
  scopes: capabilities,
  connectionState: 'available',
  ...(adapterId ? { adapterId } : {}),
})

const local = (name: string, capabilities: PluginCapability[], description: string): PluginManifest =>
  cloud(name, capabilities, description, 'stdio')

/** Seed catalog. It is metadata only; it does not install or connect anything. */
export const PLUGIN_CATALOG: PluginManifest[] = [
  local('Local workspace files', ['files', 'documents'], 'Read and write files inside the approved Lazarus workspace.'),
  local('Windows file picker', ['files'], 'Choose files through the native desktop picker.'),
  local('Android shared storage', ['files'], 'Choose files shared with Lazarus on Android.'),
  local('PDF text and table extraction', ['documents'], 'Extract text and tables from PDFs.'),
  local('PDF OCR', ['documents'], 'Extract text from scanned PDFs.'),
  local('DOCX reading and editing', ['documents'], 'Read and update Word documents.'),
  local('XLSX workbook analysis', ['documents', 'analytics'], 'Inspect and analyze spreadsheet workbooks.'),
  local('PPTX slide extraction', ['documents'], 'Read presentation text and structure.'),
  local('Markdown and text search', ['files', 'documents'], 'Search local notes and source text.'),
  local('ZIP inspection', ['files'], 'Inspect archives without extracting unsafe executables.'),
  cloud('Google Drive', ['files', 'documents'], 'Search and retrieve Drive, Docs, Sheets, and Slides files.', 'oauth', 'google-drive'),
  cloud('Google Docs', ['documents'], 'Read and edit Google Docs with confirmation for writes.', 'api-key', 'google-docs'),
  cloud('Google Sheets', ['documents', 'analytics'], 'Read and update Google Sheets.', 'api-key', 'google-sheets'),
  cloud('Google Slides', ['documents'], 'Read and update Google Slides.', 'api-key', 'google-slides'),
  cloud('Dropbox', ['files', 'documents'], 'Search, retrieve, and save Dropbox files.', 'api-key', 'dropbox'),
  cloud('OneDrive', ['files', 'documents'], 'Access files in Microsoft OneDrive.', 'api-key', 'onedrive'),
  cloud('SharePoint', ['files', 'documents'], 'Search approved SharePoint sites and documents.', 'api-key', 'sharepoint'),
  cloud('Box', ['files', 'documents'], 'Search and retrieve Box content.', 'api-key', 'box'),
  cloud('Notion', ['documents', 'project-management'], 'Search and update Notion pages and databases.', 'api-key', 'notion'),
  cloud('Coda', ['documents', 'project-management'], 'Read docs and update Coda tables.', 'api-key', 'coda'),
  cloud('GitHub', ['code', 'project-management'], 'Inspect repositories, issues, pull requests, and CI.', 'oauth', 'github'),
  cloud('GitHub Actions', ['code'], 'Read workflow runs and logs.', 'api-key', 'github-actions'),
  cloud('GitLab', ['code', 'project-management'], 'Inspect repositories, issues, and pipelines.', 'api-key', 'gitlab'),
  cloud('Bitbucket', ['code', 'project-management'], 'Inspect repositories and pull requests.', 'api-key', 'bitbucket'),
  cloud('Jira', ['project-management'], 'Search and update Jira issues with confirmation.', 'api-key', 'jira'),
  cloud('Confluence', ['documents', 'project-management'], 'Search and update Confluence pages.', 'api-key', 'confluence'),
  cloud('Linear', ['project-management'], 'Search and update Linear issues and projects.', 'api-key', 'linear'),
  cloud('Trello', ['project-management'], 'Manage boards, cards, and checklists.', 'api-key', 'trello'),
  cloud('ClickUp', ['project-management', 'documents'], 'Manage tasks, docs, and comments.', 'api-key', 'clickup'),
  cloud('Asana', ['project-management'], 'Read and update Asana projects and tasks.', 'api-key', 'asana'),
  cloud('monday.com', ['project-management'], 'Read and update boards and items.', 'api-key', 'monday-com'),
  cloud('Slack', ['email', 'project-management'], 'Search channels and draft messages.', 'api-key', 'slack'),
  cloud('Microsoft Teams', ['email', 'project-management'], 'Search team conversations and files.', 'api-key', 'microsoft-teams'),
  cloud('Gmail', ['email', 'documents'], 'Search mail and create drafts.', 'api-key', 'gmail'),
  cloud('Outlook Email', ['email', 'documents'], 'Search mail and create drafts.', 'api-key', 'outlook-email'),
  cloud('Google Calendar', ['calendar'], 'Read availability and manage events with confirmation.', 'api-key', 'google-calendar'),
  cloud('Outlook Calendar', ['calendar'], 'Read availability and manage events with confirmation.', 'api-key', 'outlook-calendar'),
  cloud('Google Contacts', ['email'], 'Find contacts and contact details.', 'api-key', 'google-contacts'),
  cloud('Zoom', ['documents', 'calendar'], 'Find meeting recordings and summaries.', 'api-key', 'zoom'),
  local('Python', ['code', 'analytics'], 'Run approved Python tasks in a sandboxed workspace.'),
  local('Jupyter notebooks', ['code', 'analytics'], 'Inspect and run notebook cells with confirmation.'),
  local('Node.js', ['code'], 'Run approved JavaScript tasks in a sandboxed workspace.'),
  local('PowerShell', ['code'], 'Run approved Windows commands with confirmation.'),
  local('Git', ['code'], 'Inspect branches, diffs, and history.'),
  local('SQLite', ['database', 'analytics'], 'Query local SQLite databases.'),
  cloud('PostgreSQL', ['database', 'analytics'], 'Query an approved PostgreSQL endpoint.', 'streamable-http'),
  cloud('Supabase', ['database'], 'Read rows from a known table using a publishable key and your project’s row-level security policies.', 'api-key', 'supabase'),
  cloud('Neon', ['database', 'code'], 'Manage Neon Postgres projects and branches.', 'api-key', 'neon'),
  cloud('BigQuery', ['database', 'analytics'], 'Run scoped BigQuery queries.', 'api-key', 'bigquery'),
  local('DuckDB', ['database', 'analytics'], 'Analyze local data files with DuckDB.'),
  cloud('Redis', ['database'], 'Inspect approved Redis data.', 'streamable-http'),
  cloud('Airtable', ['database', 'project-management'], 'Read and update Airtable bases.', 'api-key', 'airtable'),
  cloud('Stripe', ['database', 'analytics'], 'Inspect Stripe test data and reports.', 'api-key', 'stripe'),
  cloud('Shopify', ['project-management', 'analytics'], 'Manage products, orders, and store data.', 'api-key', 'shopify'),
  cloud('HubSpot', ['project-management', 'analytics'], 'Search CRM records and draft updates.', 'api-key', 'hubspot'),
  cloud('Salesforce', ['project-management', 'analytics'], 'Search and update authorized CRM records.', 'api-key', 'salesforce'),
  cloud('Zoho CRM', ['project-management', 'analytics'], 'Search and update CRM records.', 'api-key', 'zoho-crm'),
  cloud('Web search', ['web'], 'Search the web and return cited sources.', 'api-key', 'web-search'),
  cloud('Tavily', ['web'], 'Search and extract current web content.', 'api-key', 'tavily'),
  cloud('Exa', ['web', 'code'], 'Search technical documents, code, and research.', 'api-key', 'exa'),
  cloud('Firecrawl', ['web', 'documents'], 'Extract clean content from web pages.', 'api-key', 'firecrawl'),
  cloud('Browser automation', ['web'], 'Automate approved browser tasks.', 'api-key', 'browser-automation'),
  local('Screenshot and desktop control', ['files'], 'Capture or interact with the approved desktop.',),
  local('Ollama', ['code', 'media'], 'Use local Ollama models.'),
  local('LM Studio', ['code', 'media'], 'Use local LM Studio models.'),
  local('ComfyUI', ['media'], 'Run local image and video workflows.'),
  cloud('Hugging Face', ['code', 'media'], 'Search models and datasets.', 'api-key', 'hugging-face'),
  cloud('Civitai', ['media'], 'Search models and LoRAs with compatibility metadata.', 'api-key', 'civitai'),
  local('LoRA compatibility filtering', ['media'], 'Filter downloads against installed model bases.'),
  local('Image generation', ['media'], 'Generate images using configured local providers.'),
  local('Image editing', ['media'], 'Edit images using configured local providers.'),
  local('Image upscaling', ['media'], 'Upscale images using local tools.'),
  local('Video generation', ['media'], 'Generate video using configured local providers.'),
  local('Image-to-video', ['media'], 'Animate an image with a configured provider.'),
  local('Audio transcription', ['media'], 'Transcribe audio locally.'),
  local('Text-to-speech', ['media'], 'Synthesize speech locally.'),
  local('Voice cloning', ['media'], 'Use consented voice assets in local workflows.'),
  cloud('Figma', ['documents', 'media'], 'Inspect designs and send implementation work back to Figma.', 'api-key', 'figma'),
  cloud('Canva', ['documents', 'media'], 'Create and edit designs.', 'api-key', 'canva'),
  cloud('Miro', ['documents', 'media', 'project-management'], 'Read and create boards, diagrams, and canvases.', 'api-key', 'miro'),
  local('Mermaid diagrams', ['documents'], 'Render diagrams from text.'),
  cloud('tldraw', ['documents', 'media'], 'Create editable diagrams and canvases.', 'api-key', 'tldraw'),
  cloud('Gamma', ['documents', 'media'], 'Create presentations and documents.', 'api-key', 'gamma'),
  cloud('WordPress', ['documents'], 'Draft and publish WordPress content with confirmation.', 'api-key', 'wordpress'),
  cloud('Webflow', ['documents', 'project-management'], 'Manage Webflow sites and CMS content.', 'api-key', 'webflow'),
  cloud('Vercel', ['code'], 'Inspect and deploy approved projects.', 'api-key', 'vercel'),
  cloud('Railway', ['code', 'database'], 'Deploy and troubleshoot services.', 'api-key', 'railway'),
  cloud('Render', ['code', 'database'], 'Deploy and inspect services.', 'api-key', 'render'),
  cloud('DigitalOcean', ['code'], 'Manage approved remote workspaces.', 'api-key', 'digitalocean'),
  cloud('Datadog', ['analytics', 'code'], 'Inspect logs, traces, and monitors.', 'api-key', 'datadog'),
  cloud('PostHog', ['analytics', 'database'], 'Inspect analytics, flags, and errors.', 'api-key', 'posthog'),
  cloud('Amplitude', ['analytics'], 'Query product analytics.', 'api-key', 'amplitude'),
  cloud('Sentry', ['analytics', 'code'], 'Inspect application errors and traces.', 'api-key', 'sentry'),
  local('Semgrep code scanning', ['code'], 'Scan source code for security issues.'),
  local('Secret scanning', ['code'], 'Detect credentials before files leave the device.'),
  local('Dependency vulnerability scanning', ['code'], 'Audit package dependencies.'),
  cloud('Calendly', ['calendar'], 'Create scheduling links and manage events.', 'api-key', 'calendly'),
  cloud('Resend', ['email'], 'Send transactional email after confirmation.', 'api-key', 'resend'),
  cloud('Zapier', ['project-management', 'web'], 'Connect approved services through scoped automation workflows.', 'api-key', 'zapier'),
  cloud('Generic REST API', ['web'], 'Connect an approved HTTP API through a scoped manifest.', 'streamable-http'),
]

export const FEATURED_PLUGIN_IDS = ['google-drive', 'github', 'supabase', 'notion', 'figma', 'gmail', 'google-calendar', 'python', 'comfyui', 'generic-rest-api']

for (const plugin of PLUGIN_CATALOG) {
  if (plugin.id === 'google-drive' || plugin.id === 'github' || plugin.id === 'supabase') {
    plugin.adapterId = plugin.id
  }
  if (plugin.id === 'github' || plugin.id === 'supabase') plugin.transport = 'api-key'
}
