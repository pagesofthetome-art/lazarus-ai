#!/usr/bin/env bash
#
# isa-guard-linux-rules.sh: the pure decision logic for the Linux half of
# scripts/verify-sidecar-isa.sh (K1, 3.0.1), factored out of that script so
# it can be exercised by scripts/verify-sidecar-isa.selftest.sh against
# small checked-in disassembly-text fixtures, on any platform. This file
# touches no ELF file, no objdump, no companions directory: the real run
# (verify-sidecar-isa.sh) sources it and feeds it real objdump output, the
# selftest sources it and feeds it fixture text. Same functions, same
# verdicts, either way.
#
# FUND this responds to (SKEPTIKER-LINUX-WEB-K1.md, Abschnitt zum
# Linux-Waechter): the Linux guard checked 4 of the modules
# build-llama.sh stages (x64, sse42, ggml-base, the exe) and silently
# skipped every other base module (ggml, llama, llama-common,
# llama-server-impl, mtmd, ggml-vulkan) and every CPU-tier variant's own
# ISA ceiling entirely, exactly the modules that carried 24-98 VEX hits on
# the Windows side of the same regression.
#
# SCOPE, stated honestly (same spirit as scripts/win-isa-guard.mjs's own
# SCOPE comment): this file is a MNEMONIC/register-text classifier over
# objdump AT&T-syntax output, not an opcode-byte disassembler like the
# Windows guard. It answers two yes/no questions exactly, because both have
# an unambiguous textual signature:
#   - "does this file contain ANY VEX/EVEX-coded instruction at all"
#     (has_avx_or_above, unchanged from the pre-existing baseline rule: a
#     %ymm/%zmm register or a mnemonic beginning with 'v').
#   - "does this file contain an AVX-512 (or AVX512VL, its 128/256-bit
#     sibling) instruction specifically" (has_avx512_or_above). AVX-512 is
#     the only x86 extension that defines 512-bit registers, opmask (%k0-7)
#     registers/operands, the extended register numbers 16-31, or the
#     merge/zero-masking "{z}" suffix, so any of those is exact, not a
#     guess -- and so is a hit on one of the AVX-512-exclusive mnemonics
#     (vpternlog*, vrndscale*, k* register-mask ops, ...) below, whatever
#     register width they run at: AVX512VL is exactly "these EVEX
#     instructions, but legal on xmm/ymm too", not a different instruction
#     set, so a mnemonic that only exists as EVEX is AVX-512-or-above
#     regardless of the operand register it is applied to
#     (review-isalinux.md Runde 2, Auflage c: k0 and freestanding %kN, plus
#     AVX512VL on ymm/xmm, were both previously missed).
# review-isalinux.md Runde 2, Auflage d also corrected the one boundary
# this file used to draw only heuristically: "AVX-only vs. AVX2". Most
# AVX2 integer mnemonics (vpaddd, vpand, ...) are spelled identically
# whether they operate on a 128-bit %xmm (legal under plain AVX, which
# promoted the SSE integer set to VEX encoding at 128 bits only) or a
# 256-bit %ymm (which requires AVX2 -- plain AVX never defined a 256-bit
# *integer* op at all, only 256-bit floating-point and the handful of
# byte-shuffle/test forms named in AVX2_FLOAT_OR_PERMUTE_EXCEPTIONS below).
# That is not a parsing problem, it is a plain textual fact: any mnemonic
# beginning "vp" (an AVX2/AVX-512 integer op, not one of the float/permute
# exceptions) that appears on the same disassembly line as a %ymm register
# operand is, by definition, AVX2-or-above -- has_avx2_marker now checks
# exactly that, in addition to the curated list of mnemonics AVX2
# introduced that have no pre-AVX2 meaning at any width (broadcast-from-GPR,
# gather, variable-shift, the 128<->256 lane insert/extract/permute forms).
# Both are exact on a HIT; the residual (documented, not silently assumed
# away) gap is a miss: an AVX2-only mnemonic this file has not enumerated,
# spelled some other way. That residual is not load-bearing for catching
# the K1 shape (a "dynamic" build secretly compiled at a fixed high ISA
# level): the ceiling checks below always pair this with
# has_avx512_or_above, which alone already catches that shape exactly, as
# either an AVX-512 hit in a sub-AVX-512 tier or an AVX-or-above hit in a
# baseline module.
set -euo pipefail

