import type { MCPToolDefinition, ToolArgs } from '../../mcp/types'
import { providerJson, providerText, requireCredential, stringArg } from './http'
import type { ProviderAdapter, ProviderCredentials, ProviderConnection } from './types'

const tools: MCPToolDefinition[] = [
  {
    name: 'google_drive_search',
    description: 'Search the connected Google Drive account with a Drive API query such as fullText contains \'report\'. Read-only.',
    category: 'filesystem', source: 'external', serverId: 'plugin:google-drive',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Drive fullText search expression' }, pageSize: { type: 'number', minimum: 1, maximum: 50, default: 10 } }, required: ['query'] },
  },
  {
    name: 'google_drive_get_file',
    description: 'Read file metadata and, for supported text formats, bounded text content from Google Drive. Read-only.',
    category: 'filesystem', source: 'external', serverId: 'plugin:google-drive',
    inputSchema: { type: 'object', properties: { fileId: { type: 'string', description: 'Google Drive file ID' }, exportMimeType: { type: 'string', description: 'Optional export MIME type for Docs, Sheets, or Slides' } }, required: ['fileId'] },
  },
]

type DriveFile = { id: string; name?: string; mimeType?: string; webViewLink?: string; modifiedTime?: string; size?: string }
const WORKSPACE_TYPES = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
])

function defaultExportType(mimeType = ''): string {
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'text/csv'
  return 'text/plain'
}

export const googleDriveAdapter: ProviderAdapter = {
  providerId: 'google-drive', displayName: 'Google Drive', transport: 'oauth',
  async connect(credentials: ProviderCredentials): Promise<ProviderConnection> {
    requireCredential(credentials, 'Google Drive')
    let accessToken = credentials.accessToken!
    let expiresAt = credentials.accessTokenExpiresAt
    const token = async () => {
      if (expiresAt && Date.now() >= expiresAt - 60_000 && credentials.refreshToken) {
        if (!credentials.clientId) throw new Error('Google OAuth client ID is missing; reconnect Google Drive.')
        const response = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: credentials.clientId,
            refresh_token: credentials.refreshToken,
            grant_type: 'refresh_token',
          }),
        })
        if (!response.ok) throw new Error(`Google access token refresh failed (${response.status}); reconnect Google Drive.`)
        const refreshed = await response.json() as { access_token?: string; expires_in?: number }
        if (!refreshed.access_token) throw new Error('Google token refresh returned no access token; reconnect Google Drive.')
        accessToken = refreshed.access_token
        expiresAt = Date.now() + Math.max(60, refreshed.expires_in ?? 3600) * 1000
      }
      return accessToken
    }
    const googleJson = <T,>(url: string) => token().then((accessTokenNow) => providerJson<T>(url, {
      headers: { Authorization: `Bearer ${accessTokenNow}` },
    }, {}))
    const googleText = (url: string) => token().then((accessTokenNow) => providerText(url, {
      headers: { Authorization: `Bearer ${accessTokenNow}` },
    }))
    return {
      providerId: 'google-drive', tools,
      async verify() {
        await googleJson('https://www.googleapis.com/drive/v3/about?fields=user')
      },
      async call(toolName: string, args: ToolArgs) {
        if (toolName === 'google_drive_search') {
          const pageSize = Math.min(50, Math.max(1, Number(args.pageSize) || 10))
          const params = new URLSearchParams({
            q: stringArg(args, 'query'),
            pageSize: String(pageSize),
            fields: 'files(id,name,mimeType,webViewLink,modifiedTime,size,capabilities(canDownload))',
          })
          const data = await googleJson<{ files?: DriveFile[] }>(`https://www.googleapis.com/drive/v3/files?${params}`)
          return JSON.stringify(data.files ?? [])
        }
        if (toolName === 'google_drive_get_file') {
          const fileId = encodeURIComponent(stringArg(args, 'fileId'))
          const meta = await googleJson<DriveFile>(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,webViewLink,modifiedTime,size,capabilities(canDownload)`)
          if (WORKSPACE_TYPES.has(meta.mimeType ?? '')) {
            const mimeType = stringArg(args, 'exportMimeType', defaultExportType(meta.mimeType))
            const exported = await googleText(`https://www.googleapis.com/drive/v3/files/${fileId}/export?${new URLSearchParams({ mimeType })}`)
            return JSON.stringify({ metadata: meta, contentType: exported.contentType, content: exported.text, truncated: exported.truncated })
          }
          if ((meta.mimeType ?? '').startsWith('text/')) {
            const downloaded = await googleText(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`)
            return JSON.stringify({ metadata: meta, contentType: downloaded.contentType, content: downloaded.text, truncated: downloaded.truncated })
          }
          return JSON.stringify({ metadata: meta, note: 'This file is not a text document. Lazarus returned its metadata without downloading binary contents.' })
        }
        throw new Error(`Unknown Google Drive tool: ${toolName}`)
      },
      async disconnect() {},
    }
  },
}
