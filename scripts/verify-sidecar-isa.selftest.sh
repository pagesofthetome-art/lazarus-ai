#!/usr/bin/env bash
#
# verify-sidecar-isa.selftest.sh: proves the DECISION LOGIC of the Linux
# half of verify-sidecar-isa.sh (scripts/lib/isa-guard-linux-rules.sh)
# against small checked-in disassembly-text fixtures
# (scripts/__fixtures__/linux-isa/), with no objdump, no real ELF file and
# no COMPANIONS_DIR needed. Runs the same on the Linux CI runner and on a
# Mac dev box (arm64), the same reasoning win-isa-guard.test.mjs already
# uses for the Windows half of this guard: the real Linux run always needs
# a real x86_64 build to disassemble (see the "real run" command at the
# bottom of this file's usage comment), but the CLASSIFICATION and CEILING
# rules that decide pass/fail from that disassembly text are pure functions
# and can be proven everywhere, every commit.
#
# FUND this answers (SKEPTIKER-LINUX-WEB-K1.md): the pre-existing Linux
# guard checked 4 of the staged modules and never exercised a tier-ceiling
# rule at all, so nothing in this repo's test suite could have caught a
# regression there before a real Linux build ran. This selftest is that
# missing coverage, runnable on every commit regardless of platform.
#
# Usage: scripts/verify-sidecar-isa.selftest.sh
# Real Linux run (after a real build, by the tester assigned to it):
#   scripts/build-llama.sh x86_64-unknown-linux-gnu
#   scripts/verify-sidecar-isa.sh x86_64-unknown-linux-gnu
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/__fixtures__/linux-isa"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/isa-guard-linux-rules.sh"

pass_count=0
fail_count=0

# Every assertion goes through this so a wrong verdict AND a wrong exit
# code are both caught, the same "exact expected outcome, not just any
# failure" discipline verify-sidecar-isa.sh's own Windows controls already
# hold themselves to (review-waechter-windows.md BLOCKER B2).
assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    printf '  ok   %s\n' "$desc"
    pass_count=$((pass_count + 1))
  else
    printf '  FAIL %s: expected [%s], got [%s]\n' "$desc" "$expected" "$actual" >&2
    fail_count=$((fail_count + 1))
  fi
}

fixture() {
  local name="$1"
  [ -f "$FIXTURES_DIR/$name" ] || { printf '  FAIL missing fixture %s\n' "$name" >&2; fail_count=$((fail_count + 1)); return; }
  cat "$FIXTURES_DIR/$name"
}

echo "== tier table consistency (derived list vs. the hand-typed set) =="
# Same 14 names verify-sidecar-isa.sh's own EXPECTED_VARIANTS lists for a
# non-Windows triple, order-independent. Catches the two lists drifting
# apart the way review-waechter-windows.md N5 warned about for the Windows
# side of this same guard.
expected_variant_set='alderlake cannonlake cascadelake cooperlake haswell icelake ivybridge piledriver sandybridge sapphirerapids skylakex sse42 x64 zen4'
actual_variant_set="$(printf '%s\n' "${LINUX_CPU_VARIANTS[@]}" | sort | tr '\n' ' ' | sed 's/ $//')"
assert_eq "LINUX_CPU_VARIANTS matches the 14-name pin (14 entries, one place)" \
  "$(printf '%s' "$expected_variant_set" | tr ' ' '\n' | sort | tr '\n' ' ' | sed 's/ $//')" \
  "$actual_variant_set"

echo "== tier_of_variant =="
assert_eq "x64 is baseline" "baseline" "$(tier_of_variant x64)"
assert_eq "sse42 is baseline" "baseline" "$(tier_of_variant sse42)"
assert_eq "sandybridge is avx-only" "avx-only" "$(tier_of_variant sandybridge)"
assert_eq "piledriver is avx-only" "avx-only" "$(tier_of_variant piledriver)"
assert_eq "haswell is avx2" "avx2" "$(tier_of_variant haswell)"
assert_eq "alderlake is avx2" "avx2" "$(tier_of_variant alderlake)"
assert_eq "skylakex is avx512" "avx512" "$(tier_of_variant skylakex)"
assert_eq "sapphirerapids is avx512" "avx512" "$(tier_of_variant sapphirerapids)"
assert_eq "made-up name is unknown" "unknown" "$(tier_of_variant not-a-real-tier || true)"