has_avx_or_above() {
  grep -qE '%[yz]mm[0-9]+|[[:space:]]v[a-z0-9]{2,}([[:space:]]|$)|[[:space:]]k[a-z]{2,}([[:space:]]|$)' <<<"$1"
}

# AVX-512-exclusive mnemonics: no pre-AVX-512 encoding exists for any of
# these at any operand width, so a hit is AVX-512(VL)-or-above regardless
# of whether it runs on %zmm, %ymm or %xmm (review-isalinux.md Runde 2,
# Auflage c). "k*" covers the opmask register-manipulation instructions
# (kmovw, kandw, kortestw, ktestw, kshiftlw, kunpckbw, ...) -- no other x86
# mnemonic is spelled with a bare leading 'k'.
AVX512_EXCLUSIVE_MNEMONICS='vpternlog[dq]|vpmov[bwdq]2m|vpmovm2[bwdq]|vrndscale(ps|pd|ss|sd)|vfixupimm(ps|pd|ss|sd)|vgetexp(ps|pd|ss|sd)|vrcp14(ps|pd|ss|sd)|vrsqrt14(ps|pd|ss|sd)|vpcompress[bwdq]|vpexpand[bwdq]|vpconflict[dq]|vplzcnt[dq]|v4fmaddps|v4fmaddss|v4fnmaddps|v4fnmaddss|vp4dpwssd(s)?'

has_avx512_or_above() {
  local asm="$1"
  # %zmm: the 512-bit register itself, exact.
  # %k0-%k7: the opmask registers, whether written freestanding as a plain
  # operand (kmovw %eax,%k1, kortestw %k1,%k1) or inside the "{%k1}"
  # write-mask suffix on another instruction -- the same "%k[0-7]" text
  # matches both shapes, k0 included (the old pattern only matched k1-7
  # inside braces and missed both freestanding operands and k0 entirely).
  # "{z}": the zero-masking suffix, meaningless outside EVEX.
  # %[xy]mm16-31: the extended register numbers VEX cannot address at all
  # (VEX is 4 register-select bits, 0-15 only); any hit is EVEX, i.e.
  # AVX-512 or AVX512VL.
  grep -qE '%zmm[0-9]+|%k[0-7]\b|\{z\}|%[xy]mm(1[6-9]|2[0-9]|3[01])\b' <<<"$asm" \
    && return 0
  grep -qE "[[:space:]]($AVX512_EXCLUSIVE_MNEMONICS)([[:space:]]|\$)" <<<"$asm"
}

# Mnemonics AVX2 introduced that have no pre-AVX2 (plain-AVX or SSE) meaning
# at ANY operand width: broadcast-from-GPR/128-bit-lane forms, the 128<->256
# lane insert/extract/permute forms, variable-count shifts, masked
# load/store, and gather. A hit here is unambiguous.
AVX2_ONLY_MNEMONICS='vpbroadcastb|vpbroadcastw|vpbroadcastd|vpbroadcastq|vbroadcasti128|vbroadcasti32x4|vinserti128|vextracti128|vperm2i128|vpermd|vpermps|vpermq|vpermpd|vpsllvd|vpsllvq|vpsrlvd|vpsrlvq|vpsravd|vpblendd|vpmaskmovd|vpmaskmovq|vpgatherdd|vpgatherqd|vpgatherdq|vpgatherqq|vgatherdps|vgatherqps|vgatherdpd|vgatherqpd'

