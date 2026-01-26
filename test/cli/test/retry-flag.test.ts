import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("--retry retries failed tests", async () => {
  using dir = tempDir("retry-flag", {
    "flaky.test.ts": `
      import { test, expect } from "bun:test";
      let count = 0;
      test("flaky test", () => {
        count++;
        if (count < 3) throw new Error("fail attempt " + count);
        expect(true).toBe(true);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--retry", "3", "flaky.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("flaky test");
  expect(stderr).toContain("attempt 3");
  expect(exitCode).toBe(0);
});

test("per-test { retry } overrides --retry", async () => {
  using dir = tempDir("retry-override", {
    "override.test.ts": `
      import { test, expect } from "bun:test";
      let countA = 0;
      let countB = 0;

      // Per-test retry=1 overrides --retry 5. Fails twice, so retry=1 not enough.
      test("limited retry", { retry: 1 }, () => {
        countA++;
        if (countA < 3) throw new Error("fail attempt " + countA);
      });

      // Uses global --retry 5 default, fails once then passes.
      test("default retry", () => {
        countB++;
        if (countB < 2) throw new Error("fail attempt " + countB);
        expect(true).toBe(true);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--retry", "5", "override.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("limited retry");
  expect(stderr).toContain("default retry");
  expect(exitCode).not.toBe(0);
});

test("bunfig.toml retry works equivalently", async () => {
  using dir = tempDir("retry-bunfig", {
    "bunfig.toml": `
[test]
retry = 3
`,
    "flaky.test.ts": `
      import { test, expect } from "bun:test";
      let count = 0;
      test("flaky via bunfig", () => {
        count++;
        if (count < 3) throw new Error("fail attempt " + count);
        expect(true).toBe(true);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "flaky.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("flaky via bunfig");
  expect(stderr).toContain("attempt 3");
  expect(exitCode).toBe(0);
});
