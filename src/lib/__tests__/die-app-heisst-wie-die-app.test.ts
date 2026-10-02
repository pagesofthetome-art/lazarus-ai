/**
 * Was in den Tauri-Konfigurationen steht, entscheidet ueber die Identitaet des
 * ausgelieferten Programms: wie es heisst, wohin es installiert wird, welches
 * Datenprofil es liest, und ob es je ein Update bekommt.
 *
 * Am 03.09.2026 kam beim Zusammenfuehren des Design-Stroms die
 * Experiment-Identitaet in die Release-Linie. Der Bau auf der Box packte ein
 * "Lazarus Experiment_2.6.8_x64-setup.exe", und niemand haette es an den Tests
 * gemerkt, weil kein Test die Konfiguration las. Ein so gebautes 2.6.8 waere
 * fuer jeden Kunden eine fremde, leere App neben seiner eigenen gewesen, ohne
 * seine Modelle, ohne seine Chats, und ohne einen Update-Kanal, um je wieder
 * herauszukommen.
 *
 * Die Experiment-Identitaet ist richtig, sie gehoert nur auf den
 * Experiment-Zweig. Hier wird festgehalten, was auf der Release-Linie steht.
 *
 * Run: npx vitest run src/lib/__tests__/die-app-heisst-wie-die-app.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const TAURI = resolve(__dirname, '../../../src-tauri')
const lies = (name: string) => JSON.parse(readFileSync(resolve(TAURI, name), 'utf8'))

const basis = lies('tauri.conf.json')
const windows = lies('tauri.windows.conf.json')
const linux = lies('tauri.linux.conf.json')
const macos = lies('tauri.macos.conf.json')
// Das Overlay, das nur der Release-Lauf auf die Basis legt (release.yml).
const release = lies('tauri.release.conf.json')
const releaseYml = readFileSync(resolve(TAURI, '../.github/workflows/release.yml'), 'utf8')

describe('wie das ausgelieferte Programm heisst', () => {
  it('nirgends steht Experiment', () => {
    // Der eine Griff, der alles andere nach sich zieht. Ein Name mit Suffix
    // heisst: eigener Programmordner, eigenes Datenprofil, eigene
    // Schluesselbund-Eintraege.
    for (const [wo, cfg] of [['basis', basis], ['windows', windows], ['linux', linux], ['macos', macos]] as const) {
      const text = JSON.stringify(cfg)
      expect(text, `${wo} traegt eine Experiment-Identitaet`).not.toMatch(/experiment/i)
    }
  })

  it('Windows und Linux installieren unter dem ausgeschriebenen Namen', () => {
    // C:\Program Files\Lazarus\ ist der Pfad, unter dem die
    // vorhandenen Installationen liegen. Ein anderer Name dort ist keine
    // Umbenennung, sondern eine zweite Installation.
    expect(windows.productName).toBe('Lazarus')
    expect(linux.productName).toBe('Lazarus')
  })

  it('der Mac bleibt bei Lazarus, und das ist Absicht', () => {
    // Lazarus.app, kurz genug fuer das Dock. macOS uebernimmt den Basisnamen, es
    // steht also bewusst KEIN productName in der Mac-Datei.
    expect(macos.productName).toBeUndefined()
    expect(basis.productName).toBe('Lazarus')
  })

  it('die Kennung ist die der echten App', () => {
    expect(basis.identifier).toBe('app.lazarus.desktop')
  })
})

describe('ob ein Update je ankommt', () => {
  it('keine Update-Adresse ist an den frueheren Anbieter gebunden', () => {
    expect(basis.plugins?.updater?.endpoints).toEqual([])
    expect(JSON.stringify(basis)).not.toMatch(/PurpleDoubleD|locally-uncensored|lu-labs\.ai/i)
  })

  it('der Release-Lauf bezieht den Update-Kanal aus dem aktuellen Repository', () => {
    expect(releaseYml).toContain('${{ github.server_url }}/${{ github.repository }}/releases/latest/download/latest.json')
    expect(releaseYml).not.toMatch(/PurpleDoubleD|locally-uncensored|lu-labs\.ai/i)
  })

  it('der Release-Bau legt die Update-Dateien an, die Basis fordert sie nicht', () => {
    // Ohne createUpdaterArtifacts entsteht keine latest.json und keine
    // Signatur, und dann ist der Endpunkt oben eine Adresse ohne Ziel. Das
    // Feld gehoert trotzdem NICHT in die Basis: mit ihm verlangt der Bundler
    // den privaten Schluessel, den nur der Release-Laeufer hat, und das
    // keylose Bau-Tor in ci.yml (scripts/ci-tauri-build.sh) geht rot, bevor
    // release.yml ueberhaupt baut (gemessen 06.09.2026 auf Ubuntu 22.04: deb,
    // rpm und AppImage fertig, dann Exit 1 mit "no private key"). Deshalb
    // fordert der Release-Lauf die Artefakte selbst an, per Overlay auf dem
    // tauri-action-Schritt.
    expect(basis.bundle?.createUpdaterArtifacts).toBeUndefined()
    expect(release.bundle?.createUpdaterArtifacts).toBe('v1Compatible')
    expect(releaseYml).toMatch(/^\s*args:\s*--config src-tauri\/tauri\.release\.conf\.json(\s|$)/m)
  })

  it('Ziel und Artefakte gehoeren zusammen', () => {
    // Aus dem Experiment-Zweig uebernommen, weil der Befund auf beiden Linien
    // gilt: `createUpdaterArtifacts` an und `endpoints` leer ist der halbe
    // Zustand, in dem `tauri build` die Installer fertig auf die Platte legt
    // und DANACH mit "A public key has been found, but no private key" auf
    // Exit 1 geht (gemessen am 31.08.2026 unter Windows, am 01.09. auf dem
    // Mac). Verboten ist die Kombination, nicht das einzelne Feld.
    // Geprueft wird, was der Release-Bau wirklich sieht: Basis plus Overlay.
    const gebuendelt = { ...basis.bundle, ...release.bundle }
    const zielt = (basis.plugins?.updater?.endpoints ?? []).length > 0
    const signiert = gebuendelt.createUpdaterArtifacts !== undefined
      && gebuendelt.createUpdaterArtifacts !== false
    expect(signiert && !zielt, 'Artefakte an, aber kein Ziel').toBe(false)
  })

  it('der oeffentliche Schluessel steht da, solange main.rs das Plugin registriert', () => {
    // Ueberreinigen bricht die App beim START, nicht beim Kompilieren:
    // `tauri-plugin-updater` deklariert `pubkey` ohne serde-Default, ein
    // Deserialisierungsfehler wird ein hartes Err, und main.rs beendet den
    // Aufbau mit expect(). Ohne pubkey startet die App also gar nicht mehr.
    const mainRs = readFileSync(resolve(TAURI, 'src/main.rs'), 'utf8')
    if (mainRs.includes('tauri_plugin_updater::Builder::new().build()')) {
      expect(typeof basis.plugins?.updater?.pubkey).toBe('string')
      expect(basis.plugins.updater.pubkey.length).toBeGreaterThan(40)
    }
  })
})
