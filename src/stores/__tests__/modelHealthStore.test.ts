import { describe, it, expect, beforeEach } from 'vitest'
import { useModelHealthStore } from '../modelHealthStore'

describe('useModelHealthStore', () => {
  beforeEach(() => {
    useModelHealthStore.getState().reset()
  })

  it('setStaleModels records models + advances lastScanTime + clears dismissed', () => {
    // Arrange: user had dismissed a previous banner
    useModelHealthStore.setState({ dismissed: true, lastScanTime: 100 })

    useModelHealthStore.getState().setStaleModels(['phi4:14b', 'hermes3:8b'])

    const s = useModelHealthStore.getState()
    expect(s.staleModels).toEqual(['phi4:14b', 'hermes3:8b'])
    expect(s.lastScanTime).toBeGreaterThan(100)
    // A new scan finding stale models must re-show the banner.
    expect(s.dismissed).toBe(false)
  })

  it('markFresh removes a single model from the stale list', () => {
    useModelHealthStore.setState({
      staleModels: ['phi4:14b', 'hermes3:8b', 'dolphin3:8b'],
    })
    useModelHealthStore.getState().markFresh('hermes3:8b')
    expect(useModelHealthStore.getState().staleModels).toEqual(['phi4:14b', 'dolphin3:8b'])
  })

  it('markFresh is a no-op if model was not stale', () => {
    useModelHealthStore.setState({ staleModels: ['phi4:14b'] })
    useModelHealthStore.getState().markFresh('never-installed:7b')
    expect(useModelHealthStore.getState().staleModels).toEqual(['phi4:14b'])
  })

  it('dismiss hides the banner without clearing stale models', () => {
    useModelHealthStore.setState({ staleModels: ['phi4:14b'] })
    useModelHealthStore.getState().dismiss()
    const s = useModelHealthStore.getState()
    expect(s.dismissed).toBe(true)
    expect(s.staleModels).toEqual(['phi4:14b'])
  })

  it('setScanning tracks concurrent scan state', () => {
    expect(useModelHealthStore.getState().scanning).toBe(false)
    useModelHealthStore.getState().setScanning(true)
    expect(useModelHealthStore.getState().scanning).toBe(true)
    useModelHealthStore.getState().setScanning(false)
    expect(useModelHealthStore.getState().scanning).toBe(false)
  })

  it('reset clears everything back to initial state', () => {
    useModelHealthStore.setState({
      staleModels: ['phi4:14b'],
      scanning: true,
      dismissed: true,
      lastScanTime: 12345,
    })
    useModelHealthStore.getState().reset()
    const s = useModelHealthStore.getState()
    expect(s.staleModels).toEqual([])
    expect(s.scanning).toBe(false)
    expect(s.dismissed).toBe(false)
    expect(s.lastScanTime).toBe(0)
  })
})

/**
 * R2-40: der Hinweis kam zurueck, obwohl die Beschriftung das ausschliesst.
 *
 * `same` verglich nur Laenge und Enthaltensein, fiel also bei jeder
 * Laengenaenderung, auch beim SCHRUMPFEN. Wer ein veraltetes Modell
 * aktualisierte, bekam den eben weggeklickten Hinweis fuer die uebrigen
 * sofort wieder. Die Beschriftung ist neu in 3.0.0 und verspricht das
 * Gegenteil: "Dismiss. It comes back only when a different model goes stale."
 */
describe('R2-40: weggeklickt bleibt weggeklickt, bis wirklich eines dazukommt', () => {
  beforeEach(() => useModelHealthStore.getState().reset())

  it('ein aktualisiertes Modell holt den Hinweis nicht zurueck', () => {
    useModelHealthStore.getState().setStaleModels(['phi4:14b', 'hermes3:8b'])
    useModelHealthStore.getState().dismiss()
    useModelHealthStore.getState().setStaleModels(['phi4:14b'])
    expect(useModelHealthStore.getState().dismissed).toBe(true)
  })

  it('und auch die leere Liste nicht', () => {
    useModelHealthStore.getState().setStaleModels(['phi4:14b'])
    useModelHealthStore.getState().dismiss()
    useModelHealthStore.getState().setStaleModels([])
    expect(useModelHealthStore.getState().dismissed).toBe(true)
  })

  it('NEGATIVKONTROLLE: ein wirklich neues veraltetes Modell holt ihn zurueck', () => {
    useModelHealthStore.getState().setStaleModels(['phi4:14b'])
    useModelHealthStore.getState().dismiss()
    useModelHealthStore.getState().setStaleModels(['phi4:14b', 'qwen3:32b'])
    expect(useModelHealthStore.getState().dismissed).toBe(false)
  })

  it('NEGATIVKONTROLLE: ein Tausch bei gleicher Laenge holt ihn auch zurueck', () => {
    useModelHealthStore.getState().setStaleModels(['phi4:14b'])
    useModelHealthStore.getState().dismiss()
    useModelHealthStore.getState().setStaleModels(['qwen3:32b'])
    expect(useModelHealthStore.getState().dismissed).toBe(false)
  })
})
