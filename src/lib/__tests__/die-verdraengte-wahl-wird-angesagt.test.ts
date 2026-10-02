/**
 * @vitest-environment jsdom
 *
 * Faellt die Wahl mit dem Steckplatz, muss jemand es sagen.
 *
 * Die letzte Runde hat `dropDisplacedEnginePick` gebaut: uebernimmt ein
 * fremdes Backend den geteilten lokalen Steckplatz, wird die Wahl geraeumt,
 * weil auf 8127 nichts mehr liegt. Danach ist `activeModel` null. Und genau
 * das schaltet die einzige Stelle ab, die so etwas sonst ansagt:
 * `replacedBehindTheUsersBack` (lib/active-model-mode) verlangt einen
 * previous name, and there is none after clearing. The user
 * druckt in den Einstellungen Enable auf der Standby-Karte, sieht seinen Chip
 * von einem GGUF auf "Select Model" springen und liest kein Wort dazu.
 *
 * Gesagt wird es deshalb dort, wo der alte Name noch dasteht: im selben Zug
 * wie das Raeumen. Und NUR dort, wo der Nutzer den Wechsel nicht selbst
 * ausgeloest hat: wer im Waehler eine Zeile des wartenden Backends anklickt,
 * liest die Wechselzeile ueber genau diesen Vorgang schon, und ein zweiter
 * Satz wuerde sie loeschen statt ergaenzen.
 *
 * Run: npx vitest run src/lib/__tests__/die-verdraengte-wahl-wird-angesagt.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const backendCall = vi.fn(async (..._args: unknown[]) => ({}))
vi.mock('../../api/backend', () => ({
  backendCall: (...a: unknown[]) => backendCall(...a),
  isTauri: () => true,
  isMacOS: () => false,
  isWindows: () => true,
  isLinux: () => false,
  secretGet: vi.fn().mockRejectedValue(new Error('no vault')),
  secretSet: vi.fn(),
  secretDelete: vi.fn(),
}))

const { __resetBuiltinSlotOffloadForTests } = await import('../builtin-slot-eviction')
const { slotHandbackUpdate } = await import('../openai-slot-handover')
const {
  handBackChatProviderForRow, handbackAwaitsTheUsersPick,
  announceChatProviderSwitch, chatProviderSwitchNote, CHAT_PROVIDER_SWITCH_HOLD_MS,
} = await import('../../api/lazarus-engine-switch')
const { useModelStore } = await import('../../stores/modelStore')
const { useProviderStore } = await import('../../stores/providerStore')
const { useLazarusEngineSwitchStore } = await import('../../stores/lazarusEngineSwitchStore')

const LAZARUS_ROW = 'openai::Qwen3-4B-Q4_K_M'
const LMS_ROW = 'openai::qwen2.5-0.5b-instruct@q4_k_m'
const OLLAMA_ROW = 'llama3:8b'
const LMS_URL = 'http://localhost:1234/v1'

const ROWS = [
  { name: LAZARUS_ROW, model: 'Qwen3-4B-Q4_K_M', size: 2_300_000_000, type: 'text', provider: 'openai', providerName: 'Lazarus Engine' },
  { name: LMS_ROW, model: 'qwen2.5-0.5b-instruct@q4_k_m', size: 0, type: 'text', provider: 'openai', providerName: 'LM Studio' },
  { name: OLLAMA_ROW, model: OLLAMA_ROW, size: 0, type: 'text', provider: 'ollama', providerName: 'Ollama' },
]

/** Der Steckplatz nach einem Wechsel zur Lazarus Engine: unsere Engine drin, LM
 *  Studio auf der Standby-Karte. */
function lazarusEngineImSteckplatz(): void {
  useProviderStore.getState().setProviderConfig('openai', {
    enabled: true, managed: true, name: 'Lazarus Engine', baseUrl: 'http://127.0.0.1:8127/v1',
    isLocal: true, displaced: { name: 'LM Studio', baseUrl: LMS_URL, isLocal: true },
  })
}

/** Genau der Druck auf Enable der Standby-Karte (ProviderConfig.tsx). */
function enableAufDerStandbyKarte(): void {
  const update = slotHandbackUpdate(useProviderStore.getState().providers.openai)
  useProviderStore.getState().setProviderConfig('openai', update!)
}

/** Mikrotasks durchlassen: Raeumung und Ansage haengen an dynamischen
 *  Importen. */
async function durchlassen(): Promise<void> {
  for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(0)
}

const zeile = () => useLazarusEngineSwitchStore.getState().note

beforeEach(async () => {
  vi.useFakeTimers()
  // Eine gemerkte Klick-Rueckgabe aus einem vorigen Fall verjaehren lassen,
  // sonst schweigt der naechste zu Unrecht.
  await vi.advanceTimersByTimeAsync(CHAT_PROVIDER_SWITCH_HOLD_MS + 1)
  handbackAwaitsTheUsersPick()
  backendCall.mockClear()
  __resetBuiltinSlotOffloadForTests()
  useLazarusEngineSwitchStore.getState().dismiss()
  useModelStore.setState({ activeModel: null })
  useProviderStore.getState().resetProvidersToDefaults()
  await durchlassen()
  useModelStore.setState({ models: ROWS as never, activeModel: null })
  __resetBuiltinSlotOffloadForTests()
  useLazarusEngineSwitchStore.getState().dismiss()
  backendCall.mockClear()
})
afterEach(() => {
  __resetBuiltinSlotOffloadForTests()
  vi.useRealTimers()
})

