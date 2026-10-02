// Compatibility surface for persisted cloud-era data and types. Lazarus does
// not ship the former hosted service; requests fail closed before networking.

export class CloudJobError extends Error {
  readonly status: number
  /** The server's machine-readable reason (`code` next to `error` in the
   *  body), when it sent one. The status alone is ambiguous where it matters
   *  most: retired hosted service answers 429 for the per-user burst guard, for an upstream
   *  provider throttle AND for an empty wallet, and only the last of those is
   *  something the user can act on by paying. */
  readonly code?: string
  /** What `retry-after` asked for, in ms, the burst guard's window is fixed
   *  and up to a minute long, so the number is worth showing. */
  readonly retryAfterMs?: number
  constructor(
    message: string,
    status: number,
    meta?: { code?: string; retryAfterMs?: number; cause?: unknown },
  ) {
    // Opus-Review Nachbesserung 7 (3.0.1, D2): the reworded network-failure
    // message below intentionally loses the engine's own text, `cause`
    // keeps it reachable for a log line without putting it back in front of
    // the customer. `super(message)` alone (no options) when nothing is
    // passed, matching every existing call site's behavior exactly.
    super(message, meta && 'cause' in meta ? { cause: meta.cause } : undefined)
    this.name = 'CloudJobError'
    this.status = status
    this.code = meta?.code
    this.retryAfterMs = meta?.retryAfterMs
  }
}

function parseRetryAfter(res: Response): number | undefined {
  const value = res.headers.get('retry-after')
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

export async function jsonOrError<T>(res: Response): Promise<T> {
  // Read as text rather than json() so a body that never finished arriving is
  // distinguishable from one that legitimately has nothing in it. A torn read
  // used to fall into the same `{}` as a 204, which handed submitCloudJob an
  // undefined job id and left the run polling a job that never existed.
  let truncated = false
  const raw = await res.text().catch(() => {
    truncated = true
    return ''
  })
  let body: unknown = {}
  let unparseable = false
  if (raw.trim()) {
    try {
      body = JSON.parse(raw)
    } catch {
      unparseable = true
    }
  }
  if (!res.ok) {
    const b = body as { error?: unknown; code?: unknown }
    const msg = typeof b.error === 'string' ? b.error : `request failed (${res.status})`
    throw new CloudJobError(msg, res.status, {
      code: typeof b.code === 'string' ? b.code : undefined,
      retryAfterMs: parseRetryAfter(res),
    })
  }
  if (truncated || unparseable) {
    throw new CloudJobError(`the server's answer arrived incomplete (${res.status})`, res.status)
  }
  return body as T
}

export interface CloudFetchInit extends RequestInit {
  /** Overrides the size-derived deadline for this one request. */
  timeoutMs?: number
}

export async function cloudFetch(path: string, init: CloudFetchInit = {}): Promise<Response> {
  void path
  void init
  throw new CloudJobError('Hosted services are not included in Lazarus.', 410)
}