# "vp"-mnemonics that are legal under plain AVX (they shuffle/test bits
# rather than do 256-bit *integer arithmetic*, the actual AVX/AVX2 line,
# review-isalinux.md Runde 2 Auflage d) despite starting with "vp" like
# every genuine AVX2 integer op does. Excluded from the vp*+%ymm rule below
# so that rule stays exact rather than over-firing on these.
AVX2_FLOAT_OR_PERMUTE_EXCEPTIONS='vperm2f128|vpermilps|vpermilpd|vptest'

has_avx2_marker() {
  local asm="$1"
  if grep -qE "[[:space:]]($AVX2_ONLY_MNEMONICS)([[:space:]]|\$)" <<<"$asm"; then
    return 0
  fi
  # Any "vp*" integer mnemonic (not one of the float/permute exceptions
  # above) on the same line as a %ymm operand is unambiguously AVX2: plain
  # AVX never defined a 256-bit integer instruction at all, so there is no
  # legal AVX reading of e.g. "vpaddd %ymm1,%ymm0,%ymm0". This closes the
  # gap the K1 review found: a sandybridge/ivybridge/piledriver-tier module
  # accidentally built with -mavx2 and using only vpaddd/vpand/vpcmpeqd on
  # %ymm (none of which is in AVX2_ONLY_MNEMONICS) used to pass this guard
  # vacuously.
  local candidates
  candidates="$(grep -E '[[:space:]]vp[a-z0-9]+[[:space:]].*%ymm[0-9]+' <<<"$asm" || true)"
  [ -n "$candidates" ] || return 1
  grep -vE "[[:space:]]($AVX2_FLOAT_OR_PERMUTE_EXCEPTIONS)[[:space:]]" <<<"$candidates" | grep -q .
}

# --- tier table: llama.cpp GGML_CPU_ALL_VARIANTS, x86, non-MSVC branch -----
# Read at LLAMA_COMMIT (ggml/src/CMakeLists.txt, ggml_add_cpu_backend_variant
# calls; the "if (NOT MSVC)" branches only exist on Linux/GCC, not on
# Windows/MSVC, matching the four extra names verify-sidecar-isa.sh's own
# EXPECTED_VARIANTS comment already calls out):
#   x64                                          (ISA-neutral baseline)
#   sse42              SSE42                     (ISA-neutral baseline)
#   sandybridge        SSE42 AVX
#   ivybridge          SSE42 AVX F16C
#   piledriver         SSE42 AVX F16C FMA
#   haswell            SSE42 AVX F16C FMA AVX2 BMI2
#   alderlake          SSE42 AVX F16C FMA AVX2 BMI2 AVX_VNNI      (no AVX512)
#   skylakex           + AVX512
#   cannonlake         + AVX512_VBMI
#   cascadelake        + AVX512_VNNI
#   icelake            + AVX512_VBMI AVX512_VNNI
#   cooperlake         + AVX512_BF16
#   zen4               + AVX512_VBMI AVX512_VNNI AVX512_BF16
#   sapphirerapids     + AVX512_VBMI AVX512_VNNI AVX512_BF16 AMX_TILE AMX_INT8
# A future pin bump that changes this list is expected to update these
# arrays in the same commit, the same discipline EXPECTED_VARIANTS in
# verify-sidecar-isa.sh already holds itself to. sapphirerapids' AMX
# instructions are not VEX/EVEX-coded (a different encoding entirely) and
# are not detected by this file at all; that is fine here because
# sapphirerapids is already the top tier with no ceiling to enforce above
# AVX-512, the same residual gap win-isa-guard.mjs documents for BMI/POPCNT.
TIER_BASELINE_VARIANTS=(x64 sse42)
TIER_AVX_ONLY_VARIANTS=(sandybridge ivybridge piledriver)
TIER_AVX2_VARIANTS=(haswell alderlake)
TIER_AVX512_VARIANTS=(skylakex cannonlake cascadelake icelake cooperlake zen4 sapphirerapids)

