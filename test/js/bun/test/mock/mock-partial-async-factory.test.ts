import { afterEach, describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("mock.module() - async factory with recursive import (deadlock prevention)", () => {
  afterEach(() => {
    mock.restoreModule();
  });

  test("async factory can import the same module it's mocking", async () => {
    using dir = tempDir("mock-async-factory", {
      "calculator.ts": `
        export function add(a: number, b: number): number {
          return a + b;
        }
        export function multiply(a: number, b: number): number {
          return a * b;
        }
        export function divide(a: number, b: number): number {
          return a / b;
        }
      `,
      "test.ts": `
        import { test, expect, mock } from "bun:test";

        test("partial mock with async factory", async () => {
          // This used to cause deadlock, but now should work!
          mock.module("./calculator.ts", async () => {
            const original = await import("./calculator.ts");
            return {
              ...original,
              add: () => 999,
            };
          });

          const calc = await import("./calculator.ts");

          // add should be mocked
          expect(calc.add(2, 3)).toBe(999);

          // multiply and divide should be original
          expect(calc.multiply(2, 3)).toBe(6);
          expect(calc.divide(10, 2)).toBe(5);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("Timeout");
    expect(stderr).not.toContain("deadlock");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 pass");
  });

  test("multiple async factories with recursive imports", async () => {
    using dir = tempDir("mock-multi-async", {
      "math.ts": `
        export const PI = 3.14159;
        export function square(x: number): number {
          return x * x;
        }
        export function cube(x: number): number {
          return x * x * x;
        }
      `,
      "test.ts": `
        import { test, expect, mock, afterEach } from "bun:test";

        afterEach(() => {
          mock.restoreModule();
        });

        test("first mock", async () => {
          mock.module("./math.ts", async () => {
            const original = await import("./math.ts");
            return {
              ...original,
              square: () => 100,
            };
          });

          const math = await import("./math.ts");
          expect(math.square(5)).toBe(100);  // mocked
          expect(math.cube(2)).toBe(8);      // original
        });

        test("second mock", async () => {
          mock.module("./math.ts", async () => {
            const original = await import("./math.ts");
            return {
              ...original,
              cube: () => 200,
            };
          });

          const math = await import("./math.ts");
          expect(math.square(5)).toBe(25);   // original
          expect(math.cube(2)).toBe(200);    // mocked
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("Timeout");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("2 pass");
  });

  test("nested async imports in factory", async () => {
    using dir = tempDir("mock-nested-async", {
      "utils.ts": `
        export function helper(x: number): number {
          return x + 10;
        }
      `,
      "calculator.ts": `
        import { helper } from "./utils.ts";

        export function calculate(a: number, b: number): number {
          return helper(a + b);
        }
      `,
      "test.ts": `
        import { test, expect, mock } from "bun:test";

        test("nested imports in async factory", async () => {
          mock.module("./calculator.ts", async () => {
            // This imports calculator, which imports utils
            const original = await import("./calculator.ts");
            return {
              ...original,
              calculate: (a: number, b: number) => 555,
            };
          });

          const calc = await import("./calculator.ts");
          expect(calc.calculate(1, 2)).toBe(555);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("Timeout");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 pass");
  });

  test("sync factory still works", async () => {
    using dir = tempDir("mock-sync-factory", {
      "calculator.ts": `
        export function add(a: number, b: number): number {
          return a + b;
        }
      `,
      "test.ts": `
        import { test, expect, mock } from "bun:test";

        test("sync factory without import", async () => {
          // Regular sync factory (without await import) should still work
          mock.module("./calculator.ts", () => ({
            add: () => 777,
          }));

          const calc = await import("./calculator.ts");
          expect(calc.add(1, 1)).toBe(777);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 pass");
  });

  test("import before mock (old workaround) still works", async () => {
    using dir = tempDir("mock-import-before", {
      "calculator.ts": `
        export function add(a: number, b: number): number {
          return a + b;
        }
        export function multiply(a: number, b: number): number {
          return a * b;
        }
      `,
      "test.ts": `
        import { test, expect, mock } from "bun:test";

        test("import before mock", async () => {
          // Old workaround: import before mocking
          const original = await import("./calculator.ts");

          mock.module("./calculator.ts", () => ({
            ...original,
            add: () => 888,
          }));

          const calc = await import("./calculator.ts");
          expect(calc.add(1, 1)).toBe(888);
          expect(calc.multiply(2, 3)).toBe(6);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 pass");
  });
});
