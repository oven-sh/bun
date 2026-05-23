import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

const { minifyTest } = cssInternals;

// Regression test for unbounded memory growth when compiling CSS nesting away
// for older browser targets.
//
// Compiling nesting multiplies selectors: every selector of a nested rule is
// combined with every selector of every ancestor rule, either by splitting
// rules apart during minification (targets without `:is()` support, which
// includes `bun build`'s default browser targets) or by substituting `&` with
// `:is(<parent list>)` while printing (targets with `:is()` but without CSS
// nesting). The expansion is the product of the selector list lengths along
// the nesting chain, so ~1KB of adversarial CSS — 26 nested two-selector
// `::part()` lists — demanded 2^26 selector combinations and grew past 4GB of
// memory. Such rules are now rejected with an error once they exceed 65536
// combinations instead of exhausting memory.

const EXPANSION_ERROR = "selector combinations";

// Two selectors per nesting level; `::part()` cannot be wrapped in `:is()`, so
// downleveling must combine every parent selector with every child selector.
function nestedPartLists(depth: number): string {
  return ".foo::part(header), .foo::part(body) {\n".repeat(depth) + "display: none\n}";
}

async function buildCSS(name: string, css: string) {
  using dir = tempDir("css-nesting-expansion-limit", { [name]: css });
  const outdir = path.join(String(dir), "out");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", path.join(String(dir), name), "--outdir", outdir],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    // Kill switch: before the fix this build allocated gigabytes while
    // expanding 2^26 selector combinations. Let the child terminate itself so
    // a regression fails the assertions below instead of exhausting memory.
    timeout: 15_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test("nested multi-selector lists error instead of exhausting memory when splitting for old targets", () => {
  // chrome 87 has no `:is()` support, so every nested rule is split into one
  // rule per selector, cloning its nested subtree each time: 2^19 rules.
  expect(() => minifyTest(nestedPartLists(19), "", { chrome: 87 << 16 })).toThrow(EXPANSION_ERROR);
});

test("nested multi-selector lists error instead of exhausting memory when compiling nesting with :is()", () => {
  // chrome 100 supports `:is()` but not CSS nesting, so `&` is substituted
  // with `:is(<parent list>)` at print time, doubling the output per level.
  expect(() => minifyTest(nestedPartLists(18), "", { chrome: 100 << 16 })).toThrow(EXPANSION_ERROR);
});

test("bun build rejects exponential nesting expansion instead of running out of memory", async () => {
  // The fuzzer-reported input: 26 nested two-selector `::part()` lists (~1KB)
  // built with bun build's default browser targets.
  const { stderr, exitCode } = await buildCSS("part-nesting.css", nestedPartLists(26));
  expect(stderr).toContain(EXPANSION_ERROR);
  expect(exitCode).toBe(1);
});

test("shallow nested multi-selector lists still expand for old targets", () => {
  const output = minifyTest(nestedPartLists(3), "", { chrome: 87 << 16 });
  // The cartesian product is still produced when it is small.
  expect(output).toContain(".foo::part(header) .foo::part(header)");
  expect(output).toContain(".foo::part(body) .foo::part(body)");
  expect(output).toContain("display:none");
});

test("deep nesting with single-selector lists does not hit the limit", () => {
  // The expansion is the product of selector list lengths, so single-selector
  // lists stay linear no matter how deep they nest.
  const input = ".foo::part(header) {\n".repeat(40) + "display: none\n}";
  const output = minifyTest(input, "", { chrome: 87 << 16 });
  expect(output).toContain("display:none");
});

test("deeply nested multi-selector lists are fine when no targets are configured", () => {
  // Without browser targets nothing is downleveled, so nesting is preserved
  // as written and no expansion takes place.
  const output = minifyTest(nestedPartLists(26), "", "");
  expect(output).toContain("&");
  expect(output).toContain("display:none");
});

test("deeply nested multi-selector lists are fine when targets support CSS nesting", () => {
  const output = minifyTest(nestedPartLists(26), "", { chrome: 130 << 16 });
  expect(output).toContain("display:none");
});
