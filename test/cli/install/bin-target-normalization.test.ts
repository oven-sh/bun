import { spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { exists, stat } from "fs/promises";
import { bunEnv, bunExe, isWindows, readdirSorted, tempDir, toBeValidBin, toHaveBins } from "harness";
import { join } from "path";

expect.extend({
  toBeValidBin,
  toHaveBins,
});

describe("bin target normalization", () => {
  it("should not link bin targets with parent directory traversal", async () => {
    // A package with a bin target using "../" that would escape the package directory.
    // After normalization, the traversal components are stripped so the bin won't
    // resolve to a file outside the package.
    using dir = tempDir("bin-target-norm", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "bad-pkg": "file:./bad-pkg",
        },
      }),
      "bad-pkg/package.json": JSON.stringify({
        name: "bad-pkg",
        version: "1.0.0",
        bin: {
          "bad-bin": "../../escape-target.js",
        },
      }),
      "bad-pkg/index.js": "#!/usr/bin/env node\nconsole.log('ok');",
      // This file exists at the traversal target but should NOT be linked
      "escape-target.js": "#!/usr/bin/env node\nconsole.log('escaped');",
    });

    // Record the permissions of the escape target before install
    const escapeTargetPath = join(String(dir), "escape-target.js");
    const statBefore = await stat(escapeTargetPath);

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    // The .bin directory should not exist or should not contain bad-bin,
    // because the normalized target doesn't exist within the package dir
    const binDir = join(String(dir), "node_modules", ".bin");
    const binDirExists = await exists(binDir);

    if (binDirExists) {
      const bins = await readdirSorted(binDir);
      if (!isWindows) {
        expect(bins).not.toContain("bad-bin");
      } else {
        expect(bins).not.toContain("bad-bin.exe");
      }
    }

    // The file at the traversal path should not have had its permissions changed
    const statAfter = await stat(escapeTargetPath);
    expect(statAfter.mode).toBe(statBefore.mode);
  });

  it("should not link bin targets with absolute paths", async () => {
    // A package with an absolute path as a bin target.
    // The absolute path is normalized to a relative path within the package,
    // which won't match any existing file.
    using dir = tempDir("bin-target-abs", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "abs-pkg": "file:./abs-pkg",
        },
      }),
      "abs-pkg/package.json": JSON.stringify({
        name: "abs-pkg",
        version: "1.0.0",
        bin: {
          "abs-bin": "/etc/passwd",
        },
      }),
      "abs-pkg/index.js": "module.exports = {};",
    });

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    // No bin should be created since /etc/passwd normalizes to etc/passwd
    // which doesn't exist within the package directory
    const binDir = join(String(dir), "node_modules", ".bin");
    const binDirExists = await exists(binDir);

    if (binDirExists) {
      const bins = await readdirSorted(binDir);
      if (!isWindows) {
        expect(bins).not.toContain("abs-bin");
      } else {
        expect(bins).not.toContain("abs-bin.exe");
      }
    }
  });

  it("should allow valid relative bin targets within the package", async () => {
    // Normal case: bin target is a valid relative path within the package.
    // This should continue to work correctly.
    using dir = tempDir("bin-target-valid", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "good-pkg": "file:./good-pkg",
        },
      }),
      "good-pkg/package.json": JSON.stringify({
        name: "good-pkg",
        version: "1.0.0",
        bin: {
          "good-bin": "./bin/cli.js",
        },
      }),
      "good-pkg/bin/cli.js": "#!/usr/bin/env node\nconsole.log('hello');",
    });

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    // The bin should be correctly linked
    const binDir = join(String(dir), "node_modules", ".bin");
    expect(await exists(binDir)).toBe(true);
    expect(await readdirSorted(binDir)).toHaveBins(["good-bin"]);
    expect(join(binDir, "good-bin")).toBeValidBin(join("..", "good-pkg", "bin", "cli.js"));
  });

  it("should normalize bin map targets with traversal paths", async () => {
    // Test the map case with multiple bins: valid bins should be linked,
    // while bins with traversal paths should be skipped.
    using dir = tempDir("bin-target-map", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "map-pkg": "file:./map-pkg",
        },
      }),
      "map-pkg/package.json": JSON.stringify({
        name: "map-pkg",
        version: "1.0.0",
        bin: {
          "good-cmd": "./bin/good.js",
          "bad-cmd": "../../../etc/shadow",
          "also-good": "lib/index.js",
        },
      }),
      "map-pkg/bin/good.js": "#!/usr/bin/env node\nconsole.log('good');",
      "map-pkg/lib/index.js": "#!/usr/bin/env node\nconsole.log('also good');",
    });

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    // Good bins should be linked correctly
    const binDir = join(String(dir), "node_modules", ".bin");
    expect(await exists(binDir)).toBe(true);

    const bins = await readdirSorted(binDir);
    expect(bins).toHaveBins(["also-good", "good-cmd"]);
    expect(join(binDir, "good-cmd")).toBeValidBin(join("..", "map-pkg", "bin", "good.js"));
    expect(join(binDir, "also-good")).toBeValidBin(join("..", "map-pkg", "lib", "index.js"));

    // bad-cmd should NOT be in the bin directory
    if (!isWindows) {
      expect(bins).not.toContain("bad-cmd");
    } else {
      expect(bins).not.toContain("bad-cmd.exe");
    }
  });

  it("should normalize bin named_file target with traversal", async () => {
    // Test a package where the single "bin" field is a string (named_file case)
    // with a traversal path
    using dir = tempDir("bin-target-named", {
      "package.json": JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          "named-pkg": "file:./named-pkg",
        },
      }),
      "named-pkg/package.json": JSON.stringify({
        name: "named-pkg",
        version: "1.0.0",
        bin: "../../etc/shadow",
      }),
      "named-pkg/index.js": "module.exports = {};",
    });

    await using proc = spawn({
      cmd: [bunExe(), "install"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    // No bin should be created
    const binDir = join(String(dir), "node_modules", ".bin");
    const binDirExists = await exists(binDir);

    if (binDirExists) {
      const bins = await readdirSorted(binDir);
      if (!isWindows) {
        expect(bins).not.toContain("named-pkg");
      } else {
        expect(bins).not.toContain("named-pkg.exe");
      }
    }
  });
});
