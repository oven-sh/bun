import { afterEach, describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("mock.module() - importOriginal helper (Vitest compatibility)", () => {
  afterEach(() => {
    mock.restoreModule();
  });

  test("async factory with importOriginal helper - basic usage", async () => {
    using dir = tempDir("mock-import-original", {
      "calculator.ts": `
        export function add(a: number, b: number): number {
          return a + b;
        }
        export function multiply(a: number, b: number): number {
          return a * b;
        }
      `,
      "mock.test.ts": `
        import { test, expect, mock } from "bun:test";

        test("partial mock with importOriginal", async () => {
          // Vitest-style API: factory receives importOriginal helper
          mock.module("./calculator.ts", async (importOriginal) => {
            const original = await importOriginal();
            return {
              ...original,
              add: () => 999,
            };
          });

          const calc = await import("./calculator.ts");

          // add should be mocked
          expect(calc.add(2, 3)).toBe(999);

          // multiply should be original
          expect(calc.multiply(2, 3)).toBe(6);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "mock.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0) {
      console.log("STDERR:", stderr);
      console.log("STDOUT:", stdout);
    }

    expect(stderr).not.toContain("Timeout");
    expect(stderr).not.toContain("deadlock");
    expect(exitCode).toBe(0);
    // Test output goes to stderr in debug builds
    expect(stderr).toContain("1 pass");
  });

  test("importOriginal helper with ESM exports", async () => {
    using dir = tempDir("mock-import-original-esm", {
      "math.ts": `
        export const PI = 3.14159;
        export function square(x: number): number {
          return x * x;
        }
        export function cube(x: number): number {
          return x * x * x;
        }
        export default function defaultFn() {
          return "default";
        }
      `,
      "mock.test.ts": `
        import { test, expect, mock } from "bun:test";

        test("importOriginal preserves all exports", async () => {
          mock.module("./math.ts", async (importOriginal) => {
            const original = await importOriginal();
            return {
              ...original,
              square: () => 100, // mock square
              // PI, cube, and default should be preserved
            };
          });

          const math = await import("./math.ts");

          expect(math.square(5)).toBe(100);      // mocked
          expect(math.cube(2)).toBe(8);          // original
          expect(math.PI).toBe(3.14159);         // original
          expect(math.default()).toBe("default"); // original
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "mock.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stderr).toContain("1 pass");
  });

  test("importOriginal helper with nested dependencies", async () => {
    using dir = tempDir("mock-import-original-nested", {
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
        export function simpleAdd(a: number, b: number): number {
          return a + b;
        }
      `,
      "mock.test.ts": `
        import { test, expect, mock } from "bun:test";

        test("importOriginal with nested imports", async () => {
          mock.module("./calculator.ts", async (importOriginal) => {
            const original = await importOriginal();
            return {
              ...original,
              calculate: (a: number, b: number) => 555,
              // simpleAdd should remain original
            };
          });

          const calc = await import("./calculator.ts");

          expect(calc.calculate(1, 2)).toBe(555);    // mocked
          expect(calc.simpleAdd(1, 2)).toBe(3);      // original
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "mock.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stderr).toContain("1 pass");
  });

  test("importOriginal helper - multiple mocks in same file", async () => {
    using dir = tempDir("mock-import-original-multi", {
      "moduleA.ts": `
        export function fnA() { return "A"; }
      `,
      "moduleB.ts": `
        export function fnB() { return "B"; }
      `,
      "mock.test.ts": `
        import { test, expect, mock, afterEach } from "bun:test";

        afterEach(() => {
          mock.restoreModule();
        });

        test("first mock", async () => {
          mock.module("./moduleA.ts", async (importOriginal) => {
            const original = await importOriginal();
            return {
              ...original,
              fnA: () => "mocked A",
            };
          });

          const modA = await import("./moduleA.ts");
          expect(modA.fnA()).toBe("mocked A");
        });

        test("second mock", async () => {
          mock.module("./moduleB.ts", async (importOriginal) => {
            const original = await importOriginal();
            return {
              ...original,
              fnB: () => "mocked B",
            };
          });

          const modB = await import("./moduleB.ts");
          expect(modB.fnB()).toBe("mocked B");
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "mock.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stderr).toContain("2 pass");
  });

  test("importOriginal helper - can be called synchronously in async factory", async () => {
    using dir = tempDir("mock-import-original-sync-call", {
      "module.ts": `
        export function original() { return "original"; }
      `,
      "mock.test.ts": `
        import { test, expect, mock } from "bun:test";

        test("importOriginal returns a value (not promise)", async () => {
          mock.module("./module.ts", async (importOriginal) => {
            // importOriginal() should work synchronously within the async factory
            const original = await importOriginal();

            // Verify it's an object with the expected exports
            expect(typeof original).toBe("object");
            expect(typeof original.original).toBe("function");

            return {
              ...original,
              original: () => "mocked",
            };
          });

          const mod = await import("./module.ts");
          expect(mod.original()).toBe("mocked");
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "mock.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stderr).toContain("1 pass");
  });

  test("backward compatibility - factory without parameter still works", async () => {
    using dir = tempDir("mock-no-import-original", {
      "calculator.ts": `
        export function add(a: number, b: number): number {
          return a + b;
        }
      `,
      "mock.test.ts": `
        import { test, expect, mock } from "bun:test";

        test("factory without importOriginal parameter", async () => {
          // Old style: pre-import before mocking
          const original = await import("./calculator.ts");

          mock.module("./calculator.ts", () => ({
            ...original,
            add: () => 999,
          }));

          const calc = await import("./calculator.ts");
          expect(calc.add(2, 3)).toBe(999);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "mock.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stderr).toContain("1 pass");
  });
});
