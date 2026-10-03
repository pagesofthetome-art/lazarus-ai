/**
 * Das Monogramm im Fensterbalken — Audit Welle 3, Punkt 5:
 * „Titlebar-Monogramm streichen, SVG statt 512px-PNG".
 *
 * Der Bullet hat zwei Haelften, und bis zum 01.09.2026 war nur die zweite
 * gegangen. Dieser Test haelt jetzt beide fest:
 *
 *   1. Der Balken zieht die Vektorfassung — und zwar aus `brand.ts`, nicht
 *      mehr aus einer eigenen Kopie der Konstante. (Bis hierher stand hier
 *      `expect(CODE).toMatch(/const MONOGRAM = '\/Lazarus-monogram\.svg'/)`, was
 *      genau diese zweite Kopie festgenagelt hat. Die Zeile ist nicht
 *      weggefallen, sondern umgedreht: verlangt wird jetzt der Import UND
 *      die Abwesenheit jedes eigenen Pfadliterals. Das ist die schaerfere
 *      Bedingung — sie verbietet, was die alte erzwungen hat.)
 *
 *   2. „Streichen" ist auf mac ausgefuehrt und auf Windows/Linux begruendet
 *      NICHT ausgefuehrt. Der Test nagelt beide Seiten fest, damit die
 *      Entscheidung nicht als Zufall wieder umkippt: der mac-Streifen gibt
 *      ein leeres, selbstschliessendes Drag-Region-Div zurueck (die Hoehe
 *      muss bleiben, sonst rutscht der Inhalt unter die nativen Lichter),
 *      der Windows/Linux-Zweig behaelt genau ein 18px-Zeichen.
 *
 *   3. Er rechnet die BEHAUPTUNGEN nach, mit denen das begruendet wurde —
 *      inklusive der unbequemen. Die SVG-Datei ist GROESSER als das PNG, und
 *      der Boot-Chunk aendert sich dadurch um nichts, weil `public/` nie
 *      gebuendelt wird. Wer diese Begruendung eines Tages zu „spart Platz"
 *      verkuerzt, faellt hier durch.
 *
 * Die PNG-Masse werden aus dem IHDR der Datei gelesen, nicht abgeschrieben:
 * die „512x512"-Zahl des Audits ist damit hier verifiziert und nicht
 * uebernommen.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..', '..', '..', '..')
const PUBLIC = resolve(ROOT, 'public')
const TITLEBAR = readFileSync(resolve(__dirname, '..', 'Titlebar.tsx'), 'utf8')
/** Ohne Kommentare — die Begruendung im Kopf der Datei NENNT den PNG-Pfad. */
const CODE = TITLEBAR.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const BRAND = readFileSync(resolve(__dirname, '..', 'brand.ts'), 'utf8')

describe('der Fensterbalken zieht die Vektorfassung', () => {
  it('genau eine Quelle fuer den Pfad, und die ist `brand.ts`', () => {
    expect(CODE).toMatch(/import \{ MONOGRAM, MONOGRAM_INVERT \} from '\.\/brand'/)
    // Kein eigenes Pfadliteral mehr — weder als Konstante noch im JSX.
    expect(CODE).not.toMatch(/'\/Lazarus-monogram/)
    expect(CODE).not.toMatch(/const MONOGRAM\s*=/)
  })

  it('und kein Rastername, unter keinem seiner Aliase', () => {
    expect(CODE).not.toContain('Lazarus-monogram-bw.png')
    expect(CODE).not.toContain('Lazarus-monogram-white.png')
    expect(CODE).not.toMatch(/\.(png|jpe?g|webp|gif|bmp)\b/)
  })

  it('auch das Invertierungsrezept kommt aus `brand.ts`, nicht von Hand', () => {
    expect(CODE).toContain('${MONOGRAM_INVERT}')
    expect(CODE).not.toMatch(/className="[^"]*dark:invert-0 invert/)
  })
})

describe('„streichen" — auf mac ausgefuehrt, auf Windows/Linux begruendet nicht', () => {
  it('der mac-Streifen zeigt gar kein Zeichen mehr', () => {
    // Ein leeres, selbstschliessendes Div: kein Kind, also auch kein <img>.
    expect(CODE).toMatch(/if \(isMacOS\(\)\) \{\s*return \(\s*<div[^>]*\/>\s*\)\s*\}/)
  })

  it('aber der Streifen selbst bleibt — er reserviert die Hoehe fuer die nativen Lichter', () => {
    const macBlock = CODE.slice(CODE.indexOf('if (isMacOS())'))
    const bis = macBlock.indexOf('/>')
    expect(bis).toBeGreaterThan(0)
    const div = macBlock.slice(0, bis)
    expect(div).toContain('data-tauri-drag-region')
    expect(div).toContain('h-8')
  })

  it('Windows/Linux behaelt genau EIN Zeichen — das Fenstersymbol des ersetzten Systembalkens', () => {
    const imgs = [...CODE.matchAll(/<img src=\{?([^ }]+)\}?/g)].map((m) => m[1])
    expect(imgs).toEqual(['MONOGRAM'])
  })

  it('und rendert es weiterhin auf 18px', () => {
    expect((CODE.match(/width=\{18\} height=\{18\}/g) ?? []).length).toBe(1)
  })

  it('die Begruendung fuer den Unterschied steht in der Datei, nicht nur im Bericht', () => {
    // Ohne sie ist die Ungleichbehandlung der beiden Zweige eine Schlamperei.
    expect(TITLEBAR).toMatch(/decorations: false/)
    expect(TITLEBAR).toMatch(/KEIN App-Symbol/)
  })
})

describe('das Fensterzeichen folgt dem zentralen Markenpfad', () => {
  it('brand.ts verweist auf eine ausgelieferte Datei, die Titlebar tatsaechlich verwendet', () => {
    const assetPath = BRAND.match(/MONOGRAM\s*=\s*'([^']+)'/)?.[1]
    expect(assetPath).toBeTruthy()
    expect(CODE).toContain('src={MONOGRAM}')
    expect(existsSync(resolve(PUBLIC, assetPath!.replace(/^\//, '')))).toBe(true)
  })
})