echo "== classify_linux_module (fail-closed module accounting) =="
assert_eq "libggml-base.so is a known base module" "base:ggml-base" \
  "$(classify_linux_module libggml-base.so lib so)"
assert_eq "libggml-cpu-haswell.so is a known variant (avx2 tier)" "variant:haswell:avx2" \
  "$(classify_linux_module libggml-cpu-haswell.so lib so)"
assert_eq "libggml-cpu-sandybridge.so is a known variant (avx-only tier)" "variant:sandybridge:avx-only" \
  "$(classify_linux_module libggml-cpu-sandybridge.so lib so)"
assert_eq "libggml-base.so.1 is a SONAME sibling of libggml-base.so" "sibling:libggml-base.so" \
  "$(classify_linux_module libggml-base.so.1 lib so)"
assert_eq "libggml-cpu-x64.so.1.2.3 is a SONAME sibling of libggml-cpu-x64.so" "sibling:libggml-cpu-x64.so" \
  "$(classify_linux_module libggml-cpu-x64.so.1.2.3 lib so)"
assert_eq "an unrelated new .so is unknown (fail closed, the skeptic's actual finding)" "unknown" \
  "$(classify_linux_module libggml-cpu-zen5.so lib so || true)"
assert_eq "a plain typo/near-miss name is unknown, not fuzzy-matched" "unknown" \
  "$(classify_linux_module libggml-cpu-haswel.so lib so || true)"

# BLOCKER B2 (review-isalinux.md Runde 2): a versioned-looking suffix that
# is NOT purely digits-and-dots (a loadable ".so" tacked back on the end,
# or arbitrary text after the first digit) must never be trusted as a
# SONAME sibling -- it is exactly the shape ggml's own loader (prefix
# "libggml-cpu-", extension exactly ".so") would happily dlopen.
assert_eq "libggml-cpu-haswell.so.0.so is unknown, NOT a sibling (loadable by ggml, must be disassembled, RED PROBE)" "unknown" \
  "$(classify_linux_module libggml-cpu-haswell.so.0.so lib so || true)"
assert_eq "libggml-base.so.1evil.so is unknown, NOT a sibling (RED PROBE)" "unknown" \
  "$(classify_linux_module libggml-base.so.1evil.so lib so || true)"
assert_eq "libggml-base.so.1 is still correctly a sibling (pure digit suffix, not regressed)" "sibling:libggml-base.so" \
  "$(classify_linux_module libggml-base.so.1 lib so)"
assert_eq "libggml-cpu-x64.so.1.2.3 is still correctly a sibling (multi-part digit suffix, not regressed)" "sibling:libggml-cpu-x64.so" \
  "$(classify_linux_module libggml-cpu-x64.so.1.2.3 lib so)"

echo "== verify_sibling_identical_bytes (B2, second half: bytes, not just filenames) =="
sibling_scratch="$(mktemp -d)"
printf 'identical-bytes' > "$sibling_scratch/canonical.so"
printf 'identical-bytes' > "$sibling_scratch/sibling-same.so.1"
printf 'DIFFERENT-bytes!' > "$sibling_scratch/sibling-different.so.1"
if verify_sibling_identical_bytes "$sibling_scratch/sibling-same.so.1" "$sibling_scratch/canonical.so"; then
  printf '  ok   byte-identical sibling verified via cmp -s\n'; pass_count=$((pass_count + 1))
else
  printf '  FAIL byte-identical sibling should have verified\n' >&2; fail_count=$((fail_count + 1))
fi
if verify_sibling_identical_bytes "$sibling_scratch/sibling-different.so.1" "$sibling_scratch/canonical.so"; then
  printf '  FAIL a sibling with DIFFERENT bytes must NOT verify (RED PROBE)\n' >&2; fail_count=$((fail_count + 1))
