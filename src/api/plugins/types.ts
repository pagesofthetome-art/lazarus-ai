/** Provider-neutral plugin metadata. Secrets and access tokens never belong here. */
export type PluginTransport = 'stdio' | 'streamable-http' | 'oauth' | 'api-key'

export type PluginCapability =
  | 'files'
  | 'documents'
  | 'code'
  | 'database'
  | 'web'
  | 'media'
  | 'calendar'
  | 'email'
  | 'project-management'
  | 'analytics'

export type PluginConnectionState = 'available' | 'configured' | 'connected' | 'error'
export type PluginPermission = 'blocked' | 'confirm' | 'auto'

export interface PluginManifest {
  id: string
  name: string
  publisher: string
  description: string
  transport: PluginTransport
  capabilities: PluginCapability[]
  scopes: string[]
  connectionState: PluginConnectionState
  /** Set only when Lazarus has a real adapter for this provider. */
  adapterId?: string
}

export interface InstalledPlugin {
  manifestId: string
  enabled: boolean
  permission: PluginPermission
  configuredAt: string
  connectedAt?: string
}
