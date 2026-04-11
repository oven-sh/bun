// https://github.com/oven-sh/bun/issues/29175

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("console.log(new Array(N)) on a huge sparse array is fast (#29175)", async () => {
  // 1.67 billion — the number from the issue. The 10s threshold is
  // >50x the post-fix time on any runner and still well under the
  // pre-fix ~16s, so any regression back to the O(N) path trips it
  // without being flaky on slow CI.
  const code = `
    const start = performance.now();
    console.log(new Array(1_677_721_600));
    const elapsed = performance.now() - start;
    process.stderr.write("ELAPSED_MS=" + elapsed + "\\n");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("1677721600 x empty items");
  expect(exitCode).toBe(0);

  const match = stderr.match(/ELAPSED_MS=(\d+(?:\.\d+)?)/);
  expect(match).not.toBeNull();
  const elapsedMs = Number(match![1]);
  expect(elapsedMs).toBeLessThan(10_000);
});

test("console.log on a sparse array with populated slots still prints values (#29175)", async () => {
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

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain('"start"');
  expect(stdout).toContain('"middle"');
  expect(stdout).toContain('"end"');
  // Gaps between populated indices must still render as hole summaries,
  // not get collapsed by the hole-skipping fast path.
  expect(stdout).toContain("499999 x empty items");
  expect(stdout).toContain("499998 x empty items");
  expect(exitCode).toBe(0);
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

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("42 x empty items");
  expect(stdout).toContain("empty item"); // singular for length 1
  expect(stdout).toContain("[]");
  expect(stdout).toContain("1, 2, 3");
  expect(exitCode).toBe(0);
});
