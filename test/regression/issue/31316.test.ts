// https://github.com/oven-sh/bun/issues/31316
//
// `mock.module()` mutated a process-global registry on the `ZigGlobalObject`
// that was never reset between test files. Running two test files in the
// same `bun test` process leaked a partial mock from the first file into the
// second — which broke ESM binding to the dropped exports.
//
// Per-file scoping matches Vitest and Jest semantics and removes the need to
// spawn one process per file for correctness under `bun test`.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("mock.module does not leak into sibling test files", async () => {
  using dir = tempDir("issue-31316", {
    "dep.ts": `
      export const a = "REAL_A";
      export const b = "REAL_B";
    `,
    "a.test.ts": `
      import { mock, it, expect } from "bun:test";
      mock.module("./dep", () => ({ a: "MOCK_A" }));
      import { a } from "./dep";
      it("A sees mock", () => {
        expect(a).toBe("MOCK_A");
      });
    `,
    "b.test.ts": `
      import { it, expect } from "bun:test";
      import { a, b } from "./dep";
      it("B sees real", () => {
        expect(a).toBe("REAL_A");
        expect(b).toBe("REAL_B");
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "a.test.ts", "b.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  // `bun test` writes pass/fail counts to stderr; stdout is captured so it
  // surfaces in failure logs alongside stderr.
  expect(stderr + stdout).toContain("2 pass");
  expect(stderr + stdout).toContain("0 fail");
  expect(exitCode).toBe(0);
});

test("mock.module still persists within its own file", async () => {
  // Regression guard: the per-file cleanup should run at file boundaries,
  // not between individual tests in the same file.
  using dir = tempDir("issue-31316-same-file", {
    "dep.ts": `export const v = "REAL";`,
    "same.test.ts": `
      import { mock, it, expect } from "bun:test";
      mock.module("./dep", () => ({ v: "MOCK" }));
      import { v } from "./dep";
      it("first", () => { expect(v).toBe("MOCK"); });
      it("second (same file)", () => { expect(v).toBe("MOCK"); });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "same.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  expect(stderr + stdout).toContain("2 pass");
  expect(stderr + stdout).toContain("0 fail");
  expect(exitCode).toBe(0);
});

test("preload-installed mock.module persists across files", async () => {
  // `mock.module()` from a `--preload` script is process-lifetime, not
  // per-test-file. The per-file cleanup must leave it alone.
  using dir = tempDir("issue-31316-preload", {
    "dep.ts": `export const v = "REAL";`,
    "preload.ts": `
      import { mock } from "bun:test";
      mock.module("./dep", () => ({ v: "PRELOAD_MOCK" }));
    `,
    "one.test.ts": `
      import { it, expect } from "bun:test";
      import { v } from "./dep";
      it("one", () => { expect(v).toBe("PRELOAD_MOCK"); });
    `,
    "two.test.ts": `
      import { it, expect } from "bun:test";
      import { v } from "./dep";
      it("two", () => { expect(v).toBe("PRELOAD_MOCK"); });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--preload", "./preload.ts", "one.test.ts", "two.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  expect(stderr + stdout).toContain("2 pass");
  expect(stderr + stdout).toContain("0 fail");
  expect(exitCode).toBe(0);
});
