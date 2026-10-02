/**
 * Auftrag: Qwen 3.5 9B in ONBOARDING_MODELS. Die Empfehlung soll auf
 * Hardware, die 9B traegt, auf 9B wechseln, sonst beim 7B-Starter bleiben.
 *
 * Wiederverwendet ist die Schwelle, die es in ModelsStep.tsx schon gibt:
 * `systemVRAM >= model.vramGB`, dieselbe Zahl, die dort die "may not
 * fit"-Warnung treibt. Keine neue Schwelle, nur derselbe Vergleich an einer
 * zweiten Stelle gelesen.
 *
 * 9B braucht laut Messung (lu-301/STAND-BAU.md:258, RTX 3060, 32/32
 * Schichten auf GPU) 6,1 GB, nicht die zuvor erfundenen 8. Opus-Runde 1 hat
 * das zurueckgewiesen (review-onboard9b.md, Blocker 1). Die Zahlen unten
 * sind entsprechend nachgezogen.
 *
 * Lauf: npx vitest run src/lib/__tests__/onboarding-hardware-recommendation.test.ts
 */
import { describe, it, expect } from 'vitest'
import { ONBOARDING_MODELS, recommendedOnboardingModelName, strongestOnboardingModelName } from '../constants'

describe('recommendedOnboardingModelName', () => {
  const SIEBEN_B = 'qwen2.5-7b'
  const NEUN_B = 'qwen3.5-9b'
  const NEUN_B_VRAM = ONBOARDING_MODELS.find(m => m.name === NEUN_B)!.vramGB

  it('unbekannte Hardware (null) laesst den statisch markierten 7B-Starter stehen', () => {
    expect(recommendedOnboardingModelName(ONBOARDING_MODELS, null)).toBe(SIEBEN_B)
  })

  it('eine RTX 3060 mit 12 GB, die Hardware aus dem Auftrag, empfiehlt 9B', () => {
    expect(recommendedOnboardingModelName(ONBOARDING_MODELS, 12)).toBe(NEUN_B)
  })

  it('genau die gemessenen 6,1 GB, die 9B selbst verlangt, empfehlen bereits 9B', () => {
    expect(recommendedOnboardingModelName(ONBOARDING_MODELS, NEUN_B_VRAM)).toBe(NEUN_B)
  })

  // Negativkontrolle mit Zahlen: 6 GB traegt den 7B-Starter (Bedarf 6), aber
  // nicht 9B (Bedarf 6,1, knapp darueber, aber darueber). Ohne diese Zeile
  // koennte eine Funktion, die immer NEUN_B zurueckgibt, die 12-GB- und die
  // 6,1-GB-Zusicherung auch bestehen.
  it('6 GB traegt den 7B-Starter, aber nicht das gemessene 9B, und empfiehlt darum 7B', () => {
    expect(recommendedOnboardingModelName(ONBOARDING_MODELS, 6)).toBe(SIEBEN_B)
  })

  it('0 GB (Sonde fehlgeschlagen, aber nicht null) traegt keinen der beiden und faellt auf 7B zurueck', () => {
    expect(recommendedOnboardingModelName(ONBOARDING_MODELS, 0)).toBe(SIEBEN_B)
  })

  it('knapp unter dem 7B-Bedarf traegt keinen der beiden und faellt auf 7B zurueck', () => {
    expect(recommendedOnboardingModelName(ONBOARDING_MODELS, 5)).toBe(SIEBEN_B)
  })

  it('eine Liste ohne statisch Empfohlenes und ohne tragende Hardware liefert undefined', () => {
    const ohneEmpfehlung = ONBOARDING_MODELS.map(m => ({ ...m, recommended: false }))
    expect(recommendedOnboardingModelName(ohneEmpfehlung, 0)).toBeUndefined()
  })
})

describe('strongestOnboardingModelName', () => {
  const SIEBEN_B = 'qwen2.5-7b'
  const NEUN_B = 'qwen3.5-9b'

  it('von zweien gewinnt das mit dem hoeheren VRAM-Bedarf, unabhaengig von der Reihenfolge', () => {
    expect(strongestOnboardingModelName(ONBOARDING_MODELS, [NEUN_B, SIEBEN_B])).toBe(NEUN_B)
    expect(strongestOnboardingModelName(ONBOARDING_MODELS, [SIEBEN_B, NEUN_B])).toBe(NEUN_B)
  })

  it('mit nur einem Namen liefert es genau den', () => {
    expect(strongestOnboardingModelName(ONBOARDING_MODELS, [SIEBEN_B])).toBe(SIEBEN_B)
  })

  // Negativkontrolle: eine leere Liste ist nicht dasselbe wie "das erste
  // gewinnt automatisch", es gibt schlicht keinen Gewinner.
  it('eine leere Liste liefert undefined, nicht irgendeinen Namen', () => {
    expect(strongestOnboardingModelName(ONBOARDING_MODELS, [])).toBeUndefined()
  })

  it('ein unbekannter Name wird ignoriert, kein Absturz', () => {
    expect(strongestOnboardingModelName(ONBOARDING_MODELS, ['gibt-es-nicht'])).toBeUndefined()
    expect(strongestOnboardingModelName(ONBOARDING_MODELS, ['gibt-es-nicht', SIEBEN_B])).toBe(SIEBEN_B)
  })
})
