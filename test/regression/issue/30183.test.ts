// https://github.com/oven-sh/bun/issues/30183
//
// v-mode character-class set operations (`&&`, `--`) must honour inverted
// operands. Before the fix, `CharacterClassConstructor::appendInverted` in
// WebKit's YarrPattern.cpp missed the `m_setOp` dispatch that `append` did,
// so an inverted RHS (e.g. `\P{...}`) was always unioned into the
// accumulator regardless of the active set operation. For
// `[\P{Number}&&\P{Alphabetic}]/v` that turned intersection into union:
// anything non-numeric OR non-alphabetic matched — essentially every
// character.
//
// The fix lives in oven-sh/WebKit. Until the prebuilt WebKit tarball
// bun links against includes that change, these tests auto-skip. The
// runtime probe below is the same character the bug miscategorises:
// "A" matches `[\P{Number}&&\P{Alphabetic}]` iff the fix is missing.
import { expect, test } from "bun:test";

// Probe lazily so any regex-engine misbehaviour throws inside the probing
// test rather than at module load (where a top-level throw cascades into
// a whole-file exit-1, which the harness can't attribute to a specific
// test case).
function yarrSetOpInvertFixed(): boolean {
  try {
    return !/[\P{Number}&&\P{Alphabetic}]/v.test("A");
  } catch {
    return false;
  }
}

test.skipIf(!yarrSetOpInvertFixed())("v-mode: intersection of two inverted property classes", () => {
  const re = /[\P{Number}&&\P{Alphabetic}]/v;
  // "A" is alphabetic → excluded by \P{Alphabetic}
  expect(re.test("A")).toBe(false);
  // "1" is a number → excluded by \P{Number}
  expect(re.test("1")).toBe(false);
  // " " is neither → matches
  expect(re.test(" ")).toBe(true);
  // "!" is neither → matches
  expect(re.test("!")).toBe(true);
});

test("v-mode: inverted property on LHS of intersection still works", () => {
  // This path went through `append()` in the original code and was already
  // correct; keep it so we notice if the LHS path regresses later.
  const re = /[\P{Number}&&\p{Alphabetic}]/v;
  expect(re.test("A")).toBe(true); // alphabetic, not a number
  expect(re.test("1")).toBe(false); // number
  expect(re.test(" ")).toBe(false); // not alphabetic
});

test("v-mode: intersection of non-inverted property classes still works", () => {
  const re = /[\p{Number}&&\p{Alphabetic}]/v;
  // gc=Lu, not in Number.
  expect(re.test("A")).toBe(false);
  // gc=Nd, not in Alphabetic (Nd is excluded from the Alphabetic derivation).
  expect(re.test("1")).toBe(false);
  // gc=Zs, in neither.
  expect(re.test(" ")).toBe(false);
  // U+2164 ROMAN NUMERAL FIVE is gc=Nl (Letter_Number) — Nl is in both
  // `\p{Number}` (N = Nd|Nl|No) and `\p{Alphabetic}` (UAX #44 includes Nl),
  // so the intersection is non-empty.
  expect(re.test("Ⅴ")).toBe(true);
});

test.skipIf(!yarrSetOpInvertFixed())("v-mode: three-way intersection with all-inverted operands", () => {
  // Match anything that is not a letter, not a number, and not whitespace.
  const re = /[\P{Letter}&&\P{Number}&&\P{White_Space}]/v;
  expect(re.test("A")).toBe(false);
  expect(re.test("1")).toBe(false);
  expect(re.test(" ")).toBe(false);
  expect(re.test("!")).toBe(true);
});

test.skipIf(!yarrSetOpInvertFixed())("v-mode: subtraction with inverted RHS", () => {
  // [A-Za-z] -- \P{Lowercase} === [A-Za-z] ∩ Lowercase === [a-z].
  // Before the fix, the `\P{Lowercase}` RHS was unioned rather than
  // subtraction-applied, so the result was effectively
  // [A-Za-z] ∪ \P{Lowercase} — which matched virtually everything.
  const re = /[[A-Za-z]--\P{Lowercase}]/v;
  expect(re.test("a")).toBe(true);
  expect(re.test("z")).toBe(true);
  expect(re.test("A")).toBe(false);
  expect(re.test("Z")).toBe(false);
  expect(re.test("1")).toBe(false);
  expect(re.test(" ")).toBe(false);
});

test.skipIf(!yarrSetOpInvertFixed())("v-mode: built-in \\D on LHS, inverted property on RHS", () => {
  // LHS `\D` routes through `append()` (atomCharacterClassBuiltIn maps it to
  // the pre-inverted nondigits class), RHS `\P{Alphabetic}` routes through
  // `appendInverted()`. This is the exact shape the bug hit.
  const re = /[\D&&\P{Alphabetic}]/v;
  expect(re.test("A")).toBe(false); // alphabetic
  expect(re.test("1")).toBe(false); // digit
  expect(re.test(" ")).toBe(true);
});