# Derived, not a second hand-written copy (review-waechter-windows.md N5's
# lesson applied here too): the full Linux CPU-variant name list is exactly
# the union of the four tier arrays above, in one place, so it cannot drift
# from verify-sidecar-isa.sh's own EXPECTED_VARIANTS without the two being
# compared (verify-sidecar-isa.sh asserts the sets match at startup).
LINUX_CPU_VARIANTS=(
  "${TIER_BASELINE_VARIANTS[@]}"
  "${TIER_AVX_ONLY_VARIANTS[@]}"
  "${TIER_AVX2_VARIANTS[@]}"
  "${TIER_AVX512_VARIANTS[@]}"
)

# Every non-CPU-tier-variant module this pinned llama.cpp checkout produces
# for x86_64-unknown-linux-gnu: ggml/src/CMakeLists.txt add_library(ggml-base
# ...) and add_library(ggml ...), src/CMakeLists.txt add_library(llama ...),
# common/CMakeLists.txt (llama-common), tools/mtmd/CMakeLists.txt (mtmd),
# tools/server/CMakeLists.txt (llama-server-impl), plus the Vulkan backend
# module (ggml_add_backend_library(ggml-vulkan ...)). The same nine names
# (eight here plus the exe) EXPECTED_BASE_WINDOWS_MODULES in
# verify-sidecar-isa.sh already lists for MSVC -- one llama.cpp source tree,
# two platforms, the same target names (ggml.dll <-> libggml.so, etc.).
EXPECTED_BASE_LINUX_MODULES=(
  ggml ggml-base ggml-vulkan llama llama-common llama-server-impl mtmd
)

# Returns (on stdout) the ISA-ceiling role of a CPU-tier variant name:
# baseline|avx-only|avx2|avx512, or "unknown" (with a non-zero exit) for a
# name none of the four tier arrays list -- fail closed rather than guess.
tier_of_variant() {
  local variant="$1" v
  for v in "${TIER_BASELINE_VARIANTS[@]}"; do [ "$v" = "$variant" ] && { printf 'baseline\n'; return 0; }; done
  for v in "${TIER_AVX_ONLY_VARIANTS[@]}"; do [ "$v" = "$variant" ] && { printf 'avx-only\n'; return 0; }; done
  for v in "${TIER_AVX2_VARIANTS[@]}"; do [ "$v" = "$variant" ] && { printf 'avx2\n'; return 0; }; done
  for v in "${TIER_AVX512_VARIANTS[@]}"; do [ "$v" = "$variant" ] && { printf 'avx512\n'; return 0; }; done
  printf 'unknown\n'
  return 1
}

# BLOCKER B2 (review-isalinux.md Runde 2): a real SONAME sibling suffix is
# ONLY digits separated by dots ("0", "0.1.2", the shape
# libFoo.so -> libFoo.so.N -> libFoo.so.N.n.n symlink chains produce). The
# old glob pattern ("$exact".[0-9]*) only required the suffix to START with
# a digit, so "libggml-cpu-haswell.so.0.so" (extension exactly ".so",
# LOADABLE by ggml's own dlopen scan -- see the "extension .0" comment
# above find_variant_file in verify-sidecar-isa.sh) matched it and was
# silently treated as an already-checked sibling, never disassembled. A
# crafted or corrupted file only needs a digit as its first suffix
# character to hide behind a real module that way. Anchored full-match
# regex, not a glob, so "0.so" cannot sneak past as "starts with a digit".
is_soname_suffix() {
  [[ "$1" =~ ^[0-9]+(\.[0-9]+)*$ ]]
}

is_soname_sibling() {
  local base="$1" exact="$2" suffix
  case "$base" in
    "$exact".*)
      suffix="${base#"$exact".}"
      is_soname_suffix "$suffix"
      ;;
    *)
      return 1
      ;;
  esac
}

