/**
 * Die drei Stufen des lokalen Character-Trainers, an EINER Stelle.
 *
 * Die Zahlen standen bisher nur im Waehler von SpecialIntentControls, und der
 * Hinweistext darunter nannte die wirksame Zahl ohne den Namen der Stufe. Fund
 * 2 der E2E-Kampagne 3.0.0 (T3, Box, 11.09.2026) ist genau diese Luecke: der
 * Tester klickte `Quick`, las weiter `(400 STEPS)` und hielt die Stufe fuer
 * wirkungslos. Sie war es nicht. Seine eigene Messung eine Minute vor dem Klick
 * (`p-5a-out.json`) zeigt denselben Text schon mit 400, weil die gespeicherte
 * Wahl der Box laengst auf Quick stand. 400 IST Quick, und Quick ist die
 * kleinste der drei Stufen; das Handbuch sagt dasselbe (docs/guide/create:
 * "Quick" (400 steps), "Standard" (1200) or "Thorough" (2400)).
 *
 * Der Hinweistext nennt deshalb jetzt die Stufe neben der Zahl. Wer das liest,
 * kann nicht mehr raten, welche der drei gerade gilt.
 */

export interface TrainPreset {
  /** `--max_train_steps` des Laufs (src-tauri/src/commands/trainer.rs). */
  steps: number
  /** Was im Waehler steht. UI-Text, also englisch. */
  label: string
}

export const TRAIN_PRESETS: TrainPreset[] = [
  { steps: 400, label: 'Quick' },
  { steps: 1200, label: 'Standard' },
  { steps: 2400, label: 'Thorough' },
]

/**
 * Die Voreinstellung. Muss der Voreinstellung des Trainers gleichen, die ohne
 * Angabe greift (`steps.unwrap_or(1200)` in trainer.rs), sonst traegt eine
 * Oberflaeche eine andere Zahl vor als der Lauf nimmt.
 */
export const TRAIN_STEPS_DEFAULT = 1200

/** Die Stufe zu einer Schrittzahl, oder null fuer eine Zahl, die keine ist. */
export function trainPresetLabel(steps: number): string | null {
  return TRAIN_PRESETS.find((p) => p.steps === steps)?.label ?? null
}

/**
 * Was im Hinweistext in der Klammer steht: die wirksame Zahl, und davor die
 * Stufe, wenn es eine ist.
 */
export function trainStepsNote(steps: number): string {
  const label = trainPresetLabel(steps)
  return label ? `${label}, ${steps} steps` : `${steps} steps`
}
