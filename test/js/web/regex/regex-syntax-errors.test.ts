// SyntaxError parity for borderline and invalid patterns: for every entry in
// differential/error-corpus.mjs, bun must accept or reject exactly as the
// recorded node/V8 outcome (differential/error-oracle.generated.mjs), and
// where accepted, produce the same normalized source/flags.
//
// The oracle is a checked-in snapshot (this corpus is static). Regenerate it
// after editing the corpus:
//   node test/js/web/regex/differential/run-error-corpus.mjs   # inspect
//   (regen command in error-oracle.generated.mjs header)
import { expect, test } from "bun:test";
import { errorCorpus } from "./differential/error-corpus.mjs";
import { oracle } from "./differential/error-oracle.generated.mjs";

// Deliberate deltas from node 22's V8, keyed like the oracle. `expected` is
// what bun must produce instead.
const deltas: Record<string, unknown> = {
  // JSC supports duplicate named groups across alternatives (newer spec); node 22 does not.
  [JSON.stringify(["(?<a>x)|(?<a>y)", ""])]: { string: "/(?<a>x)|(?<a>y)/", flags: "" },
  // JSC supports regexp pattern modifiers (?i:...) etc.; node 22 does not.
  [JSON.stringify(["(?i:a)", ""])]: { string: "/(?i:a)/", flags: "" },
  [JSON.stringify(["(?-i:a)", ""])]: { string: "/(?-i:a)/", flags: "" },
  [JSON.stringify(["(?im-s:a)", ""])]: { string: "/(?im-s:a)/", flags: "" },
  [JSON.stringify(["(?i:(?-i:a))", ""])]: { string: "/(?i:(?-i:a))/", flags: "" },
  // Quantifier bound beyond 2^53: V8 clamps and accepts; JSC rejects on
  // overflow. Implementation-defined limit, recorded here rather than asserted
  // as a bug in either engine.
  [JSON.stringify(["a{99999999999999999999}", ""])]: { error: "SyntaxError" },
};

test("regex construction / SyntaxError parity with V8", () => {
  const mismatches: string[] = [];
  for (const [source, flags] of errorCorpus) {
    const key = JSON.stringify([source, flags]);
    const expected = (deltas[key] ?? oracle[key]) as { error?: string; string?: string; flags?: string };
    let actual: { error?: string; string?: string; flags?: string };
    try {
      const re = new RegExp(source, flags);
      actual = { string: String(re), flags: re.flags };
    } catch (e: any) {
      actual = { error: e?.constructor?.name ?? String(e) };
    }
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      mismatches.push(
        `${JSON.stringify(source)} /${flags}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  }
  expect(mismatches).toEqual([]);
});
