import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/34859 — an unhandled rejection inside a
// test file's top-level async IIFE (outside any test()) must fail the file,
// matching how uncaught exceptions between tests are already reported.
describe("unhandled rejections between tests", () => {
  test("file with only a rejecting async IIFE fails", () => {
    using dir = tempDir("rejecting-iife", {
      "rejecting.test.ts": `
(async () => {
  throw new Error("boom from async IIFE");
})();
`,
      "ok.test.ts": `
import { test, expect } from "bun:test";
test("passes", () => {
  expect(1).toBe(1);
});
`,
    });

    const result = Bun.spawnSync([bunExe(), "test", "rejecting.test.ts"], {
      cwd: dir,
      env: bunEnv,
      stdio: [null, "pipe", "pipe"],
    });

    const stderr = result.stderr.toString("utf-8");
    expect(stderr).toContain("boom from async IIFE");
    expect(stderr).toContain("Unhandled error");
    expect(result.exitCode).not.toBe(0);
  });

  test("rejection while a test is running still fails only that test", () => {
    using dir = tempDir("rejecting-in-test", {
      "in.test.ts": `
import { test, expect } from "bun:test";
test("passes", () => {
  Promise.reject(new Error("async leak"));
  expect(1).toBe(1);
});
`,
    });

    const result = Bun.spawnSync([bunExe(), "test", "in.test.ts"], {
      cwd: dir,
      env: bunEnv,
      stdio: [null, "pipe", "pipe"],
    });

    const stderr = result.stderr.toString("utf-8");
    expect(stderr).toContain("async leak");
    expect(result.exitCode).not.toBe(0);
  });
});