else
  printf '  ok   a sibling with different bytes correctly fails verification (RED PROBE)\n'; pass_count=$((pass_count + 1))
fi
if verify_sibling_identical_bytes "$sibling_scratch/does-not-exist.so.1" "$sibling_scratch/canonical.so"; then
  printf '  FAIL a missing sibling file must NOT verify (RED PROBE)\n' >&2; fail_count=$((fail_count + 1))
else
  printf '  ok   a missing sibling file correctly fails verification (RED PROBE)\n'; pass_count=$((pass_count + 1))
fi
rm -rf "$sibling_scratch"

echo "== has_avx_or_above / has_avx512_or_above / has_avx2_marker =="
clean_baseline="$(fixture clean-baseline.disasm.txt)"
avx_hit_baseline="$(fixture avx-hit-baseline.disasm.txt)"
clean_avx_only="$(fixture clean-avx-only.disasm.txt)"
avx2_leak="$(fixture avx2-leak-in-avx-only.disasm.txt)"
clean_avx2="$(fixture clean-avx2.disasm.txt)"
avx512_leak="$(fixture avx512-leak-in-avx2.disasm.txt)"
haswell_positive="$(fixture haswell-positive-control.disasm.txt)"
clean_avx512="$(fixture clean-avx512.disasm.txt)"

if has_avx_or_above "$clean_baseline"; then
  printf '  FAIL clean-baseline fixture should have NO AVX-or-above hit\n' >&2; fail_count=$((fail_count + 1))
else
  printf '  ok   clean-baseline fixture has no AVX-or-above hit\n'; pass_count=$((pass_count + 1))
fi
if has_avx_or_above "$avx_hit_baseline"; then
  printf '  ok   avx-hit-baseline fixture IS caught by has_avx_or_above\n'; pass_count=$((pass_count + 1))
else
  printf '  FAIL avx-hit-baseline fixture should have an AVX-or-above hit\n' >&2; fail_count=$((fail_count + 1))
fi
if has_avx2_marker "$avx2_leak"; then
  printf '  ok   avx2-leak-in-avx-only fixture IS caught by has_avx2_marker\n'; pass_count=$((pass_count + 1))
else
  printf '  FAIL avx2-leak-in-avx-only fixture should trip has_avx2_marker\n' >&2; fail_count=$((fail_count + 1))
fi
if has_avx2_marker "$clean_avx_only"; then
  printf '  FAIL clean-avx-only fixture must NOT trip has_avx2_marker\n' >&2; fail_count=$((fail_count + 1))
else
  printf '  ok   clean-avx-only fixture does not trip has_avx2_marker\n'; pass_count=$((pass_count + 1))
fi
if has_avx512_or_above "$avx512_leak"; then
  printf '  ok   avx512-leak-in-avx2 fixture IS caught by has_avx512_or_above\n'; pass_count=$((pass_count + 1))
else
  printf '  FAIL avx512-leak-in-avx2 fixture should trip has_avx512_or_above\n' >&2; fail_count=$((fail_count + 1))
fi
if has_avx512_or_above "$clean_avx2"; then
  printf '  FAIL clean-avx2 fixture must NOT trip has_avx512_or_above\n' >&2; fail_count=$((fail_count + 1))
else
  printf '  ok   clean-avx2 fixture does not trip has_avx512_or_above\n'; pass_count=$((pass_count + 1))
fi
# Positive control on the detector itself: without this, a broken grep
# pattern that never matches anything would make every "no AVX found"
# result above unproven (the exact reasoning verify-sidecar-isa.sh's own
# POSITIVE_CONTROL section already uses on a real haswell build).
if has_avx_or_above "$haswell_positive"; then
  printf '  ok   positive control: haswell-style fixture shows an AVX hit, the detector itself works\n'; pass_count=$((pass_count + 1))
else
  printf '  FAIL positive control: haswell-style fixture shows NO AVX hit, has_avx_or_above is broken\n' >&2; fail_count=$((fail_count + 1))
fi

