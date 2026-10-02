/**
 * Der Gespraechswechsel im Composer wird IM RENDER entschieden, und er
 * konvergiert.
 *
 * 90aa5c3d hat den Entwurf an sein Gespraech gebunden: beim Wechsel wird der
 * halbe Satz unter dem alten Gespraech abgelegt und beim Zurueckkommen wieder
 * hingelegt. Das VERHALTEN sichern die vier Zusicherungen in
 * `e2e/composer-keys.spec.ts` (Rotprobe gefahren: nimmt man die Rettung
 * heraus, melden zwei davon "unexpected value 'ein unfertiger Entwurf'").
 * Dieser Test sichert die BAUFORM, an der sie haengen.
 *
 * Gebaut war der Wechsel zuerst als Effekt mit zwei Refs davor, und genau das
 * war der einzige rote Punkt von `npm run lint` am 03.09.2026. In Wahrheit
 * zwei Punkte, denn eslint meldet pro Komponente nur den ersten: hinter
 * `react-hooks/refs` (Stand des Feldes wurde im Renderkoerper in ein Ref
 * geschrieben) stand `react-hooks/set-state-in-effect` (der Effekt rief
 * `setInput`/`setImages` direkt auf). Beide Regeln zeigen auf dieselbe
 * Ursache, und die Aufloesung ist die von React selbst empfohlene: der
 * Vergleich mit dem vorigen Gespraech steht im Render, die Anpassung
 * geschieht dort, React laeuft die Komponente sofort noch einmal.
 *
 * WARUM DAS EINEN WAECHTER BRAUCHT, obwohl `npm run lint` den Rueckweg in
 * einen Effekt selbst rot faerbt: die Konvergenz faellt unter keine Regel.
 * Ein Render, der Zustand anpasst, muss die Bedingung im selben Zug falsch
 * machen, sonst rendert React bis "Too many re-renders". Die eine Zeile, die
 * das leistet, ist `setLetztesGespraech(conversationId)`, und sie sieht wie
 * Buchhaltung aus, die man beim Aufraeumen streicht.
 *
 * Run: npx vitest run src/components/chat/__tests__/der-entwurf-wechselt-im-render.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const quelle = readFileSync(resolve(here, '../ChatInput.tsx'), 'utf8')

/**
 * Auflage 9 (Review composer Runde 2, 19.09.2026): jeder
 * `use(Layout)?Effect(() => { ... })`-Rumpf, per Klammerzaehlung begrenzt auf
 * SEIN eigenes schliessendes `}` - kein `[^]*?`, das ueber die Effektgrenze
 * hinauslaufen oder an ihr vorbeigreifen kann.
 */
