import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

// Regression test for unbounded memory growth when compiling CSS nesting for
// targets that don't support it (found by CSS fuzzing).
//
// When the browser targets lack native nesting support, every `&` in a nested
// rule's selector is replaced with the parent selector at print time. The
// parent selector itself may contain `&` referring to the grandparent, so a
// selector with multiple `&` references per nesting level expands to
// (references per level)^depth copies of its ancestors. A ~3 KB stylesheet
// with ~20 nesting levels of `&:is(.bar, &.baz)` makes the printer allocate an
// effectively unbounded output buffer: `bun build` (whose default browser
// target predates CSS nesting) and `minifyTest` with explicit targets both
// spin forever while memory grows.
//
// The serializer now budgets the number of `&` substitutions per rule prelude
// and reports "Maximum nesting expansion exceeded" instead of expanding
// without bound. Preserving nesting (no targets) and ordinary nested CSS with
// old targets are unaffected.

/** Deeply nested rules where each level references the parent twice (`&` appears twice per selector). */
function explodingNestedCss(depth: number): string {
  let css = "";
  for (let i = 0; i < depth; i++) {
    css += "&:is(.bar, &.baz) { color: red; }\n";
    css += "&:is(.bar, &.baz) { colo\n"; // unclosed block, same shape as the fuzz input
  }
  css += "&:is(.bar, &.baz) { color: red; }\n";
  css += "}";
  return css;
}

const minifyTestScript = `
  const { cssInternals } = require("bun:internal-for-testing");
  const depth = parseInt(process.env.NESTED_CSS_DEPTH, 10);
  const targets = process.env.NESTED_CSS_TARGETS === "1" ? { safari: 13 << 16 } : undefined;
  let css = "";
  for (let i = 0; i < depth; i++) {
    css += "&:is(.bar, &.baz) { color: red; }\\n";
    css += "&:is(.bar, &.baz) { colo\\n";
  }
  css += "&:is(.bar, &.baz) { color: red; }\\n";
  css += "}";
  try {
    const out = targets ? cssInternals.minifyTest(css, "", targets) : cssInternals.minifyTest(css, "");
    console.log("OK " + out.length);
  } catch (err) {
    console.log("ERR " + err.message);
  }
`;

async function runMinifyTest(depth: number, withTargets: boolean) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", minifyTestScript],
    env: {
      ...bunEnv,
      BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
      NESTED_CSS_DEPTH: String(depth),
      NESTED_CSS_TARGETS: withTargets ? "1" : "0",
    },
    stdout: "pipe",
    stderr: "pipe",
    // Kill switch: before the fix these spins were unbounded. Let the child be
    // killed so a regression fails the assertions below instead of hanging the
    // test runner and exhausting memory.
    timeout: 20_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

test.concurrent(
  "deeply nested `&` selectors error out instead of expanding without bound when compiling nesting",
  async () => {
    const { stdout, stderr, signalCode, exitCode } = await runMinifyTest(24, true);
    expect(stderr).toBe("");
    expect(signalCode).toBeNull(); // not killed by the kill switch
    expect(stdout).toContain("ERR Maximum nesting expansion exceeded");
    expect(exitCode).toBe(0);
  },
);

test.concurrent("deeply nested `&` selectors still minify when nesting is preserved (no targets)", async () => {
  const { stdout, stderr, signalCode, exitCode } = await runMinifyTest(24, false);
  expect(stderr).toBe("");
  expect(signalCode).toBeNull();
  // Without targets the nesting is preserved, so the output stays small.
  expect(stdout).toStartWith("OK ");
  expect(exitCode).toBe(0);
});

test.concurrent("ordinary nested CSS still compiles for older targets", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { cssInternals } = require("bun:internal-for-testing");
        // 8 levels deep, one parent reference per level: well within the budget.
        let css = ".a { color: red; ";
        for (let i = 0; i < 8; i++) css += "&:hover .b" + i + " { color: blue; ";
        css += "}".repeat(9);
        console.log(cssInternals.minifyTest(css, "", { safari: 13 << 16 }));
      `,
    ],
    env: { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  // The innermost rule's `&` chain is fully expanded.
  expect(stdout).toContain(".a:hover .b0:hover .b1:hover .b2:hover .b3:hover .b4:hover .b5:hover .b6:hover .b7");
  expect(exitCode).toBe(0);
});

test.concurrent("bun build does not hang on deeply nested `&` selectors with the default browser target", async () => {
  using dir = tempDir("css-nested-selector-expansion", {
    "explode.css": explodingNestedCss(24),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", path.join(String(dir), "explode.css"), "--outdir", path.join(String(dir), "out")],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    // Kill switch: before the fix this build spun forever while allocating.
    timeout: 20_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // The build must terminate on its own (the printer reports an error for the
  // runaway rule) instead of being killed by the 20s kill switch.
  expect(proc.signalCode).toBeNull();
  expect(exitCode).not.toBeNull();
});
