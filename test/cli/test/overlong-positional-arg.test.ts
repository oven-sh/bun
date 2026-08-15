import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("over-long positional argument", () => {
  // https://github.com/oven-sh/bun/issues/35728 — a single positional argument
  // of >= 997 bytes used to panic ("range end index ... out of range for slice
  // of length 1023") because the scanner wrote it into a fixed 1024-byte path
  // buffer without a bounds check.
  test("bun test with a 997+ byte positional exits cleanly, no panic", () => {
    using dir = tempDir("overlong-arg", {
      "a.test.ts": `
import { test, expect } from "bun:test";
test("passes", () => {
  expect(1).toBe(1);
});
`,
    });

    const longPath = "./x" + "a".repeat(986) + ".test.ts";
    expect(longPath.length).toBe(997);

    const result = Bun.spawnSync([bunExe(), "test", longPath], {
      cwd: dir,
      env: bunEnv,
      stdio: [null, "pipe", "pipe"],
    });

    const stderr = result.stderr.toString("utf-8");
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("out of range for slice");
    // Over-long positional behaves like a non-existent path: reports no matches.
    expect(stderr).toContain("no matches");
    expect(result.exitCode).not.toBe(0);
  });

  test("bun test with a 1200-byte positional also exits cleanly", () => {
    using dir = tempDir("overlong-arg-2", {
      "a.test.ts": `
import { test, expect } from "bun:test";
test("passes", () => {
  expect(1).toBe(1);
});
`,
    });

    const longPath = "./x" + "a".repeat(1189) + ".test.ts";
    expect(longPath.length).toBe(1200);

    const result = Bun.spawnSync([bunExe(), "test", longPath], {
      cwd: dir,
      env: bunEnv,
      stdio: [null, "pipe", "pipe"],
    });

    const stderr = result.stderr.toString("utf-8");
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("out of range for slice");
  });
});
