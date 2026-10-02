/**
 * Compatibility tombstone for the removed hosted provider. Existing persisted
 * profiles can still contain its provider ID, so any stale direct construction
 * must fail without reading credentials or attempting network access.
 */

import type {
  ProviderClient,
  ProviderModel,
  ChatStreamChunk,
} from './types'
import { ProviderError } from './types'

const removed = () => new ProviderError(
  'Hosted services are not included in Lazarus.',
  'lu-cloud',
  'retired',
  410,
)

export class RetiredHostedProvider implements ProviderClient {
  readonly id = 'lu-cloud' as const

  async *chatStream(): AsyncGenerator<ChatStreamChunk> {
    throw removed()
  }

  async chatWithTools(): Promise<Awaited<ReturnType<ProviderClient['chatWithTools']>>> {
    throw removed()
  }

  async listModels(): Promise<ProviderModel[]> {
    return []
  }

  async checkConnection(): Promise<boolean> {
    return false
  }

  async getContextLength(): Promise<number> {
    throw removed()
  }
}
