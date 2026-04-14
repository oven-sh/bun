import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/29311
// Minifier expanded scientific-notation floats into their full decimal form
// even when the scientific form was strictly shorter (`1e300` became 301
// digits). Pick whichever representation is shorter, matching esbuild.
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
    ].join("\n"),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--minify", `${dir}/index.js`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  // The bug: 1e300 was expanded to 301 digits. Guard against any regression
  // that re-introduces long runs of zeros in the minified output.
  expect(stdout).not.toMatch(/0{20,}/);

  // Each value should be in whichever form is shortest. `3.14159` and `123`
  // stay decimal; everything else collapses to scientific / leading-dot.
  expect(stdout).toContain("1e300");
  expect(stdout).toContain("1e-5");
  expect(stdout).toContain("1e-7");
  expect(stdout).toContain("1e5");
  expect(stdout).toContain("1e12");
  expect(stdout).toContain(".5");
  expect(stdout).toContain("123");
  expect(stdout).toContain("3.14159");
  expect(stdout).toContain("-1e300");
  // 1.5e20 and 15e19 are both 6 chars — tie goes to decimal/scientific
  // depending on Zig's {e} output; both are acceptable.
  expect(stdout).toMatch(/1\.5e20|15e19/);

  // Sanity: the minified output should also be valid JavaScript that evaluates
  // to the same numbers, not something mangled.
  await using runProc = Bun.spawn({
    cmd: [bunExe(), "-e", stdout],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [runStdout, runStderr, runExitCode] = await Promise.all([
    runProc.stdout.text(),
    runProc.stderr.text(),
    runProc.exited,
  ]);
  // stderr may carry ASAN warnings under debug builds; only assert exit code.
  void runStderr;
  expect(runExitCode).toBe(0);
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
  ]);
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

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  // Without --minify, 1.5e20 stays in its full decimal form as before.
  expect(stdout).toContain("150000000000000000000");
});
