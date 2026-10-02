import type { MCPToolDefinition, ToolArgs } from '../../mcp/types'

export interface ProviderCredentials {
  /** OAuth access token, held in memory for the current app session only. */
  accessToken?: string
  /** Google OAuth refresh data. All values stay in memory for this app session. */
  refreshToken?: string
  accessTokenExpiresAt?: number
  clientId?: string
  /** API key for providers that do not support OAuth. Keep this in memory only. */
  apiKey?: string
  baseUrl?: string
  projectRef?: string
}

export interface ProviderConnection {
  providerId: string
  tools: MCPToolDefinition[]
  /** Verifies the credential against the remote service before tools go live. */
  verify: () => Promise<void>
  call: (toolName: string, args: ToolArgs) => Promise<string>
  disconnect: () => Promise<void>
}

export interface ProviderAdapter {
  providerId: string
  displayName: string
  transport: 'oauth' | 'api-key' | 'streamable-http'
  connect: (credentials: ProviderCredentials) => Promise<ProviderConnection>
}
