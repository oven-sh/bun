import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";

// https://github.com/oven-sh/bun/issues/13316
// bunx cowsay "" panicked on Windows due to improper handling of empty string arguments
// The issue was in the BunXFastPath.tryLaunch function which didn't properly quote
// empty string arguments for the Windows command line.
describe.if(isWindows)("#13316 - bunx with empty string arguments", () => {
  test("bunx does not panic with empty string argument", async () => {
    // Create a minimal package that echoes its arguments
    using dir = tempDir("issue-13316", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "echo-args-test": "file:./echo-args-test",
        },
      }),
      "echo-args-test/package.json": JSON.stringify({
        name: "echo-args-test",
        version: "1.0.0",
        bin: {
          "echo-args-test": "./index.js",
        },
      }),
      "echo-args-test/index.js": `#!/usr/bin/env node
console.log(JSON.stringify(process.argv.slice(2)));
`,
    });

    // Install to create the .bunx shim in node_modules/.bin
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    await installProc.exited;

    // Verify the .bunx file was created (this is what triggers the fast path)
    const bunxPath = path.join(String(dir), "node_modules", ".bin", "echo-args-test.bunx");
    expect(fs.existsSync(bunxPath)).toBe(true);

    // Run with an empty string argument - this was triggering the panic
    // We use `bun run` which goes through the same BunXFastPath when .bunx exists
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "echo-args-test", ""],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The main assertion is that the process doesn't panic (exit code 3)
    // If the bug is present, this would crash with "reached unreachable code"
    expect(exitCode).not.toBe(3); // panic exit code
    expect(exitCode).toBe(0);

    // The empty string argument should be passed correctly
    expect(JSON.parse(stdout.trim())).toEqual([""]);
  });

  test("bunx handles multiple arguments including empty strings", async () => {
    using dir = tempDir("issue-13316-multi", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "echo-args-test": "file:./echo-args-test",
        },
      }),
      "echo-args-test/package.json": JSON.stringify({
        name: "echo-args-test",
        version: "1.0.0",
        bin: {
          "echo-args-test": "./index.js",
        },
      }),
      "echo-args-test/index.js": `#!/usr/bin/env node
console.log(JSON.stringify(process.argv.slice(2)));
`,
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    await installProc.exited;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "echo-args-test", "hello", "", "world"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).not.toBe(3); // panic exit code
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual(["hello", "", "world"]);
  });

  // Related to #18275 - bunx concurrently "command with spaces"
  // Arguments containing spaces must be preserved as single arguments
  test("bunx preserves arguments with spaces", async () => {
    using dir = tempDir("issue-13316-spaces", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "echo-args-test": "file:./echo-args-test",
        },
      }),
      "echo-args-test/package.json": JSON.stringify({
        name: "echo-args-test",
        version: "1.0.0",
        bin: {
          "echo-args-test": "./index.js",
        },
      }),
      "echo-args-test/index.js": `#!/usr/bin/env node
console.log(JSON.stringify(process.argv.slice(2)));
`,
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    await installProc.exited;

    // This simulates: bunx concurrently "bun --version"
    // The shell strips the outer quotes, so bunx receives ["concurrently", "bun --version"]
    // This must be preserved as a single argument with spaces
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "echo-args-test", "bun --version", "echo hello world"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    // Each argument with spaces should be preserved as a single argument
    expect(JSON.parse(stdout.trim())).toEqual(["bun --version", "echo hello world"]);
  });
});