echo "== has_avx512_or_above: AUFLAGE c, freestanding opmask/k0/AVX512VL on ymm/xmm =="
avx512vl_mnemonic_ymm="$(fixture avx512vl-mnemonic-on-ymm.disasm.txt)"
avx512_opmask_freestanding="$(fixture avx512-opmask-freestanding-leak-in-avx2.disasm.txt)"
avx512_extended_register="$(fixture avx512-extended-register-leak-in-avx2.disasm.txt)"
if has_avx512_or_above "$avx512vl_mnemonic_ymm"; then
  printf '  ok   an AVX-512-exclusive mnemonic (vpternlogd) on %%ymm, no zmm/mask in sight, IS caught (AVX512VL)\n'; pass_count=$((pass_count + 1))
else
  printf '  FAIL vpternlogd on %%ymm should be caught by has_avx512_or_above\n' >&2; fail_count=$((fail_count + 1))
fi
if has_avx512_or_above "$avx512_opmask_freestanding"; then
  printf '  ok   a freestanding opmask operand (kmovw %%eax,%%k1, no braces) IS caught\n'; pass_count=$((pass_count + 1))
else
  printf '  FAIL freestanding %%k1 opmask operand should be caught by has_avx512_or_above\n' >&2; fail_count=$((fail_count + 1))
fi
if has_avx512_or_above "kmovw %eax,%k0"; then
  printf '  ok   k0 specifically (previously excluded, k1-7 only) IS caught\n'; pass_count=$((pass_count + 1))
else
  printf '  FAIL k0 should be caught by has_avx512_or_above\n' >&2; fail_count=$((fail_count + 1))
fi
if has_avx512_or_above "$avx512_extended_register"; then
  printf '  ok   an extended EVEX-only register (%%ymm16-%%ymm31) with no mask/mnemonic hint IS caught\n'; pass_count=$((pass_count + 1))
else
  printf '  FAIL %%ymm16.. register should be caught by has_avx512_or_above (VEX cannot address it at all)\n' >&2; fail_count=$((fail_count + 1))
fi
if has_avx512_or_above "$clean_avx2"; then
  printf '  FAIL clean-avx2 fixture must still NOT trip the widened has_avx512_or_above\n' >&2; fail_count=$((fail_count + 1))
else
  printf '  ok   clean-avx2 fixture still does not trip the widened has_avx512_or_above (not over-firing)\n'; pass_count=$((pass_count + 1))
fi

echo "== has_avx2_marker: AUFLAGE d, precise vp*-integer-on-ymm detection =="
avx2_integer_ymm_leak="$(fixture avx2-integer-ymm-leak-in-avx-only.disasm.txt)"
clean_avx_only_vp_exceptions="$(fixture clean-avx-only-vp-exceptions.disasm.txt)"
if has_avx2_marker "$avx2_integer_ymm_leak"; then
  printf '  ok   a plain vp*-integer mnemonic (vpaddd, not in the curated AVX2_ONLY_MNEMONICS list) on %%ymm IS caught\n'; pass_count=$((pass_count + 1))
else
  printf '  FAIL vpaddd on %%ymm should be caught by has_avx2_marker (plain AVX defines no 256-bit integer op at all)\n' >&2; fail_count=$((fail_count + 1))
fi
if has_avx2_marker "$clean_avx_only_vp_exceptions"; then
  printf '  FAIL vpermilps/vptest on %%ymm are legal under plain AVX and must NOT trip has_avx2_marker (over-firing)\n' >&2; fail_count=$((fail_count + 1))
else
  printf '  ok   vpermilps/vptest on %%ymm (the documented float/permute exceptions) do not trip has_avx2_marker\n'; pass_count=$((pass_count + 1))
fi
if has_avx2_marker "  401000:	c5 f9 fe c1          	vpaddd %xmm1,%xmm0,%xmm0"; then
  printf '  FAIL vpaddd on %%xmm (legal under plain AVX at 128 bits) must NOT trip has_avx2_marker\n' >&2; fail_count=$((fail_count + 1))
else
  printf '  ok   vpaddd on %%xmm does not trip has_avx2_marker (128-bit vp* is plain AVX, not AVX2)\n'; pass_count=$((pass_count + 1))
fi

