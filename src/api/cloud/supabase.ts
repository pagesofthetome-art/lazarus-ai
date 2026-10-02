/** Fail-closed compatibility surface for profiles from older Lazarus builds. */

const REMOVED = 'Hosted account services are not included in Lazarus.'

type LegacySession = {
  access_token: string
  user: { id: string; email?: string | null }
}

class DisabledQuery {
  select(_columns: string): this { return this }
  eq(_column: string, _value: string): this { return this }
  abortSignal(_signal: AbortSignal): this { return this }
  async maybeSingle(): Promise<{ data: null; error: Error }> {
    return { data: null, error: new Error(REMOVED) }
  }
}

/** No SDK, stored credentials, or network client is created by this function. */
export function supabaseCloud() {
  const retired = () => new Error(REMOVED)
  return {
    auth: {
      async getSession(): Promise<{ data: { session: LegacySession | null }; error: Error }> {
        return { data: { session: null }, error: retired() }
      },
      async getUser(_token?: string): Promise<{ data: { user: { id: string } | null }; error: Error }> {
        return { data: { user: null }, error: retired() }
      },
      async signOut(): Promise<{ error: Error }> { return { error: retired() } },
      async signInWithPassword(_credentials: { email: string; password: string }): Promise<{ error: Error }> {
        return { error: retired() }
      },
      async signUp(_credentials: { email: string; password: string }): Promise<{ error: Error }> {
        return { error: retired() }
      },
      onAuthStateChange(_callback: (event: string, session: LegacySession | null) => void) {
        return { data: { subscription: { unsubscribe() {} } } }
      },
    },
    from(_table: string) { return new DisabledQuery() },
  }
}

export async function loginWithProvider(_provider: string): Promise<void> {
  throw new Error(REMOVED)
}

export async function exchangeCodeForSession(_code: string): Promise<void> {
  throw new Error(REMOVED)
}
