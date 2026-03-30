import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("bunx --cwd", () => {
  test("changes working directory for package resolution and execution", async () => {
    using dir = tempDir("bunx-cwd", {
      "subdir/package.json": JSON.stringify({
        name: "test-cwd",
        version: "1.0.0",
        bin: { "test-cwd-bin": "./bin.js" },
      }),
      "subdir/bin.js": `#!/usr/bin/env node\nconsole.log(process.cwd());`,
      "subdir/node_modules/.bin/test-cwd-bin": `#!/usr/bin/env node\nconsole.log(process.cwd());`,
    });

    // Make the bin script executable
    const { chmodSync } = require("fs");
    chmodSync(join(String(dir), "subdir/node_modules/.bin/test-cwd-bin"), 0o755);
    chmodSync(join(String(dir), "subdir/bin.js"), 0o755);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "x", "--cwd", "subdir", "test-cwd-bin"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toEndWith("subdir");
    expect(exitCode).toBe(0);
  });

  test("works with --cwd=<path> syntax", async () => {
    using dir = tempDir("bunx-cwd-eq", {
      "mydir/package.json": JSON.stringify({
        name: "test-cwd-eq",
        version: "1.0.0",
        bin: { "test-cwd-eq-bin": "./bin.js" },
      }),
      "mydir/bin.js": `#!/usr/bin/env node\nconsole.log(process.cwd());`,
      "mydir/node_modules/.bin/test-cwd-eq-bin": `#!/usr/bin/env node\nconsole.log(process.cwd());`,
    });

    const { chmodSync } = require("fs");
    chmodSync(join(String(dir), "mydir/node_modules/.bin/test-cwd-eq-bin"), 0o755);
    chmodSync(join(String(dir), "mydir/bin.js"), 0o755);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "x", "--cwd=mydir", "test-cwd-eq-bin"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toEndWith("mydir");
    expect(exitCode).toBe(0);
  });

  test("errors on missing --cwd argument", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "x", "--cwd"],
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("--cwd requires a path argument");
    expect(exitCode).not.toBe(0);
  });

  test("errors on invalid --cwd directory", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "x", "--cwd", "/nonexistent-path-28668", "some-package"],
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("Could not change directory");
    expect(exitCode).not.toBe(0);
  });
});
