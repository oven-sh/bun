// https://github.com/oven-sh/bun/issues/29175
//
// console.log(new Array(N)) on a huge sparse array was O(N) because
// ConsoleObject's array formatter looped i=0..len calling getDirectIndex
// for every slot. For `new Array(N)` (pure holes, no real storage) every
// call landed on the slow path for no reason.
//
// Fix: findNextPopulatedIndex inspects the JSArray butterfly directly and
// returns the next populated index — O(1) for ArrayWithUndecided /
// ArrayStorage with no vector + no sparse map. The formatter skips runs
// of holes in one step instead of per-index.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("console.log(new Array(N)) on a huge sparse array is fast (#29175)", async () => {
  // 1.67 billion — the number from the issue. Pre-fix this took ~16s;
  // post-fix it prints in well under a second. A generous 10s cap catches
  // the regression without being flaky on slow CI runners.
  const code = `
    const start = performance.now();
    console.log(new Array(1_677_721_600));
    const elapsed = performance.now() - start;
    // Emit the timing on a separate line so the test can parse it.
    process.stderr.write("ELAPSED_MS=" + elapsed + "\\n");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("1677721600 x empty items");

  const match = stderr.match(/ELAPSED_MS=(\d+(?:\.\d+)?)/);
  expect(match).not.toBeNull();
  const elapsedMs = Number(match![1]);

  // Pre-fix this spent ~16s walking every hole. A 10s cap is >50x the
  // post-fix time on any machine this test runs on — any regression back
  // to the O(N) path would blow well past it.
  expect(elapsedMs).toBeLessThan(10_000);
});

test("console.log on a sparse array with populated slots still prints values (#29175)", async () => {
  // Make sure the hole-skipping didn't break the normal output path:
  // mixed holes + values should still render `N x empty items` summaries
  // between each populated element.
  const code = `
    const a = new Array(1_000_000);
    a[0] = "start";
    a[500_000] = "middle";
    a[999_999] = "end";
    console.log(a);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain('"start"');
  expect(stdout).toContain('"middle"');
  expect(stdout).toContain('"end"');
  expect(stdout).toContain("499999 x empty items");
  expect(stdout).toContain("499998 x empty items");
});

test("console.log on a fully-empty `new Array(N)` prints the summary (#29175)", async () => {
  const code = `
    console.log(new Array(42));
    console.log(new Array(1));
    console.log([]);
    console.log([1, 2, 3]);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("42 x empty items");
  expect(stdout).toContain("empty item"); // singular for length 1
  expect(stdout).toContain("[]");
  expect(stdout).toContain("1, 2, 3");
});