describe('Enable auf der Standby-Karte sagt jetzt etwas', () => {
  it('die geraeumte Wahl bekommt eine Zeile, mit beiden Namen', async () => {
    lazarusEngineImSteckplatz()
    await durchlassen()
    useModelStore.setState({ activeModel: LAZARUS_ROW })

    enableAufDerStandbyKarte()
    await durchlassen()

    expect(useModelStore.getState().activeModel).toBeNull()
    const satz = zeile()
    expect(satz, 'kein Wort zum gewechselten Chip').not.toBeNull()
    expect(satz).toContain('Qwen3-4B-Q4_K_M')
    expect(satz).toContain('LM Studio')
    expect(useLazarusEngineSwitchStore.getState().tone).toBe('info')
  })

  it('und die Zeile stimmt sofort, gehalten wird nur auf den Leser', async () => {
    lazarusEngineImSteckplatz()
    await durchlassen()
    useModelStore.setState({ activeModel: LAZARUS_ROW })

    enableAufDerStandbyKarte()
    await durchlassen()

    // Wahr, sobald sie dasteht: der Steckplatz ist umgehaengt und die Wahl
    // gefallen, BEVOR der Satz geschrieben wird. Gehalten wird sie trotzdem,
    // aber nur, solange keine Seite offen ist, die sie zeichnet
    // (die-zeile-wartet-auf-ihren-leser.test.ts).
    expect(useProviderStore.getState().providers.openai.managed).toBe(false)
    expect(useModelStore.getState().activeModel).toBeNull()
    expect(zeile()).not.toBeNull()
  })

})

describe('NEGATIVKONTROLLE: wer den Wechsel selbst ausgeloest hat, liest nichts Neues', () => {
  it('der Klick im Waehler behaelt seine eigene Wechselzeile', async () => {
    // Die Reihenfolge aus ModelSelector.selectModelInner: erst den Steckplatz
    // zurueckgeben und es ansagen, dann das Modell in LM Studio laden, und
    // erst nach der Ladung die Wahl setzen. In diesem Fenster faellt die Wahl.
    lazarusEngineImSteckplatz()
    await durchlassen()
    useModelStore.setState({ activeModel: LAZARUS_ROW })

    const zurueckAn = handBackChatProviderForRow(ROWS[1])
    expect(zurueckAn).toBe('LM Studio')
    announceChatProviderSwitch('LM Studio', LMS_ROW)
    await durchlassen()

    expect(useModelStore.getState().activeModel, 'die Wahl faellt hier wirklich').toBeNull()
    expect(zeile(), 'die eigene Wechselzeile wurde verdraengt')
      .toBe(chatProviderSwitchNote('LM Studio'))
  })

  it('setzt der Aufrufer die Wahl sofort neu, faellt sie gar nicht erst', async () => {
    // useModels.activateModel: Steckplatz abgeben, ohne await die neue Zeile
    // setzen. Hier ist nichts zu raeumen und nichts zu sagen.
    lazarusEngineImSteckplatz()
    await durchlassen()
    useModelStore.setState({ activeModel: LAZARUS_ROW })

    handBackChatProviderForRow(ROWS[1])
    useModelStore.setState({ activeModel: LMS_ROW })
    await durchlassen()

    expect(useModelStore.getState().activeModel).toBe(LMS_ROW)
    expect(zeile()).toBeNull()
  })

  it('eine Ollama-Wahl ueberlebt die Uebergabe und bekommt kein Wort', async () => {
    lazarusEngineImSteckplatz()
    await durchlassen()
    useModelStore.setState({ activeModel: OLLAMA_ROW })

    enableAufDerStandbyKarte()
    await durchlassen()

    expect(useModelStore.getState().activeModel).toBe(OLLAMA_ROW)
    expect(zeile()).toBeNull()
  })

  it('ohne Wahl gibt es nichts zu raeumen und nichts zu sagen', async () => {
    lazarusEngineImSteckplatz()
    await durchlassen()

    enableAufDerStandbyKarte()
    await durchlassen()

    expect(useModelStore.getState().activeModel).toBeNull()
    expect(zeile()).toBeNull()
  })

  it('die gemerkte Klick-Rueckgabe verjaehrt, sie schweigt nicht fuer immer', async () => {
    lazarusEngineImSteckplatz()
    await durchlassen()
    useModelStore.setState({ activeModel: LAZARUS_ROW })

    handBackChatProviderForRow(ROWS[1])
    expect(handbackAwaitsTheUsersPick()).toBe(true)
    await vi.advanceTimersByTimeAsync(CHAT_PROVIDER_SWITCH_HOLD_MS + 1)
    expect(handbackAwaitsTheUsersPick()).toBe(false)
  })
})
