import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/36450
// A pending ref'd timer left behind by one test file made every subsequent
// test file that loads a module stall until the next JSC housekeeping timer
// (~100ms): after the file's entry promise settled, the runner's final
// blocking tick parked in the poller because the ref'd timer kept the loop
// active. The stall sits between module evaluation and the first test
// callback, so that gap is what we measure, paired against a control run
// without the pending timer so machine speed cancels out.
test("pending ref'd timer does not stall subsequent test files", async () => {
  const fileCount = 6;
  const files: Record<string, string> = {
    "leak.test.ts": `
      import { test, expect } from "bun:test";
      test("leaves one pending ref'd timer", () => {
        setTimeout(() => {}, 300_000);
        globalThis.__timerArmed36450 = true;
        expect(1).toBe(1);
      });
    `,
  };
  for (let i = 1; i <= fileCount; i++) {
    // The import must be used, otherwise it is elided and no module loads.
    files[`mod${i}.ts`] = `export const v = ${i};`;
    files[`plain${i}.test.ts`] = `
      import { test, expect } from "bun:test";
      import { v } from "./mod${i}";
      // All files share one process; prove the leak file ran first so the
      // measured run really has a pending ref'd timer.
      if (process.env.ISSUE_36450_EXPECT_TIMER === "1" && !globalThis.__timerArmed36450) {
        throw new Error("expected leak.test.ts to arm its timer before this file");
      }
      const loadedAt = performance.now();
      test("t${i}", () => {
        console.log("GAP${i}:" + (performance.now() - loadedAt).toFixed(2));
        expect(v).toBe(${i});
      });
    `;
  }
  using dir = tempDir("issue-36450", files);
  const plainFiles = Array.from({ length: fileCount }, (_, i) => `plain${i + 1}.test.ts`);

  async function medianGap(withLeak: boolean): Promise<number> {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...(withLeak ? ["leak.test.ts"] : []), ...plainFiles],
      env: { ...bunEnv, ISSUE_36450_EXPECT_TIMER: withLeak ? "1" : "0" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const gaps: number[] = [];
    for (const match of (stdout + stderr).matchAll(/GAP\d+:([\d.]+)/g)) {
      gaps.push(Number(match[1]));
    }
    // Include stderr so a child failure (e.g. the fixture guard) prints its
    // own error instead of just a short gap count.
    expect({ gapCount: gaps.length, exitCode, stderr }).toEqual({
      gapCount: fileCount,
      exitCode: 0,
      stderr: expect.any(String),
    });
    return gaps.toSorted((a, b) => a - b)[Math.floor(gaps.length / 2)];
  }

  const withoutTimer = await medianGap(false);
  const withTimer = await medianGap(true);

  // Unfixed, the pending timer pins every gap to the next JSC timer deadline
  // (~15ms release, ~90ms debug on an idle machine); fixed, both runs behave
  // identically.
  expect(withTimer - withoutTimer).toBeLessThan(10);
});
