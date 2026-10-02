// BL1 (review-waechter-windows.md): scripts/build-llama.sh's Windows MSVC
// linker-map flag must be spelled "-MAP", not "/MAP". Measured on the real
// box: MSYS/Git-Bash rewrites an argv entry that looks like a Unix absolute
// path ("/MAP") into a native Windows path before the (unquoted) cmake
// invocation ever sees it, so the old spelling never produced a .map file
// at all, and verify-sidecar-isa.sh's Windows guard died with "no .map file
// found" the very first time this script's committed form actually ran.
// This test cannot reproduce the MSYS argv rewriting itself (that only
// happens on a real Windows Git-Bash), so it checks the one thing runnable
// everywhere: the flag scripts/build-llama.sh actually emits. The real
// proof that the fix holds is a real Windows rebuild, see
// lu-301/bau/waechter-windows.md "Runde 2".
//
// Run with: node --test scripts/build-llama-flags.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'build-llama.sh');

function cmakeFlagsFor(triple) {
  // Source the script (never runs main(), see build-llama.sh's own
  // `[ "${BASH_SOURCE[0]}" = "${0}" ]` guard: under `bash -c "source ..."`,
  // BASH_SOURCE[0] is the sourced file but $0 stays "bash", so they never
  // match) purely to reach the pure `cmake_flags_for` function.
  return execFileSync('bash', ['-c', `source "${SCRIPT}"; cmake_flags_for "${triple}"`], {
    encoding: 'utf8',
  }).trim();
}

test('BL1: the Windows MSVC linker-map flags use -MAP, not /MAP', () => {
  const flags = cmakeFlagsFor('x86_64-pc-windows-msvc');
  assert.match(
    flags,
    /-DCMAKE_SHARED_LINKER_FLAGS=-MAP\b/,
    'a leading slash ("/MAP") is a Unix absolute path as far as MSYS/Git-Bash argv rewriting is concerned and is silently turned into a native filesystem path before cmake/link.exe ever sees it (measured on the box: "/MAP" becomes "C:/Program Files/Git/MAP"), so the linker never receives the flag and produces no .map file at all',
  );
  assert.match(flags, /-DCMAKE_EXE_LINKER_FLAGS=-MAP\b/);
});

test('BL1 (real box rebuild finding): CMAKE_MODULE_LINKER_FLAGS also carries -MAP, not just SHARED/EXE', () => {
  // ggml/src/CMakeLists.txt adds every GGML_BACKEND_DL backend
  // (ggml-cpu-*.dll, ggml-vulkan.dll, exactly the files this guard cares
  // about most) as a CMake MODULE library, which MSVC links with
  // CMAKE_MODULE_LINKER_FLAGS, not CMAKE_SHARED_LINKER_FLAGS. A real sidecar
  // rebuild on the box with only the SHARED/EXE flags set produced .map
  // files for ggml.dll/ggml-base.dll/llama*.dll/mtmd.dll/the exe but NOT ONE
  // for any ggml-cpu-*.dll or ggml-vulkan.dll.
  const flags = cmakeFlagsFor('x86_64-pc-windows-msvc');
  assert.match(flags, /-DCMAKE_MODULE_LINKER_FLAGS=-MAP\b/);
});

test('BL1: no leading-slash /MAP survives anywhere in the Windows linker flags', () => {
  const flags = cmakeFlagsFor('x86_64-pc-windows-msvc');
  assert.doesNotMatch(flags, /LINKER_FLAGS=\/MAP\b/, 'BL1 would recur if either linker-flags variable used the leading-slash spelling again');
});

test('mac and Linux cmake flags are untouched by the Windows -MAP fix', () => {
  assert.doesNotMatch(cmakeFlagsFor('aarch64-apple-darwin'), /MAP/);
  assert.doesNotMatch(cmakeFlagsFor('x86_64-apple-darwin'), /MAP/);
  assert.doesNotMatch(cmakeFlagsFor('x86_64-unknown-linux-gnu'), /MAP/);
});
