// Regression probes for the dependency security patch. No network or private files.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const copies = [
  ['root', require.resolve('fflate')],
  ['three-stdlib', require.resolve('fflate', { paths: [dirname(require.resolve('three-stdlib'))] })],
]

for (const [label, modulePath] of copies) {
  test(`${label} ZIP64 parser finishes a missing extra field without looping`, () => {
    // A tiny central directory requests ZIP64 sizes but omits its extra field.
    // Isolate the synchronous parser: a regression cannot hang the test runner.
    const result = spawnSync(process.execPath, ['--max-old-space-size=64', '-e', `
      const { unzipSync } = require(${JSON.stringify(modulePath)});
      const data = new Uint8Array(200);
      const view = new DataView(data.buffer);
      view.setUint32(0, 0x06064b50, true);
      view.setUint32(32, 1, true);
      view.setUint32(48, 64, true);
      view.setUint32(64, 0x02014b50, true);
      view.setUint32(84, 0xffffffff, true);
      view.setUint32(158, 0x07064b50, true);
      view.setUint32(178, 0x06054b50, true);
      view.setUint16(186, 0xffff, true);
      view.setUint32(194, 0xffffffff, true);
      try { unzipSync(data); process.stdout.write('completed'); }
      catch { process.stdout.write('rejected'); }
    `], { timeout: 2000, maxBuffer: 4096, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    assert.equal(result.error, undefined, 'Malformed ZIP64 must finish within the isolated deadline')
    assert.equal(result.status, 0)
    // The maintained branches differ on recovery versus rejection. Both must
    // finish; strict archive validation is not this upstream patch's contract.
    assert.match(result.stdout, /^(completed|rejected)$/)
  })
  test(`${label} ZIP parser still round-trips valid files`, () => {
    const { zipSync, unzipSync, strToU8, strFromU8 } = require(modulePath)
    const archive = zipSync({ 'fixture.txt': strToU8('Local archive regression') })
    assert.equal(strFromU8(unzipSync(archive)['fixture.txt']), 'Local archive regression')
  })
}

test('XML parser reports malformed end tags and accepts well-formed text', () => {
  const { DOMParser } = require('@xmldom/xmldom')
  for (const suffix of ['\njunk', ' junk']) {
    const errors = []
    const parser = new DOMParser({ errorHandler: { warning() {}, error: (message) => errors.push(message), fatalError: (message) => errors.push(message) } })
    parser.parseFromString(`<fixture></fixture${suffix}>`, 'text/xml')
    assert.ok(errors.length > 0, 'Malformed end tag must not be silently accepted')
  }
  const errors = []
  const parser = new DOMParser({ errorHandler: (message) => errors.push(message) })
  const doc = parser.parseFromString('<fixture>Local &amp; valid</fixture>', 'text/xml')
  assert.equal(doc.documentElement.textContent, 'Local & valid')
  assert.deepEqual(errors, [])
})