echo "== evaluate_module_asm: the new detection wired into the actual ceiling decision =="
set +e
out="$(evaluate_module_asm avx2 "$avx512vl_mnemonic_ymm" "avx512vl-leak")"; status=$?
set -e
assert_eq "avx2/avx512vl-mnemonic-on-ymm exits 1 (RED PROBE, AUFLAGE c wired in)" "1" "$status"
assert_eq "avx2/avx512vl-mnemonic-on-ymm verdict text (RED PROBE)" "FAIL: avx512vl-leak contains an AVX-512 instruction; this tier (AVX2 at most) must never reach AVX-512" "$out"

set +e
out="$(evaluate_module_asm avx2 "$avx512_opmask_freestanding" "opmask-leak")"; status=$?
set -e
assert_eq "avx2/opmask-freestanding-leak exits 1 (RED PROBE)" "1" "$status"

set +e
out="$(evaluate_module_asm avx-only "$avx2_integer_ymm_leak" "vp-ymm-leak")"; status=$?
set -e
assert_eq "avx-only/vp-integer-on-ymm-leak exits 1 (RED PROBE, AUFLAGE d wired in)" "1" "$status"
assert_eq "avx-only/vp-integer-on-ymm-leak verdict text (RED PROBE)" "FAIL: vp-ymm-leak contains an AVX2-only instruction; this tier (SSE42 AVX F16C FMA at most) must never reach AVX2" "$out"

out="$(evaluate_module_asm avx-only "$clean_avx_only_vp_exceptions" "clean-vp-exceptions")"; status=$?
assert_eq "avx-only/clean-vp-exceptions (vpermilps, vptest) still exits 0 (not over-firing)" "0" "$status"

echo "== evaluate_module_asm (the actual per-tier ceiling decision) =="
out="$(evaluate_module_asm baseline "$clean_baseline" "clean-baseline")"; status=$?
assert_eq "baseline/clean exits 0" "0" "$status"
assert_eq "baseline/clean verdict text" "OK: clean-baseline carries no AVX-or-above instruction, as expected for a baseline module" "$out"

set +e
out="$(evaluate_module_asm baseline "$avx_hit_baseline" "avx-hit-baseline")"; status=$?
set -e
assert_eq "baseline/regressed exits 1 (RED PROBE)" "1" "$status"
assert_eq "baseline/regressed verdict text (RED PROBE)" "FAIL: avx-hit-baseline contains an AVX-or-above instruction, this is supposed to be ISA-neutral baseline code (loaded by every CPU regardless of age)" "$out"

out="$(evaluate_module_asm avx-only "$clean_avx_only" "clean-avx-only")"; status=$?
assert_eq "avx-only/clean exits 0" "0" "$status"

set +e
out="$(evaluate_module_asm avx-only "$avx2_leak" "avx2-leak")"; status=$?
set -e
assert_eq "avx-only/avx2-leak exits 1 (RED PROBE)" "1" "$status"
assert_eq "avx-only/avx2-leak verdict text (RED PROBE)" "FAIL: avx2-leak contains an AVX2-only instruction; this tier (SSE42 AVX F16C FMA at most) must never reach AVX2" "$out"

out="$(evaluate_module_asm avx2 "$clean_avx2" "clean-avx2")"; status=$?
assert_eq "avx2/clean exits 0 (negative control: a real haswell-shaped body is not flagged)" "0" "$status"

set +e
out="$(evaluate_module_asm avx2 "$avx512_leak" "avx512-leak")"; status=$?
set -e
assert_eq "avx2/avx512-leak exits 1 (RED PROBE)" "1" "$status"
assert_eq "avx2/avx512-leak verdict text (RED PROBE)" "FAIL: avx512-leak contains an AVX-512 instruction; this tier (AVX2 at most) must never reach AVX-512" "$out"

out="$(evaluate_module_asm avx512 "$clean_avx512" "clean-avx512")"; status=$?
assert_eq "avx512/top-tier always exits 0 (nothing to cap above AVX-512)" "0" "$status"

