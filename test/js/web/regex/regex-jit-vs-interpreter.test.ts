// The RegExp engine has two tiers: the Yarr JIT and the bytecode interpreter
// (used for patterns the JIT cannot compile, and as a fallback). They must
// agree exactly. This runs the whole pinned corpus (regressions, neighborhoods,
// error parity) once with the JIT and once with it disabled
// (BUN_JSC_useRegExpJIT=0) and requires identical results.
//
// A mismatch here is a real engine bug in one of the two tiers even when both
// happen to disagree with V8 -- record it in
// test/js/third_party/v8-regexp/KNOWN-DIVERGENCES.md.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

const dump = join(import.meta.dir, "differential", "dump-corpus-results.mjs");

async function dumpWith(extraEnv: Record<string, string>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), dump],
    env: { ...bunEnv, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// Corpus entries where the two tiers are KNOWN to disagree today (real bugs
// in one tier, documented in KNOWN-DIVERGENCES.md). Exact names, plus name
// prefixes for whole families (the interpreter's `a|ab|^a` leftmost-wins bug,
// KNOWN-DIVERGENCES #3, also affects that case's neighborhood variants).
const knownTierDivergence = new Set<string>([
  "interp-leftmost-alt-with-caret-alternative", // interpreter wrong (#3)
  "jit-nonword-boundary-optional-BOL-group", // JIT wrong (#4)
  "jit-nonword-boundary-lazy-BOL-group", // JIT wrong (#4)
  "plus-loop-quantified-class-boundary-with-counted-capture", // JIT wrong (#8)
  "empty-iteration-clears-capture", // JIT keeps a stale empty capture; interpreter clears it (#7)
  "jit-optional-group-containing-only-BOL", // JIT wrong (#9)
  "jit-star-group-containing-only-BOL", // JIT wrong (#9)
  "split-optional-named-BOL-group", // JIT wrong (#9)
  "jit-u-mode-astral-alternative-with-inverted-class-sibling", // JIT wrong (#10)
  "jit-u-mode-astral-alternative-with-dot-sibling", // JIT wrong (#10)
  "jit-u-mode-astral-alternative-wrong-alternative", // JIT wrong (#10)
  "match-end-wraparound-lastindex", // JIT wrong; interpreter correct
  "jit-capturing-group-only-BOL-star", // JIT wrong (#9 family)
  "jit-capturing-group-only-BOL-star-v", // JIT wrong (#9 family)
  "jit-u-mode-empty-match-position-in-pair", // JIT differs from interp+V8
  "lazy-counted-loop-nested-captures", // tiers disagree (both differ from V8 in stock bun)
  "over-match-backref-lookahead-lazy-quant", // tiers disagree
]);
// Whole families known to differ between tiers: the interpreter's a|ab|^a
// leftmost-wins bug (#3) and its neighbors, and every neighbor derived from a
// known bun failure ("known:" lineage) -- those bugs are single-tier, so the
// tiers disagree across their halos by construction.
const knownTierDivergentFamilies = ["leftmost-alt-wins-anchor~", "known:"];

test("regex JIT and interpreter tiers agree on the corpus", async () => {
  const jit = await dumpWith({});
  const interp = await dumpWith({ BUN_JSC_useRegExpJIT: "0" });
  expect(jit.exitCode).toBe(0);
  expect(interp.exitCode).toBe(0);

  const jitLines = jit.stdout.trim().split("\n");
  const interpLines = interp.stdout.trim().split("\n");
  expect(interpLines.length).toBe(jitLines.length);

  const mismatches: string[] = [];
  for (let i = 0; i < jitLines.length; i++) {
    if (jitLines[i] !== interpLines[i]) {
      let name = "?";
      try {
        const parsed = JSON.parse(jitLines[i]);
        name = parsed.name ?? `${parsed.source} /${parsed.flags}`;
      } catch {}
      if (knownTierDivergence.has(name)) continue;
      if (knownTierDivergentFamilies.some(prefix => name.startsWith(prefix))) continue;
      mismatches.push(`${name}\n    jit   : ${jitLines[i].slice(0, 300)}\n    interp: ${interpLines[i].slice(0, 300)}`);
    }
  }
  expect(mismatches).toEqual([]);
}, 120_000);
