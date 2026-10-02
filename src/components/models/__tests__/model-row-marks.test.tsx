// @vitest-environment jsdom
/**
 * Die Marken sagen in beiden Apps dasselbe: unzensiert nur gemessen und nur
 * ganz, die Freimenge nur fuer ein Konto, das dafuer zahlt.
 *
 * R5-17: die Zeile zeichnete die Freimengenmarke ohne jede Kontoabfrage. Der
 * Server liefert `flash` an JEDES Konto mit Cloud, abgerechnet wird aber nach
 * `accountPlanPays`. Ein Starter-Konto, das nie gezahlt hat, las damit eine
 * Zusage und bekam die Rechnung.
 */
import { describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ModelRowMarks } from '../ModelRowMarks'

describe('ModelRowMarks', () => {
  it('marks a measured, fully unfiltered model regardless of the plan', () => {
    render(<ModelRowMarks model={{ unfiltered: 'full' }} />)
    expect(screen.getByText('No refusals')).toBeTruthy()
  })

  // K12 (3.0.1): the Discord report was "can't find it", not "it's wrong",
  // plain text at the smallest size on a crowded row, no icon at all. An
  // icon is the cheapest signal that survives a quick scan of the list; the
  // text itself and the typography ladder step stay unchanged (see the
  // comment on the mark in ModelRowMarks.tsx).
  it('carries a findable icon, not just plain text (K12)', () => {
    render(<ModelRowMarks model={{ unfiltered: 'full' }} />)
    const mark = screen.getByText('No refusals').closest('[data-mark="unfiltered"]')
    expect(mark?.querySelector('svg')).toBeTruthy()
  })

  it('stays silent on partial and on a model with nothing measured', () => {
    for (const unfiltered of ['partial', undefined] as const) {
      cleanup()
      render(<ModelRowMarks model={{ unfiltered }} />)
      expect(screen.queryByText('No refusals')).toBeNull()
    }
  })

  it('shows no account or billing badge for provider-supplied metadata', () => {
    render(<ModelRowMarks model={{ unfiltered: 'full' }} />)
    expect(screen.queryByText(/credits|plan|flash/i)).toBeNull()
    expect(screen.getByText('No refusals')).toBeTruthy()
  })
})
