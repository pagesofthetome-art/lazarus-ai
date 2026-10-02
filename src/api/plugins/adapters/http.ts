import type { ProviderCredentials } from './types'

export async function providerJson<T>(url: string, init: RequestInit = {}, credentials: ProviderCredentials = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (credentials.accessToken) headers.set('Authorization', `Bearer ${credentials.accessToken}`)
  else if (credentials.apiKey) headers.set('Authorization', `Bearer ${credentials.apiKey}`)
  const response = await fetch(url, { ...init, headers })
  if (!response.ok) {
    // Do not include response bodies: providers sometimes echo tokens or query data.
    throw new Error(`Provider request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

/** Read a bounded amount of provider text so a single tool result cannot load a huge file into memory. */
export async function providerText(
  url: string,
  init: RequestInit = {},
  maxBytes = 96 * 1024,
): Promise<{ text: string; truncated: boolean; contentType: string }> {
  const headers = new Headers(init.headers)
  headers.set('Accept', '*/*')
  const response = await fetch(url, { ...init, headers })
  if (!response.ok) throw new Error(`Provider request failed (${response.status})`)
  const reader = response.body?.getReader()
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer())
    const truncated = buffer.byteLength > maxBytes
    return {
      text: new TextDecoder().decode(buffer.subarray(0, maxBytes)),
      truncated,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
    }
  }

  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  let truncated = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = maxBytes - total
      if (value.byteLength > remaining) {
        text += decoder.decode(value.subarray(0, Math.max(0, remaining)), { stream: true })
        total = maxBytes
        truncated = true
        await reader.cancel()
        break
      }
      total += value.byteLength
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  return {
    text,
    truncated,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  }
}

export function requireCredential(credentials: ProviderCredentials, name: string): string {
  const token = credentials.accessToken || credentials.apiKey
  if (!token) throw new Error(`${name} is not connected. Add credentials in Plugins first.`)
  return token
}

export function stringArg(args: Record<string, unknown>, key: string, fallback = ''): string {
  return typeof args[key] === 'string' ? args[key] as string : fallback
}
