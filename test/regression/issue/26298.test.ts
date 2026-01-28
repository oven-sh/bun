import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// Regression test for https://github.com/oven-sh/bun/issues/26298
// Windows segfault when running standalone executables with bytecode cache.
// The crash occurred because bytecode offsets were not properly aligned
// when embedded in PE sections, causing deserialization failures.

describe("issue #26298: bytecode cache in standalone executables", () => {
  const ext = isWindows ? ".exe" : "";

  test("standalone executable with --bytecode runs correctly", async () => {
    using dir = tempDir("bytecode-standalone", {
      "index.js": `
        const add = (a, b) => a + b;
        const multiply = (x, y) => x * y;
        console.log("sum:", add(2, 3));
        console.log("product:", multiply(4, 5));
      `,
    });

    const outfile = join(String(dir), `app${ext}`);

    // Build with bytecode
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--bytecode", join(String(dir), "index.js"), "--outfile", outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);

    expect(buildStderr).toBe("");
    expect(buildExitCode).toBe(0);

    // Run the compiled executable
    await using exe = Bun.spawn({
      cmd: [outfile],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exeStdout, , exeExitCode] = await Promise.all([exe.stdout.text(), exe.stderr.text(), exe.exited]);

    expect(exeStdout).toContain("sum: 5");
    expect(exeStdout).toContain("product: 20");
    // Should not crash with segfault
    expect(exeExitCode).toBe(0);
  });

  test("standalone executable with --bytecode and multiple modules", async () => {
    using dir = tempDir("bytecode-multi-module", {
      "index.js": `
        import { greet } from "./greet.js";
        import { calculate } from "./math.js";
        console.log(greet("World"));
        console.log("result:", calculate(10, 5));
      `,
      "greet.js": `
        export function greet(name) {
          return "Hello, " + name + "!";
        }
      `,
      "math.js": `
        export function calculate(a, b) {
          return a * b + (a - b);
        }
      `,
    });

    const outfile = join(String(dir), `multi${ext}`);

    // Build with bytecode
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--bytecode", join(String(dir), "index.js"), "--outfile", outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);

    expect(buildStderr).toBe("");
    expect(buildExitCode).toBe(0);

    // Run the compiled executable
    await using exe = Bun.spawn({
      cmd: [outfile],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exeStdout, , exeExitCode] = await Promise.all([exe.stdout.text(), exe.stderr.text(), exe.exited]);

    expect(exeStdout).toContain("Hello, World!");
    expect(exeStdout).toContain("result: 55");
    // Should not crash with segfault
    expect(exeExitCode).toBe(0);
  });

  test("standalone executable with --bytecode uses bytecode cache", async () => {
    using dir = tempDir("bytecode-cache-hit", {
      "app.js": `console.log("bytecode cache test");`,
    });

    const outfile = join(String(dir), `cached${ext}`);

    // Build with bytecode
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--bytecode", join(String(dir), "app.js"), "--outfile", outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);

    expect(buildStderr).toBe("");
    expect(buildExitCode).toBe(0);

    // Run with verbose disk cache to verify bytecode is being used
    await using exe = Bun.spawn({
      cmd: [outfile],
      env: {
        ...bunEnv,
        BUN_JSC_verboseDiskCache: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exeStdout, exeStderr, exeExitCode] = await Promise.all([exe.stdout.text(), exe.stderr.text(), exe.exited]);

    expect(exeStdout).toContain("bytecode cache test");
    // Check for cache hit message which confirms bytecode is being loaded.
    // This relies on JSC's internal disk cache diagnostic output when
    // BUN_JSC_verboseDiskCache=1 is set. The pattern is kept flexible to
    // accommodate potential future changes in JSC's diagnostic format.
    expect(exeStderr).toMatch(/\[Disk Cache\].*Cache hit/i);
    expect(exeExitCode).toBe(0);
  });
});
