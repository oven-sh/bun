import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

const { minifyTest } = cssInternals;

// Regression tests for exponential output/time when printing nested style
// rules whose selectors need vendor-prefix downleveling.
//
// When browser targets require compiling CSS nesting away AND a selector needs
// prefixed fallbacks (e.g. `:is()` → `:-webkit-any()`/`:-moz-any()`), the
// printer emits one copy of a style rule per vendor prefix. Each nested rule
// used to start its own prefix loop inside every ancestor pass, re-printing
// its entire subtree prefixes^depth times even though the copies are
// byte-identical (only the innermost pass selects the prefixed form). A
// 189-byte stylesheet with 18 nested `:is()` levels kept `bun build` spinning
// for minutes and the output grew as 3^depth. Nested rules now inherit the
// ancestor's active prefix pass instead of multiplying it, so each distinct
// prefix variant is printed exactly once.

// safari 13 does not support `:is()` or CSS nesting, so nesting is compiled
// away and `:is()` is downleveled to `:-webkit-any()` + unprefixed variants.
const SAFARI_13 = { safari: 13 << 16 };

test("nested rules print one copy per vendor prefix, not per ancestor pass", () => {
  expect(minifyTest(".a:is(b){color:red}", "", SAFARI_13)).toBe(".a:-webkit-any(b){color:red}.a:is(b){color:red}");

  // Before the fix these printed 4 and 8 rules (every copy after the first a
  // byte-for-byte duplicate); each prefix variant must appear exactly once.
  expect(minifyTest(".a:is(b){.c:is(d){color:red}}", "", SAFARI_13)).toBe(
    ".a:-webkit-any(b) .c:-webkit-any(d){color:red}.a:is(b) .c:is(d){color:red}",
  );
  expect(minifyTest(".a:is(b){.c:is(d){.e:is(f){color:red}}}", "", SAFARI_13)).toBe(
    ".a:-webkit-any(b) .c:-webkit-any(d) .e:-webkit-any(f){color:red}.a:is(b) .c:is(d) .e:is(f){color:red}",
  );
});

test("a rule with declarations keeps a prefixed copy of nested rules per parent variant", () => {
  // The parent needs two prefix passes and the nested rule participates in
  // each of them (it has no prefix needs of its own), so all four rules are
  // distinct and must be kept.
  expect(minifyTest(".a:is(b){color:blue;.c{color:red}}", "", SAFARI_13)).toBe(
    ".a:-webkit-any(b){color:#00f}.a:-webkit-any(b) .c{color:red}.a:is(b){color:#00f}.a:is(b) .c{color:red}",
  );
});

test("deeply nested :is() rules don't hang bun build", async () => {
  const depth = 18;
  const css = ".x:is(a){".repeat(depth) + "color:red" + "}".repeat(depth);

  using dir = tempDir("css-nested-vendor-prefix", { "deep.css": css });
  const outdir = path.join(String(dir), "out");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", path.join(String(dir), "deep.css"), "--outdir", outdir, "--minify"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    // Kill switch: before the fix this build re-printed the subtree 3^18
    // times and effectively never finished. Let the child terminate itself so
    // a regression fails the assertions below instead of hanging the runner.
    timeout: 20_000,
    killSignal: "SIGKILL",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error");
  expect(exitCode).toBe(0);

  // One rule per needed prefix (-webkit-any, -moz-any, :is), each chain
  // printed exactly once.
  const output = await Bun.file(path.join(outdir, "deep.css")).text();
  const expected =
    [
      Array(depth).fill(".x:-webkit-any(a)").join(" "),
      "{color:red}",
      Array(depth).fill(".x:-moz-any(a)").join(" "),
      "{color:red}",
      Array(depth).fill(".x:is(a)").join(" "),
      "{color:red}",
    ].join("") + "\n";
  expect(output).toBe(expected);
});

test("fuzzer-found deeply nested input completes with browser targets", async () => {
  // 314-byte minimized fuzzer input: ~21 nested rules, all unclosed at EOF,
  // each selector containing `:is()`.
  const unit = "co.foo:is(a){";
  const input =
    "{" +
    unit.repeat(5) +
    "co.foo:is(aaa){" +
    unit.repeat(5) +
    "co.foo:iisco.foo:is(a){" +
    unit.repeat(9) +
    "color:#grid-column-startff0}";

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { cssInternals } = require("bun:internal-for-testing");
       const targets = { chrome: 95 << 16, safari: 13 << 16, firefox: 78 << 16, edge: 88 << 16, ios_saf: 13 << 16, samsung: 14 << 16, opera: 80 << 16, android: 95 << 16, ie: 11 << 16 };
       const out = cssInternals.minifyTest(${JSON.stringify(input)}, "", targets);
       console.log(out.length);`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    // Kill switch: before the fix this call spun inside the CSS printer for
    // minutes; kill it so a regression fails fast instead of hanging.
    timeout: 20_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  // Output stays linear in the input size (two prefix variants of one rule
  // chain); before the fix it was 2^21 copies.
  expect(Number(stdout.trim())).toBeGreaterThan(0);
  expect(Number(stdout.trim())).toBeLessThan(5_000);
});
