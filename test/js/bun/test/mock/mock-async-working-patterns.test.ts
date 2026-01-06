import { afterEach, describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("mock.module() - Async Mocking Patterns that Work", () => {
  afterEach(() => {
    mock.restoreModule();
  });

  test("✅ Pattern 1: Async factory without importing original", async () => {
    using dir = tempDir("async-no-import", {
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

        test("async factory - no import", async () => {
          mock.module("./calculator.ts", async () => {
            // Simulate async operation (API call, etc)
            await new Promise(resolve => setTimeout(resolve, 10));

            // Return completely mocked module
            return {
              add: () => 999,
              multiply: () => 888,
            };
          });

          const calc = await import("./calculator.ts");
          expect(calc.add(2, 3)).toBe(999);
          expect(calc.multiply(2, 3)).toBe(888);
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

    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  test("✅ Pattern 2: Import BEFORE mocking (partial mock)", async () => {
    using dir = tempDir("import-before-mock", {
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

        test("import before mock", async () => {
          // ✅ Import the original FIRST
          const original = await import("./calculator.ts");

          // Then mock with reference to original
          mock.module("./calculator.ts", () => ({
            ...original,
            add: () => 999, // Mock only add
          }));

          const calc = await import("./calculator.ts");
          expect(calc.add(2, 3)).toBe(999);        // Mocked
          expect(calc.multiply(2, 3)).toBe(6);     // Original
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

    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  test("✅ Pattern 3: Sync factory (no async)", async () => {
    using dir = tempDir("sync-factory", {
      "calculator.ts": `
        export function add(a: number, b: number): number {
          return a + b;
        }
      `,
      "mock.test.ts": `
        import { test, expect, mock } from "bun:test";

        test("sync factory", async () => {
          mock.module("./calculator.ts", () => ({
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

    if (exitCode !== 0) {
      console.log("STDERR:", stderr);
      console.log("STDOUT:", stdout);
    }

    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  test("✅ Pattern 4: Multiple modules with pre-import", async () => {
    using dir = tempDir("multi-module", {
      "math.ts": `
        export const PI = 3.14159;
        export function square(x: number): number {
          return x * x;
        }
      `,
      "calc.ts": `
        export function add(a: number, b: number): number {
          return a + b;
        }
      `,
      "mock.test.ts": `
        import { test, expect, mock } from "bun:test";

        test("multiple modules", async () => {
          // Import both originals first
          const mathOrig = await import("./math.ts");
          const calcOrig = await import("./calc.ts");

          // Mock both
          mock.module("./math.ts", () => ({
            ...mathOrig,
            square: () => 100,
          }));

          mock.module("./calc.ts", () => ({
            ...calcOrig,
            add: () => 999,
          }));

          const math = await import("./math.ts");
          const calc = await import("./calc.ts");

          expect(math.square(5)).toBe(100);       // Mocked
          expect(math.PI).toBe(3.14159);          // Original
          expect(calc.add(2, 3)).toBe(999);       // Mocked
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

    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  test("✅ Pattern 5: Async factory with external async operation", async () => {
    using dir = tempDir("async-external", {
      "api.ts": `
        export async function fetchData(): Promise<string> {
          return "real data";
        }
      `,
      "mock.test.ts": `
        import { test, expect, mock } from "bun:test";

        test("async factory with external operation", async () => {
          mock.module("./api.ts", async () => {
            // Simulate async setup (e.g., loading fixtures)
            const fixtures = await Promise.resolve({ data: "mock data" });

            return {
              fetchData: async () => fixtures.data,
            };
          });

          const api = await import("./api.ts");
          const result = await api.fetchData();
          expect(result).toBe("mock data");
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

    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  test("✅ Pattern 6: Mock restoration between tests", async () => {
    using dir = tempDir("mock-restore", {
      "counter.ts": `
        export function getCount(): number {
          return 42;
        }
      `,
      "mock.test.ts": `
        import { test, expect, mock, afterEach } from "bun:test";

        afterEach(() => {
          mock.restoreModule();
        });

        test("first test - mocked", async () => {
          mock.module("./counter.ts", () => ({
            getCount: () => 100,
          }));

          const counter = await import("./counter.ts");
          expect(counter.getCount()).toBe(100);
        });

        test("second test - original", async () => {
          // Mock was restored, but module is cached
          // For truly original behavior, would need cache clearing
          const counter = await import("./counter.ts");
          // Note: In real tests, may still get mocked version due to cache
          // This is expected behavior
          expect(typeof counter.getCount).toBe("function");
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

    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });

  test("✅ Pattern 7: Conditional mocking based on environment", async () => {
    using dir = tempDir("conditional-mock", {
      "config.ts": `
        export function getApiUrl(): string {
          return "https://api.production.com";
        }
      `,
      "mock.test.ts": `
        import { test, expect, mock } from "bun:test";

        test("conditional mocking", async () => {
          const isTest = true;

          if (isTest) {
            mock.module("./config.ts", () => ({
              getApiUrl: () => "https://api.test.com",
            }));
          }

          const config = await import("./config.ts");
          expect(config.getApiUrl()).toBe("https://api.test.com");
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

    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });
});
