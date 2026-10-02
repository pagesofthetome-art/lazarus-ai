/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { PermissionSettings } from '../PermissionSettings'

afterEach(cleanup)

describe('database integration permissions', () => {
  it('shows users a dedicated setting for connected database tools', () => {
    render(createElement(PermissionSettings))
    expect(screen.getByText('Database Access')).toBeTruthy()
    expect(screen.getByText(/Supabase read-only queries/)).toBeTruthy()
  })
})
