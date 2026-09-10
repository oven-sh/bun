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

/**
 * Best-of timing. Repeats only while a run is cheap, so a release build takes
 * several samples and a debug build takes one.
 */
async function bench<T>(run: () => T | Promise<T>): Promise<{ ms: number; result: T }> {
  let ms = Infinity;
  let spent = 0;
  let result!: T;
  for (let i = 0; i < 5 && spent < 400; i++) {
    const start = performance.now();
    result = await run();
    const elapsed = performance.now() - start;
    ms = Math.min(ms, elapsed);
    spent += elapsed;
  }
  return { ms, result };
}

test("merged enum declarations transpile in linear time", async () => {
  const n = 16_384;
  const merged = Buffer.alloc(n * 9, "enum E{}\n").toString();
  const distinct = Array.from({ length: n }, (_, i) => `enum E${i.toString(36)}{}\n`).join("");
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  transpiler.transformSync("enum Warmup {}");

  const baseline = await bench(() => transpiler.transformSync(distinct));
  const { ms, result: out } = await bench(() => transpiler.transformSync(merged));

  // One `var E;` for the whole chain, then one closure per block.
  expect(out).toStartWith("var E;\n((E) => {})(E ||= {});\n((E) => {})(E ||= {});\n");
  expect(out.indexOf("var E", 1)).toBe(-1);
  expect(out.length).toBe("var E;\n".length + n * "((E) => {})(E ||= {});\n".length);

  // ~0.8x with the fix; 10x (debug) to 30x (release) before it.
  expect(ms / baseline.ms).toBeLessThan(3);
});

test("top-level var re-declarations bundle in linear time", async () => {
  const n = 16_384;
  using dir = tempDir("redeclared-var-chain", {
    "same.ts": Buffer.alloc(n * 11, "var x = 1;\n").toString() + "export { x };\n",
    "distinct.ts": Array.from({ length: n }, (_, i) => `var x${i.toString(36)} = 1;\n`).join("") + "export { x0 };\n",
  });
  const build = async (file: string) => {
    const result = await Bun.build({ entrypoints: [join(String(dir), file)] });
    expect(result.success).toBeTrue();
    return result.outputs[0].text();
  };

  const baseline = await bench(() => build("distinct.ts"));
  const { ms, result: out } = await bench(() => build("same.ts"));

  expect(out).toContain("var x = 1;\nvar x = 1;\n");
  expect(out).toContain("export {\n  x\n};");

  // ~1x with the fix; 10x (debug) to 20x (release) before it.
  expect(ms / baseline.ms).toBeLessThan(4);
});
