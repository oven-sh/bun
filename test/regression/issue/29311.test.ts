import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/29311
test("issue #29311: minify prefers scientific notation when shorter", async () => {
  using dir = tempDir("issue-29311-minify", {
    "index.js": [
      "console.log(1e300);",
      "console.log(0.00001);",
      "console.log(0.0000001);",
      "console.log(100000);",
      "console.log(1000000000000);",
      "console.log(0.5);",
      "console.log(123);",
      "console.log(3.14159);",
      "console.log(-1e300);",
      "console.log(1.5e20);",
      // Integer fast-path coverage: `20000` and `2000000000` hit the
      // `10001...99999` and `1_000_000_001...9_999_999_999` arms of the
      // fast-path switch, which used to call formatUnsignedIntegerBetween
      // and emit full decimal regardless of trailing zeros.
      "console.log(20000);",
      "console.log(2000000000);",
    ].join("\n"),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--minify", `${dir}/index.js`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // stderr may carry ASAN warnings under debug builds, so don't assert
  // it's empty — rely on exitCode + stdout shape instead.
  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  void _stderr;

  // The bug: 1e300 was expanded to 301 digits. Guard against any regression
  // that re-introduces long runs of zeros in the minified output.
  expect(stdout).not.toMatch(/0{20,}/);

  // Each value should be in whichever form is shortest. `3.14159` and `123`
  // stay decimal; everything else collapses to scientific / leading-dot.
  // Anchor `1e300` to its standalone call site so the presence of `-1e300`
  // can't trivially satisfy this assertion.
  expect(stdout).toContain("console.log(1e300)");
  expect(stdout).toContain("1e-5");
  expect(stdout).toContain("1e-7");
  expect(stdout).toContain("1e5");
  expect(stdout).toContain("1e12");
  // Integer fast-path ranges (20000, 2000000000) must also pick scientific.
  expect(stdout).toContain("2e4");
  expect(stdout).toContain("2e9");
  // `0.5` → `.5` specifically at the standalone call site. A substring
  // match on `.5` would trivially pass because `1.5e20` also contains it.
  expect(stdout).toContain("console.log(.5)");
  expect(stdout).not.toContain("console.log(0.5)");
  expect(stdout).toContain("123");
  expect(stdout).toContain("3.14159");
  expect(stdout).toContain("-1e300");
  // 1.5e20 (6 chars) is far shorter than the 21-digit decimal form.
  expect(stdout).toContain("1.5e20");
  expect(exitCode).toBe(0);

  // Sanity: the minified output should also be valid JavaScript that evaluates
  // to the same numbers, not something mangled.
  await using runProc = Bun.spawn({
    cmd: [bunExe(), "-e", stdout],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [runStdout, _runStderr, runExitCode] = await Promise.all([
    runProc.stdout.text(),
    runProc.stderr.text(),
    runProc.exited,
  ]);
  void _runStderr;
  expect(runStdout.split("\n").filter(Boolean)).toEqual([
    "1e+300",
    "0.00001",
    "1e-7",
    "100000",
    "1000000000000",
    "0.5",
    "123",
    "3.14159",
    "-1e+300",
    "150000000000000000000",
    "20000",
    "2000000000",
  ]);
  expect(runExitCode).toBe(0);
});

// Non-minified output should preserve the historical `{d}` decimal form so
// existing source maps / snapshots don't shift under users. This is a guard
// against over-eager normalisation that would change unrelated output.
test("issue #29311: non-minified output keeps decimal form", async () => {
  using dir = tempDir("issue-29311-plain", {
    "index.js": "console.log(1.5e20);",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", `${dir}/index.js`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  void _stderr;

  // Without --minify, 1.5e20 stays in its full decimal form as before.
  expect(stdout).toContain("150000000000000000000");
  expect(exitCode).toBe(0);
});

// The optimisation fires when either `minify_whitespace` OR `minify_syntax`
// is on. Guard that each flag standalone also collapses `1e300`, so wiring
// that accidentally required both flags together wouldn't slip through.
test.each([["--minify-syntax"], ["--minify-whitespace"]])("issue #29311: %s alone still shortens 1e300", async flag => {
  using dir = tempDir(`issue-29311${flag}`, {
    "index.js": "console.log(1e300);",
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", flag, `${dir}/index.js`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  void _stderr;
  expect(stdout).toContain("1e300");
  expect(stdout).not.toMatch(/0{20,}/);
  expect(exitCode).toBe(0);
});