function alleEffektRuempfe(quelltext: string): string[] {
  const ruempfe: string[] = []
  const kopf = /use(?:Layout)?Effect\(\(\) => \{/g
  let treffer: RegExpExecArray | null
  while ((treffer = kopf.exec(quelltext))) {
    const start = treffer.index + treffer[0].length
    let tiefe = 1
    let i = start
    for (; i < quelltext.length && tiefe > 0; i++) {
      if (quelltext[i] === '{') tiefe++
      else if (quelltext[i] === '}') tiefe--
    }
    ruempfe.push(quelltext.slice(start, i - 1))
  }
  return ruempfe
}

/** Der Renderzweig, der den Wechsel bemerkt. */
const wechsel = quelle.indexOf('if (letztesGespraech !== conversationId) {')
/** Sein Ende: die naechste Zeile, die auf Komponentenebene wieder zumacht. */
const ende = quelle.indexOf('\n  }\n', wechsel)
const zweig = wechsel > -1 && ende > wechsel ? quelle.slice(wechsel, ende) : ''

describe('der Wechsel wird im Render entschieden, nicht in einem Effekt', () => {
  it('es gibt den Renderzweig, und er vergleicht Zustand mit Zustand', () => {
    expect(wechsel).toBeGreaterThan(-1)
    // Zustand, kein Ref: ein Ref duerfte im Render gar nicht gelesen werden
    // (react-hooks/refs), und genau daran ist die erste Bauform gescheitert.
    expect(quelle).toContain('const [letztesGespraech, setLetztesGespraech] = useState(conversationId)')
    expect(quelle).toContain('const [entwuerfe, setEntwuerfe] = useState<')
  })

  it('kein Effekt verschiebt den Entwurf mehr', () => {
    // Der Rueckweg in einen `useEffect(..., [conversationId])`, der
    // `setEntwuerfe`/`setInput` fuer den Wechsel selbst aufruft, wuerde
    // set-state-in-effect zurueckholen. Die Zusicherung prueft genau DAS
    // Muster (ein Effekt, dessen Rumpf `setEntwuerfe(` ODER `setInput(`
    // erreicht), nicht jeden Text mit der Abhaengigkeit `[conversationId]`:
    // Auflage 1 (Review composer, 19.09.2026) hat seitdem einen ZWEITEN,
    // unabhaengigen `useLayoutEffect` mit genau dieser Abhaengigkeit
    // bekommen (Fokus-Wiederherstellung nach Ctrl/Cmd+N), der mit dem
    // Entwurfswechsel nichts zu tun hat und diesen Waechter sonst
    // faelschlich rot faerben wuerde.
    //
    // Auflage 9 (Review composer Runde 2, 19.09.2026): die fruehere Fassung
    // war `/use(?:Layout)?Effect\(\(\) => \{[^]*?setEntwuerfe\(/` - `[^]*?`
    // sucht ueber JEDE Effektgrenze hinweg. Ein `setEntwuerfe(` in einem
    // SPAETEREN Rueckruf (nicht im Effektrumpf selbst) haette diesen
    // Waechter also falsch rot gefaerbt, und ein reiner `setInput(`-Rueckfall
    // ohne `setEntwuerfe(` waere gar nicht erst aufgefallen. `effektRuempfe`
    // unten klammert deshalb jeden Effektrumpf per Klammerzaehlung bis zu
    // SEINEM schliessenden `}` ein, bevor er nach `setEntwuerfe(` ODER
    // `setInput(` sucht - keine Regex, die ueber die Grenze hinausgreifen
    // kann.
    const effektRuempfe = alleEffektRuempfe(quelle)
    expect(effektRuempfe.length).toBeGreaterThan(0)
    const effektVerschiebtEntwurf = effektRuempfe.some(
      (rumpf) => rumpf.includes('setEntwuerfe(') || rumpf.includes('setInput('),
    )
    expect(effektVerschiebtEntwurf).toBe(false)
  })

  it('NEGATIVKONTROLLE: ein `setInput(`-only-Rueckfall in einem Effekt faerbt den Waechter rot', () => {
    // Der historische Fehler war nicht zwingend `setEntwuerfe(` - ein Effekt,
    // der nur `setInput(zurueck?.text ?? '')` aufruft (die Rettung ohne die
    // Ablage), waere von der alten Nadel unentdeckt geblieben. Diese Probe
    // haengt keinen echten Effekt an ChatInput.tsx, sondern haelt am
    // TEXTBEWEIS fest: dieselbe Funktion, mit einer erfundenen Quelle
    // gefuettert, erkennt den `setInput`-only-Fall.
    const erfundeneQuelle = `
  useLayoutEffect(() => {
    const zurueck = conversationId ? entwuerfe[conversationId] : undefined
    setInput(zurueck?.text ?? '')
  }, [conversationId])
`
    const rumpfe = alleEffektRuempfe(erfundeneQuelle)
    expect(rumpfe.some((r) => r.includes('setInput('))).toBe(true)
  })

  it('NEGATIVKONTROLLE: `setEntwuerfe(` in einem Rueckruf NACH einem fremden Effekt faerbt nicht faelschlich rot', () => {
    // Der Fehler der alten Nadel in der ANDEREN Richtung: `[^]*?` haette
    // dieses Konstrukt (ein voellig unbeteiligter Effekt, gefolgt von einem
    // `setEntwuerfe(` weit ausserhalb jedes Effektrumpfs) als Treffer
    // gemeldet. Die klammerzaehlende Fassung schneidet den ersten Effekt an
    // SEINEM eigenen `}` ab und sieht das spaetere `setEntwuerfe(` gar nicht.
    const erfundeneQuelle = `
  useEffect(() => {
    textareaRef.current?.focus()
  }, [conversationId])

  const spaeterUnbeteiligt = () => {
    setEntwuerfe((bisher) => ({ ...bisher }))
  }
`
    const rumpfe = alleEffektRuempfe(erfundeneQuelle)
    expect(rumpfe.some((r) => r.includes('setEntwuerfe('))).toBe(false)
  })
})

describe('der Renderzweig macht seine eigene Bedingung falsch', () => {
  it('er setzt das zuletzt gesehene Gespraech, sonst rendert React endlos', () => {
    expect(zweig).toContain('setLetztesGespraech(conversationId)')
  })

  it('die Rettung selbst steht noch: ablegen und wieder hinlegen', () => {
    // Ohne diese drei bliebe der Waechter gruen, waehrend der Vertrag aus
    // 90aa5c3d weg waere.
    expect(zweig).toContain('setEntwuerfe((bisher) => {')
    expect(zweig).toContain('const zurueck = conversationId ? entwuerfe[conversationId] : undefined')
    expect(zweig).toContain("setInput(zurueck?.text ?? '')")
    expect(zweig).toContain('setImages(zurueck?.bilder ?? [])')
  })

  it('der Aktualisierer rechnet nur aus seinem Eingang, ist unter StrictMode also wiederholbar', () => {
    // StrictMode ruft ihn zweimal (src/main.tsx). Er darf deshalb nichts
    // lesen, was er selbst veraendert: kein `entwuerfe[` im Rumpf, nur
    // `bisher`.
    const auf = zweig.indexOf('setEntwuerfe((bisher) => {')
    const zu = zweig.indexOf('    }\n', auf)
    const rumpf = auf > -1 && zu > auf ? zweig.slice(auf, zu) : ''
    expect(rumpf).toContain('bisher')
    expect(rumpf).not.toContain('entwuerfe[')
  })
})