# BLOCKER B2, second half: classify_linux_module only proves a filename
# LOOKS like a SONAME sibling; it never touches the filesystem, so it
# cannot prove the bytes actually match. The caller (verify-sidecar-isa.sh,
# which has both files on disk) MUST additionally prove that before
# trusting "identical bytes already checked under that name" -- the claim
# the guard used to make without ever measuring it (review-isalinux.md
# Runde 2 B2: stage_dynamic_isa_companions's plain `cp` happens to
# dereference symlinks into identical bytes today, but this guard exists
# to measure the packaged output, not to trust the build step that
# produced it).
#   $1: the sibling file's path
#   $2: the canonical (already-classified, already-disassembled) file's
#       path
# Returns 0 if the two files are byte-identical (cmp -s), 1 otherwise
# (including either file missing).
verify_sibling_identical_bytes() {
  local sibling="$1" canonical="$2"
  [ -f "$sibling" ] && [ -f "$canonical" ] || return 1
  cmp -s "$sibling" "$canonical"
}

# Classify one staged filename against the known Linux module set (fail
# closed on anything not recognised, K1 SKEPTIKER-LINUX-WEB-K1.md).
#   $1: basename as found in the companions directory
#       (e.g. "libggml-base.so", "libggml-base.so.1", "libggml-cpu-haswell.so")
#   $2: lib prefix ("lib" on Linux, see LIB_PREFIX in verify-sidecar-isa.sh)
#   $3: lib ext ("so")
# stdout, exactly one of:
#   base:<name>            -- exact match, one of EXPECTED_BASE_LINUX_MODULES
#   variant:<name>:<tier>  -- exact match, one of LINUX_CPU_VARIANTS
#   sibling:<canonical>    -- a SONAME-versioned copy of one of the above
#                             ("<canonical-filename>.<digits>[.<digits>...]").
#                             cp without -P/-d (stage_dynamic_isa_companions
#                             in build-llama.sh) turns every hop of a
#                             libFoo.so -> libFoo.so.N -> libFoo.so.N.n.n
#                             symlink chain into its own real file with
#                             identical bytes here (see the "extension .0"
#                             comment in verify-sidecar-isa.sh's
#                             find_variant_file) -- not independently
#                             disassembled, already checked under its
#                             canonical name.
#   unknown                 -- neither of the above; the caller must fail
#                              closed on this, never skip it silently.
classify_linux_module() {
  local base="$1" prefix="$2" ext="$3" name tier v exact
  for name in "${EXPECTED_BASE_LINUX_MODULES[@]}"; do
    if [ "$base" = "${prefix}${name}.${ext}" ]; then
      printf 'base:%s\n' "$name"
      return 0
    fi
  done
  for v in "${LINUX_CPU_VARIANTS[@]}"; do
    if [ "$base" = "${prefix}ggml-cpu-${v}.${ext}" ]; then
      tier="$(tier_of_variant "$v")"
      printf 'variant:%s:%s\n' "$v" "$tier"
      return 0
    fi
  done
  for name in "${EXPECTED_BASE_LINUX_MODULES[@]}"; do
    exact="${prefix}${name}.${ext}"
    if is_soname_sibling "$base" "$exact"; then
      printf 'sibling:%s\n' "$exact"
      return 0
    fi
  done
  for v in "${LINUX_CPU_VARIANTS[@]}"; do
    exact="${prefix}ggml-cpu-${v}.${ext}"
    if is_soname_sibling "$base" "$exact"; then
      printf 'sibling:%s\n' "$exact"
      return 0
    fi
  done
  printf 'unknown\n'
  return 1
}

