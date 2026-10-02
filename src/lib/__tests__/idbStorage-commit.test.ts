import { expect, it } from 'vitest'
import { compareAndSetIdbItem } from '../idbStorage'

it('refuses an unconfirmed localStorage fallback when IndexedDB is unavailable', async () => {
  await expect(compareAndSetIdbItem('memory-proof', null, 'private fixture', () => true))
    .rejects.toThrow('Could not commit synchronized memory storage')
})
