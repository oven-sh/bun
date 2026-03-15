import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunExe, bunEnv as env, isMusl, runBunInstall, tempDir } from "harness";
import { join } from "path";

// BusyBox env (used on Alpine/musl) does not support -S flag.
// Skip these tests on musl since they rely on `env -S` working at runtime.
describe.skipIf(isMusl)("env -S shebang parsing", () => {
  // Test that shebangs with env flags like -S are parsed correctly during bin linking.
  // On Windows, the shebang is parsed to create a .bunx metadata file. Previously,
  // the parser would treat "-S" as the program name instead of skipping it.
  // See also: #27924
  test("bin linking handles shebang with env -S flag", async () => {
    using dir = tempDir("issue-28126", {
      "pkg/package.json": JSON.stringify({
        name: "test-env-s-shebang",
        version: "1.0.0",
        bin: {
          "test-env-s": "index.js",
        },
      }),
      "pkg/index.js": '#!/usr/bin/env -S node\nconsole.log("hello from env -S");\n',
      "consumer/package.json": JSON.stringify({
        name: "consumer",
        version: "1.0.0",
        dependencies: {
          "test-env-s-shebang": "file:../pkg",
        },
      }),
    });

    const consumerDir = join(String(dir), "consumer");

    await runBunInstall(env, consumerDir);

    await using proc = spawn({
      cmd: [bunExe(), "run", "test-env-s"],
      cwd: consumerDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // On Windows, the previous bug would cause:
    // error: interpreter executable "-S" not found in %PATH%
    expect(stderr).not.toContain("interpreter executable");
    expect(stderr).not.toContain("not found in %PATH%");
    expect(stdout).toContain("hello from env -S");
    expect(exitCode).toBe(0);
  });

  test("bin linking handles shebang with env -S and additional args", async () => {
    using dir = tempDir("issue-28126-args", {
      "pkg/package.json": JSON.stringify({
        name: "test-env-s-args",
        version: "1.0.0",
        bin: {
          "test-env-s-args": "index.js",
        },
      }),
      "pkg/index.js": '#!/usr/bin/env -S node --no-warnings\nconsole.log("hello with args");\n',
      "consumer/package.json": JSON.stringify({
        name: "consumer",
        version: "1.0.0",
        dependencies: {
          "test-env-s-args": "file:../pkg",
        },
      }),
    });

    const consumerDir = join(String(dir), "consumer");

    await runBunInstall(env, consumerDir);

    await using proc = spawn({
      cmd: [bunExe(), "run", "test-env-s-args"],
      cwd: consumerDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("interpreter executable");
    expect(stdout).toContain("hello with args");
    expect(exitCode).toBe(0);
  });

  test("bin linking handles shebang with env -S bun", async () => {
    using dir = tempDir("issue-28126-bun", {
      "pkg/package.json": JSON.stringify({
        name: "test-env-s-bun",
        version: "1.0.0",
        bin: {
          "test-env-s-bun": "index.js",
        },
      }),
      "pkg/index.js": '#!/usr/bin/env -S bun\nconsole.log("hello from env -S bun");\n',
      "consumer/package.json": JSON.stringify({
        name: "consumer",
        version: "1.0.0",
        dependencies: {
          "test-env-s-bun": "file:../pkg",
        },
      }),
    });

    const consumerDir = join(String(dir), "consumer");

    await runBunInstall(env, consumerDir);

    await using proc = spawn({
      cmd: [bunExe(), "run", "test-env-s-bun"],
      cwd: consumerDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("interpreter executable");
    expect(stdout).toContain("hello from env -S bun");
    expect(exitCode).toBe(0);
  });

  test("bin linking handles shebang with env -u flag before program", async () => {
    using dir = tempDir("issue-28126-u", {
      "pkg/package.json": JSON.stringify({
        name: "test-env-u-shebang",
        version: "1.0.0",
        bin: {
          "test-env-u": "index.js",
        },
      }),
      // -u takes a value (variable name to unset), which must be skipped
      "pkg/index.js": '#!/usr/bin/env -S -u HOME node\nconsole.log("hello from env -u");\n',
      "consumer/package.json": JSON.stringify({
        name: "consumer",
        version: "1.0.0",
        dependencies: {
          "test-env-u-shebang": "file:../pkg",
        },
      }),
    });

    const consumerDir = join(String(dir), "consumer");

    await runBunInstall(env, consumerDir);

    await using proc = spawn({
      cmd: [bunExe(), "run", "test-env-u"],
      cwd: consumerDir,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("interpreter executable");
    expect(stdout).toContain("hello from env -u");
    expect(exitCode).toBe(0);
  });
}); // describe
