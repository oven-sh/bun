// https://github.com/oven-sh/bun/issues/5356
// jest.resetModules is not a function in bun:test
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe.concurrent("jest.resetModules", () => {
  test("exists and is chainable on jest and vi", async () => {
    using dir = tempDir("jest-reset-modules-exists", {
      "exists.test.ts": `
        import { jest, vi, test, expect } from "bun:test";

        test("callable", () => {
          expect(typeof jest.resetModules).toBe("function");
          expect(typeof vi.resetModules).toBe("function");
          expect(jest.resetModules()).toBe(jest);
          expect(vi.resetModules()).toBe(vi);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "exists.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("is not a function");
    expect(stdout + stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });

  test("require() returns a fresh module after resetModules()", async () => {
    using dir = tempDir("jest-reset-modules-cjs", {
      "counter.cjs": `
        let count = 0;
        module.exports = {
          increment: () => ++count,
          get: () => count,
        };
      `,
      "reset.test.ts": `
        import { jest, test, expect } from "bun:test";

        test("fresh CJS module after resetModules", () => {
          const c1 = require("./counter.cjs");
          c1.increment();
          c1.increment();
          expect(c1.get()).toBe(2);
          expect(require("./counter.cjs")).toBe(c1);

          jest.resetModules();

          const c2 = require("./counter.cjs");
          expect(c2).not.toBe(c1);
          expect(c2.get()).toBe(0);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "reset.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout + stderr).toContain("1 pass");
    expect(stdout + stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("dynamic import() returns a fresh module after resetModules()", async () => {
    using dir = tempDir("jest-reset-modules-esm", {
      "state.ts": `
        export const value = { n: 0 };
      `,
      "reset.test.ts": `
        import { jest, test, expect } from "bun:test";

        test("fresh ESM module after resetModules", async () => {
          const m1 = await import("./state.ts");
          m1.value.n = 5;
          const m1b = await import("./state.ts");
          expect(m1b.value.n).toBe(5);

          jest.resetModules();

          const m2 = await import("./state.ts");
          expect(m2.value.n).toBe(0);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "reset.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout + stderr).toContain("1 pass");
    expect(stdout + stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });

  test("module mocks survive resetModules()", async () => {
    using dir = tempDir("jest-reset-modules-mock", {
      "dep.cjs": `
        module.exports = { real: true };
      `,
      "reset.test.ts": `
        import { jest, test, expect } from "bun:test";

        test("mock still applied after resetModules", () => {
          jest.mock("./dep.cjs", () => ({ real: false }));
          expect(require("./dep.cjs").real).toBe(false);

          jest.resetModules();

          expect(require("./dep.cjs").real).toBe(false);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "reset.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout + stderr).toContain("1 pass");
    expect(stdout + stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  });
});
