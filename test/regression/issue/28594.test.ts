import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/28594
// Shebangs like #!/usr/bin/env -S node should skip the env flags (-S)
// and use "node" as the interpreter, not "-S".
describe("env -S flag in shebang", () => {
  test.skipIf(!isWindows)("package with env -S shebang can be installed and run", async () => {
    using dir = tempDir("issue-28594", {
      "package.json": JSON.stringify({
        name: "test-env-s-flag",
        version: "1.0.0",
        dependencies: {
          "env-s-pkg": "file:./env-s-pkg",
        },
      }),
      "env-s-pkg/package.json": JSON.stringify({
        name: "env-s-pkg",
        version: "1.0.0",
        bin: {
          "env-s-test": "./bin.js",
        },
      }),
      "env-s-pkg/bin.js": '#!/usr/bin/env -S node --no-warnings=DEP0040\nconsole.log("env-s-works");\n',
    });

    // Install the package
    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [installStdout, installStderr, installExit] = await Promise.all([
      installProc.stdout.text(),
      installProc.stderr.text(),
      installProc.exited,
    ]);

    expect(installStderr).not.toContain("error:");
    expect(installExit).toBe(0);

    // Run the binary through bun run
    await using runProc = Bun.spawn({
      cmd: [bunExe(), "run", "env-s-test"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      runProc.stdout.text(),
      runProc.stderr.text(),
      runProc.exited,
    ]);

    expect(stderr).not.toContain('interpreter executable "-S" not found');
    expect(stdout).toContain("env-s-works");
    expect(exitCode).toBe(0);

    // Also test running the .exe shim directly
    await using shimProc = Bun.spawn({
      cmd: [join(String(dir), "node_modules", ".bin", "env-s-test.exe")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [shimStdout, shimStderr, shimExit] = await Promise.all([
      shimProc.stdout.text(),
      shimProc.stderr.text(),
      shimProc.exited,
    ]);

    expect(shimStderr).not.toContain('interpreter executable "-S" not found');
    expect(shimStdout).toContain("env-s-works");
    expect(shimExit).toBe(0);
  });

  test.skipIf(!isWindows)("package with env --split-string shebang can be installed and run", async () => {
    using dir = tempDir("issue-28594-long", {
      "package.json": JSON.stringify({
        name: "test-env-split-string",
        version: "1.0.0",
        dependencies: {
          "split-string-pkg": "file:./split-string-pkg",
        },
      }),
      "split-string-pkg/package.json": JSON.stringify({
        name: "split-string-pkg",
        version: "1.0.0",
        bin: {
          "split-string-test": "./bin.js",
        },
      }),
      "split-string-pkg/bin.js":
        '#!/usr/bin/env --split-string node --no-warnings=DEP0040\nconsole.log("split-string-works");\n',
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [, installStderr, installExit] = await Promise.all([
      installProc.stdout.text(),
      installProc.stderr.text(),
      installProc.exited,
    ]);

    expect(installStderr).not.toContain("error:");
    expect(installExit).toBe(0);

    await using runProc = Bun.spawn({
      cmd: [bunExe(), "run", "split-string-test"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      runProc.stdout.text(),
      runProc.stderr.text(),
      runProc.exited,
    ]);

    expect(stderr).not.toContain("not found");
    expect(stdout).toContain("split-string-works");
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isWindows)("package with env -- separator shebang can be installed and run", async () => {
    using dir = tempDir("issue-28594-sep", {
      "package.json": JSON.stringify({
        name: "test-env-separator",
        version: "1.0.0",
        dependencies: {
          "separator-pkg": "file:./separator-pkg",
        },
      }),
      "separator-pkg/package.json": JSON.stringify({
        name: "separator-pkg",
        version: "1.0.0",
        bin: {
          "separator-test": "./bin.js",
        },
      }),
      "separator-pkg/bin.js": '#!/usr/bin/env -- node\nconsole.log("separator-works");\n',
    });

    await using installProc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [, installStderr, installExit] = await Promise.all([
      installProc.stdout.text(),
      installProc.stderr.text(),
      installProc.exited,
    ]);

    expect(installStderr).not.toContain("error:");
    expect(installExit).toBe(0);

    await using runProc = Bun.spawn({
      cmd: [bunExe(), "run", "separator-test"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      runProc.stdout.text(),
      runProc.stderr.text(),
      runProc.exited,
    ]);

    expect(stderr).not.toContain("not found");
    expect(stdout).toContain("separator-works");
    expect(exitCode).toBe(0);
  });
});