set +e
out="$(evaluate_module_asm made-up-role "$clean_baseline" "some-module")"; status=$?
set -e
assert_eq "unrecognised role fails closed (RED PROBE)" "1" "$status"
assert_eq "unrecognised role verdict text (RED PROBE)" 'FAIL: some-module has an unrecognised ISA role "made-up-role", refusing to guess a ceiling (fail closed)' "$out"

echo "== check_min_disasm_lines (BLOCKER B1: empty/near-empty disassembly must be RED) =="
clean_baseline_realistic="$(fixture clean-baseline-realistic-size.disasm.txt)"

set +e
out="$(check_min_disasm_lines "" "empty-module")"; status=$?
set -e
assert_eq "empty disassembly exits 1 (RED PROBE, the exact bug the review measured: evaluate_module_asm baseline \"\" used to exit 0)" "1" "$status"
assert_eq "empty disassembly verdict text (RED PROBE)" 'FAIL: empty-module: only 0 disassembled instruction line(s) found (need >= 200); an empty or near-empty disassembly is not proof the module carries no AVX-or-above instruction, it means the disassembler produced nothing usable (crashed, printed an error, or was fed the wrong file) and every ISA verdict for this module is unproven' "$out"

set +e
out="$(check_min_disasm_lines "$clean_baseline" "too-short-module")"; status=$?
set -e
assert_eq "a too-short real-looking disassembly (7 lines, below MIN_DISASM_LINES=200) exits 1 (RED PROBE)" "1" "$status"

# N1 (Nachreview Runde 2): fixture grew from 21 to 234 instruction lines so
# it still clears the raised MIN_DISASM_LINES=200 (the real Linux run's
# smallest module measured 761).
out="$(check_min_disasm_lines "$clean_baseline_realistic" "realistic-module")"; status=$?
assert_eq "a realistically-sized disassembly (234 lines) exits 0" "0" "$status"

# The deliberately-tiny decision-logic fixtures above (5-7 lines each) are
# legitimate inputs to evaluate_module_asm/has_avx*_or_above directly (they
# test the CLASSIFICATION rule, not module size), so check_min_disasm_lines
# takes an explicit lower bound here the same way win-isa-guard.mjs's own
# red probe passes --min-lines 0 for the same reason
# (verify-sidecar-isa.sh:616-619).
out="$(check_min_disasm_lines "$clean_baseline" "tiny-logic-fixture" 5)"; status=$?
assert_eq "the same 7-line fixture passes with an explicit min of 5 (tiny logic fixtures are not themselves the bug)" "0" "$status"

echo "== check_base_module_coverage (BLOCKER A2: a missing expected base module must be RED) =="
full_base_csv="$(printf '%s\n' "${EXPECTED_BASE_LINUX_MODULES[@]}")"
out="$(check_base_module_coverage "$full_base_csv")"; status=$?
assert_eq "all 7 expected base modules present exits 0" "0" "$status"

missing_mtmd_csv="$(printf '%s\n' ggml ggml-base ggml-vulkan llama llama-common llama-server-impl)"
set +e
out="$(check_base_module_coverage "$missing_mtmd_csv")"; status=$?
set -e
assert_eq "mtmd missing (e.g. dropped by a stage bug) exits 1 (RED PROBE, AUFLAGE b)" "1" "$status"
assert_eq "mtmd missing verdict text (RED PROBE)" "FAIL: expected base Linux module(s) missing from the companions directory: mtmd (EXPECTED_BASE_LINUX_MODULES); a partial build or a stage step silently dropping a file must turn this guard red, not pass on whatever happened to be there" "$out"

duplicate_csv="$(printf '%s\n' ggml ggml ggml-base ggml-vulkan llama llama-common llama-server-impl mtmd)"
set +e
out="$(check_base_module_coverage "$duplicate_csv")"; status=$?
set -e
assert_eq "a name matched twice (count mismatch) exits 1 (RED PROBE)" "1" "$status"

echo
echo "$pass_count passed, $fail_count failed"
[ "$fail_count" -eq 0 ] || exit 1
echo "OK: isa-guard-linux-rules.sh decision logic proven against fixtures (module classification, all four tier ceilings, positive/negative controls, red probes), no ELF file or objdump needed"