# Evaluate one module's disassembly text against its ISA role and print a
# one-line verdict to stdout ("OK: ..." or "FAIL: ..."); returns 0 for a
# pass, 1 for a fail. An unrecognised role also fails (fail closed): never
# silently treat an unclassified role as "nothing to check".
#   $1: role -- baseline | avx-only | avx2 | avx512
#   $2: disassembly text
#   $3: label for the message (module name plus path, caller's choice)
evaluate_module_asm() {
  local role="$1" asm="$2" label="${3:-module}"
  case "$role" in
    baseline)
      if has_avx_or_above "$asm"; then
        printf 'FAIL: %s contains an AVX-or-above instruction, this is supposed to be ISA-neutral baseline code (loaded by every CPU regardless of age)\n' "$label"
        return 1
      fi
      printf 'OK: %s carries no AVX-or-above instruction, as expected for a baseline module\n' "$label"
      return 0
      ;;
    avx-only)
      if has_avx512_or_above "$asm"; then
        printf 'FAIL: %s contains an AVX-512 instruction; this tier (SSE42 AVX F16C FMA at most) must never reach AVX-512\n' "$label"
        return 1
      fi
      if has_avx2_marker "$asm"; then
        printf 'FAIL: %s contains an AVX2-only instruction; this tier (SSE42 AVX F16C FMA at most) must never reach AVX2\n' "$label"
        return 1
      fi
      printf 'OK: %s stays at or below its AVX-only ceiling (no AVX-512, no AVX2-only mnemonic found)\n' "$label"
      return 0
      ;;
    avx2)
      if has_avx512_or_above "$asm"; then
        printf 'FAIL: %s contains an AVX-512 instruction; this tier (AVX2 at most) must never reach AVX-512\n' "$label"
        return 1
      fi
      printf 'OK: %s stays at or below its AVX2 ceiling (no AVX-512 found)\n' "$label"
      return 0
      ;;
    avx512)
      printf 'OK: %s is the top CPU tier (AVX-512 and above allowed by design), nothing to cap\n' "$label"
      return 0
      ;;
    *)
      printf 'FAIL: %s has an unrecognised ISA role "%s", refusing to guess a ceiling (fail closed)\n' "$label" "$role"
      return 1
      ;;
  esac
}

# BLOCKER B1 (review-isalinux.md Runde 2): evaluate_module_asm above only
# ever asks "does the text I was handed contain an AVX marker". Handed an
# EMPTY string (objdump crashed, printed nothing, or its
# `2>/dev/null`-swallowed stderr masked a real failure) every role except
# baseline-with-a-hit reads that as "clean", exactly the fail-open hole the
# review measured directly:
#   evaluate_module_asm baseline "" -> exit 0, "OK: ... carries no AVX-or-above instruction"
# A real objdump -d dump of a compiled module is at minimum dozens of
# instruction lines; this count is deliberately far below any real module
# staged by build-llama.sh (the same "catch a broken parser, not bound a
# real binary" reasoning win-isa-guard.mjs's own --min-lines already uses,
# see verify-sidecar-isa.sh:616), so a real Linux run tightening this
# further is expected, not a sign this number was wrong.
#
# NACHARBEIT N1 (review-isalinux.md, Nachreview Runde 2): genau das ist
# passiert. Der echte Linux-Lauf mass fuer das KLEINSTE Modul 761
# disassemblierte Befehlszeilen, weit ueber der alten 20er-Schwelle. 20 war
# nur eine grobe Untergrenze gegen einen kaputten Disassembler (siehe oben),
# keine an echten Zahlen gemessene. 200 bleibt weit unter den 761 echten
# und faengt trotzdem jeden Fall ab, in dem objdump nur ein paar Zeilen
# Fehlermeldung statt einer echten Disassemblierung liefert.
MIN_DISASM_LINES=200

# Count objdump/llvm-objdump AT&T-syntax instruction lines: an address,
# a colon, then a tab (the disassembled-instruction shape every fixture in
# scripts/__fixtures__/linux-isa/*.disasm.txt already uses, and the same
# shape real objdump -d output has -- see e.g. "  401020:\tpush   %rbp").
# A label line ("0000000000401020 <fn_name>:") has no leading tab after its
# colon and is correctly NOT counted.
count_disasm_lines() {
  grep -cE '^[[:space:]]*[0-9a-fA-F]+:[[:space:]]*[0-9a-fA-F][0-9a-fA-F ]*[[:space:]]' <<<"$1" || true
}

