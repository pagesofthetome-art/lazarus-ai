import { describe, expect, it } from 'vitest'
import { createDeveloperSession, rotateBackupNames, transitionDeveloperSession } from '../developer-sandbox'

describe('developer sandbox session', () => {
  it('starts with models unloaded and a staging workspace', () => {
    const session = createDeveloperSession('workspace-1', 'backup-1')
    expect(session.status).toBe('starting')
    expect(session.modelsLoaded).toEqual([])
    expect(session.workspaceRoot).toBe('workspace-1')
    expect(session.backupName).toBe('backup-1')
  })

  it('keeps only the two newest backup names', () => {
    expect(rotateBackupNames(['old', 'older', 'newest'], 2)).toEqual(['older', 'newest'])
  })

  it('allows the session to become ready, apply, or discard', () => {
    const session = createDeveloperSession('workspace-1', 'backup-1')
    expect(transitionDeveloperSession(session, 'ready').status).toBe('ready')
    expect(transitionDeveloperSession(session, 'applying').status).toBe('applying')
    expect(transitionDeveloperSession(session, 'discarding').status).toBe('discarding')
  })
})
