import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const read = (name: string) => JSON.parse(readFileSync(`src-tauri/${name}`, 'utf8'))
const base = read('tauri.conf.json')

for (const platform of ['windows', 'linux', 'macos']) {
  it(`${platform} release metadata preserves setup and network qualifications`, () => {
    const platformConfig = read(`tauri.${platform}.conf.json`)
    const release = read('tauri.release.conf.json')
    const bundle = { ...base.bundle, ...platformConfig.bundle, ...release.bundle }
    expect(bundle.shortDescription).toContain('private local AI tools')
    for (const phrase of ['compatible hardware and downloaded models',
      'additional backends or runtime components', 'third-party remote providers',
      'requests to those providers leave your device', 'tool permissions and data destination']) {
      expect(bundle.longDescription).toContain(phrase)
    }
    expect(`${bundle.shortDescription} ${bundle.longDescription}`).not.toMatch(
      /[\u2013\u2014]|first-party cloud|hosted model catalog|optional cloud inference|zero setup|no external software|no data leaves|entirely on your own machine|\d+ tools|\d+ optional local backends/i,
    )
  })
}

/**
 * T8 hat am 11.09. `apt show lazarus` auf Ubuntu 22.04 und 26.04
 * gelesen und im ganzen Kopf gezaehlt: GPU 0 Treffer, VRAM 0, RAM 0, GB 0,
 * CPU 0. Zur Hardware stand genau ein Satzteil da, "Local inference requires
 * compatible hardware and downloaded models", also kein Mass, an dem jemand
 * vor dem Herunterladen erkennen kann, ob seine Kiste reicht.
 *
 * R6-1 hat gezeigt, dass die alte Fassung dieses Waechters zu schwach war: sie
 * hat nur nachgesehen, ob die Zeichenkette "6 GB VRAM" irgendwo in
 * docs/llms-full.txt vorkommt, und das tat sie dreimal in einer
 * FramePack-Zeile, waehrend zwei Saetze daneben 8+ GB und 10 bis 12 GB
 * verlangten. Die Zahl haengt jetzt am Katalog: src/api/model-bundles.ts
 * fuehrt je Paket ein Feld vramRequired, und der kleinste Wert der Bild- und
 * der Videoliste ist der Boden, den ein Kundentext nennen darf. Getippt wird
 * hier keine Zahl.
 */
function vramBodenAusDemKatalog(): number {
  const katalog = readFileSync('src/api/model-bundles.ts', 'utf8')
  const liste = (name: string) => {
    const start = katalog.indexOf(`export function ${name}(): ModelBundle[]`)
    expect(start, `${name} fehlt im Katalog`).toBeGreaterThan(-1)
    const rest = katalog.slice(start + 1)
    const ende = rest.search(/\nexport (function|interface|const|type) /)
    return ende === -1 ? rest : rest.slice(0, ende)
  }
  const zahlen = ['getImageBundles', 'getVideoBundles']
    .flatMap((name) => [...liste(name).matchAll(/vramRequired: '([^']+)'/g)])
    .map((treffer) => Number.parseInt(treffer[1], 10))
    .filter(Number.isFinite)
  // Bild und Video tragen zusammen deutlich mehr als zwanzig Pakete. Faellt die
  // Zahl darunter, hat sich der Aufbau der Datei geaendert und nicht der Boden.
  expect(zahlen.length).toBeGreaterThan(20)
  return Math.min(...zahlen)
}

it('die Paketbeschreibung nennt Hardware, und zwar die aus dem Katalog', () => {
  const boden = vramBodenAusDemKatalog()
  const beschreibung: string = base.bundle.longDescription
  expect(beschreibung).toContain('8 GB of system memory')
  expect(beschreibung).toContain(`${boden} GB of VRAM`)

  // Auf den Seiten steht dieselbe Zahl. &nbsp; ist Hausstil, kein Unterschied.
  const ohneSchmalraum = (text: string) => text.replace(/&nbsp;|\u00a0/g, ' ')
  const quelle = ohneSchmalraum(readFileSync('docs/llms-full.txt', 'utf8'))
  expect(quelle).toContain('8 GB RAM')
  expect(quelle).toContain(`${boden} GB of VRAM`)

  // Jede Stelle, die eine Bilduntergrenze nennt, nennt dieselbe Zahl. Genau das
  // hat der alte Waechter durchgelassen.
  for (const datei of ['docs/llms-full.txt', 'docs/index.html']) {
    const saetze = ohneSchmalraum(readFileSync(datei, 'utf8'))
      .split('Image generation')
      .slice(1)
      .map((rest) => rest.split(/\.(?=\s|$|")|\n/)[0])
      .filter((satz) => /GB/.test(satz))
    expect(saetze.length, `${datei}: keine Hardwarezeile gefunden`).toBeGreaterThan(0)
    for (const satz of saetze) {
      expect(satz, `${datei}: Bilduntergrenze weicht vom Katalog ab`).toMatch(new RegExp(`\\b${boden} GB\\b`))
    }
  }

  // Gegenkontrolle: der Waechter kann eine erfundene Zahl auch sehen.
  expect(quelle).not.toContain('64 GB VRAM')
})
