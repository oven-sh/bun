// https://github.com/oven-sh/bun/issues/29175

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.concurrent("console.log(new Array(N)) on a huge sparse array is fast (#29175)", async () => {
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

  const match = stderr.match(/ELAPSED_MS=(\d+(?:\.\d+)?)/);
  expect(match).not.toBeNull();
  const elapsedMs = Number(match![1]);
  expect(elapsedMs).toBeLessThan(10_000);
  expect(exitCode).toBe(0);
});

test.concurrent("console.log on a sparse array with populated slots still prints values (#29175)", async () => {
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

test.concurrent(
  "console.log on a small sparse array with a non-primitive value keeps single-line output (#29175)",
  async () => {
    // Regression guard: the first-element heuristic that chooses
    // single-line vs multi-line bracket format keys off slot 0, not
    // first_populated. A small sparse array with an object at a
    // non-zero index must not flip to the multi-line layout just
    // because the formatter jumps past the leading holes.
    const code = `
    const a = new Array(5);
    a[3] = { x: 1 };
    console.log(a);
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Single-line layout: opens and closes on the same line, no bare
    // '[' line. The hole run renders between the brackets and the
    // actual object is printed — not dropped or collapsed. Objects
    // themselves break onto multiple lines inside the array, but the
    // array brackets stay single-line.
    expect(stdout).toContain("[ 3 x empty items,");
    expect(stdout).toContain("x: 1");
    expect(stdout).toContain("empty item ]");
    expect(stdout).not.toContain("[\n");
    expect(exitCode).toBe(0);
  },
);

test.concurrent("console.log on a sparse double array with NaN values renders correctly (#29175)", async () => {
  // ArrayWithDouble stores holes and user NaNs with identical bits. The
  // formatter must not skip populated slots by scanning for non-NaN —
  // doing so either mis-renders NaN as 'empty item' (return end) or
  // causes O(N²) re-scans in the caller's hole-skipping loop (return
  // start after scanning). The fast path for doubles must resolve
  // per-index via getDirectIndex. This test exercises both sides:
  // an explicit NaN rendered correctly, and a sparse double array
  // finishing in well under the pre-fix time budget.
  const code = `
    console.log([1.5, NaN, 2.5]);
    const a = [];
    a[0] = 1.5;
    a[100_000] = 2.5;
    const t = performance.now();
    console.log(a);
    process.stderr.write("ELAPSED_MS=" + (performance.now() - t) + "\\n");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("NaN");
  expect(stdout).toContain("1.5");
  expect(stdout).toContain("2.5");
  expect(stdout).toContain("99999 x empty items");

  const match = stderr.match(/ELAPSED_MS=(\d+(?:\.\d+)?)/);
  expect(match).not.toBeNull();
  const elapsedMs = Number(match![1]);
  // Pre-fix per-index path was O(N); a regression to O(N²) over a
  // 100K gap would blow far past this cap.
  expect(elapsedMs).toBeLessThan(5_000);
  expect(exitCode).toBe(0);
});

test.concurrent(
  "console.log elision past 100 items counts holes and doesn't double-emit a trailing summary (#29175)",
  async () => {
    // When the `... N more items` elision fires mid-iteration, the
    // count must include any pending hole run (the hole-jump already
    // advanced `i` past it) and `empty_start` must be cleared so the
    // post-loop trailing-holes block doesn't emit a second summary
    // over the same slots. Regression check for both failure modes:
    //
    //   bad 1: "... 50 more items, 100 x empty items"  (over-count, 250/200)
    //   bad 2: "... 50 more items"                     (under-count, 150/200)
    //   good:  "... 100 more items"                    (100 printed + 100 remaining)
    const code = `
    const a = Array.from({ length: 200 }, (_, i) => i);
    for (let k = 100; k < 150; k++) delete a[k];
    console.log(a);
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // 100 printed values followed by "... 100 more items" matches
    // Node's output for the same input (100 holes + 50 populated tail).
    expect(stdout).toContain("... 100 more items");
    // The trailing-holes block must not re-describe the same slots
    // the `more items` summary already covered.
    expect(stdout).not.toContain("x empty items");
    expect(exitCode).toBe(0);
  },
);

test.concurrent("console.log on a fully-empty `new Array(N)` prints the summary (#29175)", async () => {
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
  // Use the full bracketed form to assert the singular "empty item"
  // path — plain "empty item" would also match inside "42 x empty items".
  expect(stdout).toContain("[ empty item ]");
  expect(stdout).toContain("[]");
  expect(stdout).toContain("1, 2, 3");
  expect(exitCode).toBe(0);
});
