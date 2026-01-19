import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/24336
// TypeScript enum compilation should not trigger Object.prototype setters
// by using Object.create(null) for enum objects instead of {}

describe("issue #24336: enum prototype pollution", () => {
  test("enum compilation uses Object.create(null) to prevent prototype pollution", async () => {
    using dir = tempDir("24336", {
      "enum.ts": `
        export enum MyEnum {
          A = 0,
          B = 1,
          C = 2
        }
        export const value = MyEnum.A;
      `,
      "index.js": `
        // Define a setter on Object.prototype for index 0
        let setterCalled = false;
        Object.defineProperty(Object.prototype, '0', {
          set() {
            setterCalled = true;
            console.log("SETTER_TRIGGERED");
          },
          configurable: true
        });

        // Require the TypeScript file with enum
        require('./enum.ts');

        // The setter should NOT be triggered since enum uses Object.create(null)
        if (setterCalled) {
          console.log("FAIL");
          process.exit(1);
        }
        console.log("PASS");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("PASS");
    expect(exitCode).toBe(0);
  });

  test("enum with string value 0 as key also uses Object.create(null)", async () => {
    using dir = tempDir("24336-2", {
      "enum.ts": `
        export enum Direction {
          Up = 0,
          Down = 1,
          Left = 2,
          Right = 3
        }
      `,
      "index.js": `
        let triggered = false;
        Object.defineProperty(Object.prototype, '0', {
          set() { triggered = true; },
          configurable: true
        });

        require('./enum.ts');
        console.log(triggered ? "FAIL" : "PASS");
        process.exit(triggered ? 1 : 0);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("PASS");
    expect(exitCode).toBe(0);
  });

  test("bundler output contains Object.create(null) for enums", async () => {
    using dir = tempDir("24336-3", {
      "enum.ts": `
        export enum Test {
          Zero = 0,
          One = 1
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "enum.ts", "--no-bundle"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("Object.create(null)");
    expect(stdout).not.toContain("||= {}");
    expect(exitCode).toBe(0);
  });
});
