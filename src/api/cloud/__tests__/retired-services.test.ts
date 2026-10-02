import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudFetch } from '../client'
import { withMemorySyncSession } from '../memory-sync'
import { supabaseCloud } from '../supabase'

afterEach(() => vi.unstubAllGlobals())

describe('retired account and hosted services', () => {
  it('rejects before any fetch or account SDK call can run', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(cloudFetch('/api/jobs/catalog')).rejects.toMatchObject({ status: 410 })
    await expect(withMemorySyncSession('user', async () => 'unexpected')).rejects.toThrow(/not included in Lazarus/)

    const session = await supabaseCloud().auth.getSession()
    expect(session.data.session).toBeNull()
    expect(session.error.message).toMatch(/not included in Lazarus/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
