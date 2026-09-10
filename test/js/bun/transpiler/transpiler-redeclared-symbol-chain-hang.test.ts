// bun-fuzz: every re-declaration of a name that merges with the previous one
// (`enum E {} enum E {}`, top-level `var x; var x;`) links the old symbol to
// the new one, so n re-declarations form a link chain of length n. The parser
// walked that chain from the start for every declaration without shortening
// it, which made n merged `enum` blocks (transpile) and n top-level `var`
// re-declarations (bundle) O(n^2): 720 KB of `enum E{…}` blocks took 14 s.
//
// Each case is timed against the same number of distinctly-named declarations,
// which does the same work minus the chain, so the check does not depend on
// how fast the machine is.
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";

/** Best-of timing; repeats while cheap so release builds get several samples. */
async function bench(run: () => unknown, maxRuns = 5, budgetMs = 2000): Promise<number> {
  let best = Infinity;
  let spent = 0;
  for (let i = 0; i < maxRuns && spent < budgetMs; i++) {
    const start = performance.now();
    await run();
    const elapsed = performance.now() - start;
    best = Math.min(best, elapsed);
    spent += elapsed;
  }
  return best;
}

test("merged enum declarations transpile in linear time", async () => {
  const n = 24_000;
  const merged = Array.from({ length: n }, (_, i) => `enum E { M${i.toString(36)} }`).join("\n");
  const distinct = Array.from({ length: n }, (_, i) => `enum E${i.toString(36)} { M }`).join("\n");
  const transpiler = new Bun.Transpiler({ loader: "ts" });

  const out = transpiler.transformSync(merged);
  expect(out).toStartWith("var E;\n");
  expect(out).toContain(`E[E["M${(n - 1).toString(36)}"] = 0] = "M${(n - 1).toString(36)}";`);
  // One `var E;` for the whole chain, not one per block.
  expect(out.indexOf("var E", 1)).toBe(-1);

  const distinctMs = await bench(() => transpiler.transformSync(distinct));
  const mergedMs = await bench(() => transpiler.transformSync(merged));
  // ~0.9x with the fix; 10x (debug) to 40x (release) before it.
  expect(mergedMs / distinctMs).toBeLessThan(3);
}, 90_000);

test("top-level var re-declarations bundle in linear time", async () => {
  const n = 32_768;
  using dir = tempDir("redeclared-var-chain", {
    "same.ts": Buffer.alloc(n * 11, "var x = 1;\n").toString() + "export { x };\n",
    "distinct.ts": Array.from({ length: n }, (_, i) => `var x${i.toString(36)} = 1;\n`).join("") + "export { x0 };\n",
  });
  const build = async (file: string) => {
    const result = await Bun.build({ entrypoints: [join(String(dir), file)] });
    expect(result.success).toBeTrue();
  };

  const distinctMs = await bench(() => build("distinct.ts"));
  const sameMs = await bench(() => build("same.ts"));
  // ~1x with the fix; 30x (debug) to 50x (release) before it.
  expect(sameMs / distinctMs).toBeLessThan(4);
}, 90_000);