# Fail-closed gate for B1: a module whose disassembly has fewer than
# MIN_DISASM_LINES real instruction lines never reaches has_avx_or_above et
# al at all -- it is reported RED here, with its own message and, pointed
# at by the caller, whatever objdump itself printed to stderr, rather than
# silently reading "no AVX found in nothing" as a pass.
#   $1: disassembly text
#   $2: label for the message
#   $3: minimum line count (optional, default MIN_DISASM_LINES; the red
#       probe below can pass a lower bound for a deliberately tiny fixture)
# stdout: "OK: ..." or "FAIL: ..."; returns 0 or 1.
check_min_disasm_lines() {
  local asm="$1" label="${2:-module}" min="${3:-$MIN_DISASM_LINES}" n
  n="$(count_disasm_lines "$asm")"
  if [ "$n" -lt "$min" ]; then
    printf 'FAIL: %s: only %s disassembled instruction line(s) found (need >= %s); an empty or near-empty disassembly is not proof the module carries no AVX-or-above instruction, it means the disassembler produced nothing usable (crashed, printed an error, or was fed the wrong file) and every ISA verdict for this module is unproven\n' "$label" "$n" "$min"
    return 1
  fi
  printf 'OK: %s: %s disassembled instruction line(s) found (>= %s), disassembly looks real\n' "$label" "$n" "$min"
  return 0
}

# BLOCKER A2 (review-isalinux.md Runde 2): the Windows branch of
# verify-sidecar-isa.sh proves both directions -- every staged module is a
# KNOWN one (checked_base_modules loop) AND every EXPECTED base module was
# actually found (the missing-name loop right after it), plus an exact
# count match so a glob running empty or a name matching twice cannot pass
# vacuously. The Linux branch used to only check ggml-base and ggml-vulkan
# by name and relied on the "unrecognised module" catch-all for everything
# else, which cannot notice an expected module that is simply ABSENT (an
# absent file classifies nothing, so the catch-all never sees it). This is
# the same check, Linux side, kept here (rather than inline in
# verify-sidecar-isa.sh) so it can be proven by the selftest with a plain
# list of names, no COMPANIONS_DIR needed.
#   $1: newline-separated list of base-module names actually classified
#       while walking the staged files (classify_linux_module's "base:"
#       branch only ever emits one name per exact filename, so duplicates
#       here mean two different staged filenames both matched the same
#       expected name, not a normal outcome)
# stdout: "OK: ..." or "FAIL: ..."; returns 0 or 1.
check_base_module_coverage() {
  local found_csv="$1" name f found missing=() found_count=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    found_count=$((found_count + 1))
  done <<<"$found_csv"
  for name in "${EXPECTED_BASE_LINUX_MODULES[@]}"; do
    found=""
    while IFS= read -r f; do
      [ "$f" = "$name" ] && { found=1; break; }
    done <<<"$found_csv"
    [ -n "$found" ] || missing+=("$name")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    printf 'FAIL: expected base Linux module(s) missing from the companions directory: %s (EXPECTED_BASE_LINUX_MODULES); a partial build or a stage step silently dropping a file must turn this guard red, not pass on whatever happened to be there\n' "${missing[*]}"
    return 1
  fi
  if [ "$found_count" -ne "${#EXPECTED_BASE_LINUX_MODULES[@]}" ]; then
    printf 'FAIL: found %s base Linux module(s) but expected exactly %s (%s); a name matched twice would otherwise pass this guard vacuously\n' "$found_count" "${#EXPECTED_BASE_LINUX_MODULES[@]}" "${EXPECTED_BASE_LINUX_MODULES[*]}"
    return 1
  fi
  printf 'OK: all %s expected base Linux module(s) present, no duplicates\n' "$found_count"
  return 0
}
