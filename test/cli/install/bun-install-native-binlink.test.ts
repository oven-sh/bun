import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, realpathSync, statSync, symlinkSync } from "fs";
import { rm, writeFile } from "fs/promises";
import { bunEnv, bunExe, isWindows, tempDir, TestRegistry } from "harness";
import { join } from "path";

let registry: TestRegistry;

setDefaultTimeout(1000 * 60 * 5);

beforeAll(async () => {
  registry = new TestRegistry();
  await registry.start();
});

afterAll(() => {
  registry.stop();
});

describe.skipIf(isWindows).concurrent("native binlink optimization", () => {
  for (const linker of ["hoisted", "isolated"]) {
    test(`uses platform-specific bin instead of main package bin with linker ${linker}`, async () => {
      let env = { ...bunEnv };
      const { packageDir, packageJson } = await registry.createTestDir();
      env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
      env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");

      // Create bunfig
      await writeFile(
        join(packageDir, "bunfig.toml"),
        `
[install]
cache = "${join(packageDir, ".bun-cache").replaceAll("\\", "\\\\")}"
registry = "${registry.registryUrl()}"
linker = "${linker}"
`,
      );

      // Install the main package
      await writeFile(
        packageJson,
        JSON.stringify({
          name: "test-app",
          version: "1.0.0",
          dependencies: {
            "test-native-binlink": "1.0.0",
          },
          nativeDependencies: ["test-native-binlink"],
          trustedDependencies: ["test-native-binlink"],
        }),
      );

      const installProc = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "inherit",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });

      expect(await installProc.exited).toBe(0);

      // Run the bin - it should use the platform-specific one (exit code 0)
      // not the main package one (exit code 1)
      const binProc = spawn({
        cmd: [join(packageDir, "node_modules", ".bin", "test-binlink-cmd")],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });

      const [binStdout, binExitCode] = await Promise.all([binProc.stdout.text(), binProc.exited]);

      // Should exit with 0 (platform-specific) not 1 (main package)
      expect(binExitCode).toBe(0);
      expect(binStdout).toContain("SUCCESS: Using platform-specific bin");

      // Now delete the node_modules folder, keep the bun.lock, re-install
      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      const installProc2 = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "inherit",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });
      expect(await installProc2.exited).toBe(0);

      const binProc2 = spawn({
        cmd: [join(packageDir, "node_modules", ".bin", "test-binlink-cmd")],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });
      const [binStdout2, binExitCode2] = await Promise.all([binProc2.stdout.text(), binProc2.exited]);
      expect(binStdout2).toContain("SUCCESS: Using platform-specific bin");
      expect(binExitCode2).toBe(0);

      // Now do a no-op re-install.
      const installProc3 = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "inherit",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });
      expect(await installProc3.exited).toBe(0);

      const binProc3 = spawn({
        cmd: [join(packageDir, "node_modules", ".bin", "test-binlink-cmd")],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });
      const [binStdout3, binExitCode3] = await Promise.all([binProc3.stdout.text(), binProc3.exited]);
      expect(binStdout3).toContain("SUCCESS: Using platform-specific bin");
      expect(binExitCode3).toBe(0);

      // Now do an install with the .bin folder gone
      await rm(join(packageDir, "node_modules", ".bin"), { recursive: true, force: true });
      const installProc4 = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "inherit",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });
      expect(await installProc4.exited).toBe(0);

      const binProc4 = spawn({
        cmd: [join(packageDir, "node_modules", ".bin", "test-binlink-cmd")],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });
      const [binStdout4, binExitCode4] = await Promise.all([binProc4.stdout.text(), binProc4.exited]);
      expect(binStdout4).toContain("SUCCESS: Using platform-specific bin");
      expect(binExitCode4).toBe(0);
    });

    // Regression: a package on the nativeDependencies list whose platform-specific
    // optionalDependency does NOT contain the bin file at the expected path must
    // fall back to linking the original package's bin. Previously the `seen` map
    // was poisoned by the failed redirect attempt, so the retry silently no-op'd
    // and `.bin/<cmd>` was never created (broke `bunx @anthropic-ai/claude-code`).
    test(`falls back to main package bin when platform dep has no matching bin file with linker ${linker}`, async () => {
      let env = { ...bunEnv };
      const { packageDir, packageJson } = await registry.createTestDir();
      env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
      env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");

      await writeFile(
        join(packageDir, "bunfig.toml"),
        `
[install]
cache = "${join(packageDir, ".bun-cache").replaceAll("\\", "\\\\")}"
registry = "${registry.registryUrl()}"
linker = "${linker}"
`,
      );

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "test-app",
          version: "1.0.0",
          dependencies: {
            "test-native-binlink-fallback": "1.0.0",
          },
          nativeDependencies: ["test-native-binlink-fallback"],
          trustedDependencies: ["test-native-binlink-fallback"],
        }),
      );

      const installProc = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      const [, installStderr, installExit] = await Promise.all([
        installProc.stdout.text(),
        installProc.stderr.text(),
        installProc.exited,
      ]);
      expect(installStderr).not.toContain("error:");
      expect(installExit).toBe(0);

      const binProc = spawn({
        cmd: [join(packageDir, "node_modules", ".bin", "fallback-cmd")],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });
      const [binStdout, binExitCode] = await Promise.all([binProc.stdout.text(), binProc.exited]);
      expect(binStdout).toContain("SUCCESS: Using main package bin");
      expect(binExitCode).toBe(0);

      // Re-install with node_modules removed (lockfile-only path)
      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      const installProc2 = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "inherit",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });
      expect(await installProc2.exited).toBe(0);

      const binProc2 = spawn({
        cmd: [join(packageDir, "node_modules", ".bin", "fallback-cmd")],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });
      const [binStdout2, binExitCode2] = await Promise.all([binProc2.stdout.text(), binProc2.exited]);
      expect(binStdout2).toContain("SUCCESS: Using main package bin");
      expect(binExitCode2).toBe(0);
    });

    // Regression for `bunx @anthropic-ai/claude-code` silently exiting: the
    // parent package's `bin` points at `bin/<name>.exe` (a placeholder stub
    // with no shebang that postinstall is meant to replace) while the platform
    // optionalDependency ships the real binary at the package root under the
    // bin name. The redirect must find it there instead of falling back to the
    // un-execable stub.
    test(`finds native bin at package root when parent bin path differs with linker ${linker}`, async () => {
      let env = { ...bunEnv };
      const { packageDir, packageJson } = await registry.createTestDir();
      env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
      env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");

      await writeFile(
        join(packageDir, "bunfig.toml"),
        `
[install]
cache = "${join(packageDir, ".bun-cache").replaceAll("\\", "\\\\")}"
registry = "${registry.registryUrl()}"
linker = "${linker}"
`,
      );

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "test-app",
          version: "1.0.0",
          dependencies: {
            "test-native-binlink-altpath": "1.0.0",
          },
          nativeDependencies: ["test-native-binlink-altpath"],
          trustedDependencies: ["test-native-binlink-altpath"],
        }),
      );

      const installProc = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      const [, installStderr, installExit] = await Promise.all([
        installProc.stdout.text(),
        installProc.stderr.text(),
        installProc.exited,
      ]);
      expect(installStderr).not.toContain("error:");
      expect(installExit).toBe(0);

      const binPath = join(packageDir, "node_modules", ".bin", "altpath-cmd");
      // The symlink should resolve into the platform-specific package, not
      // back into the parent package's placeholder stub.
      expect(realpathSync(binPath)).toContain("test-native-binlink-altpath-target");

      const binProc = spawn({
        cmd: [binPath],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      const [binStdout, binStderr, binExitCode] = await Promise.all([
        binProc.stdout.text(),
        binProc.stderr.text(),
        binProc.exited,
      ]);
      expect({ stdout: binStdout, stderr: binStderr }).toEqual({
        stdout: expect.stringContaining("SUCCESS: Using platform-specific bin at package root"),
        stderr: "",
      });
      expect(binExitCode).toBe(0);

      // Because the redirect succeeded, the postinstall should have been
      // skipped entirely (that's the point of the optimization).
      expect(
        existsSync(join(packageDir, "node_modules", "test-native-binlink-altpath", "postinstall-ran")),
      ).toBeFalse();

      // Re-install with node_modules removed (lockfile-only path)
      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      const installProc2 = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "inherit",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });
      expect(await installProc2.exited).toBe(0);

      const binProc2 = spawn({
        cmd: [join(packageDir, "node_modules", ".bin", "altpath-cmd")],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "inherit",
        env,
      });
      const [binStdout2, binExitCode2] = await Promise.all([binProc2.stdout.text(), binProc2.exited]);
      expect(binStdout2).toContain("SUCCESS: Using platform-specific bin at package root");
      expect(binExitCode2).toBe(0);
    });
  }
});

// The bin linker must not create a `node_modules/.bin` entry (nor chmod or rewrite the
// target) when a package's bin path resolves through an in-package symlink to a location
// outside the package directory. Bins that resolve inside the package must still link,
// including for workspace packages whose node_modules entry is itself a symlink.
test.skipIf(isWindows)(
  "skips bin entries whose target resolves outside the package directory and keeps outside files untouched",
  async () => {
    const secretContents = "#!/usr/bin/env node\r\nconsole.log('outside file');\n";
    using dir = tempDir("binlink-resolved-target", {
      "package.json": JSON.stringify({
        name: "binlink-containment-app",
        version: "1.0.0",
        workspaces: ["packages/*"],
        dependencies: {
          "resolved-escape-pkg": "workspace:*",
          "contained-bin-pkg": "workspace:*",
        },
      }),
      "outside/secret.txt": secretContents,
      "packages/resolved-escape-pkg/package.json": JSON.stringify({
        name: "resolved-escape-pkg",
        version: "1.0.0",
        bin: { "escape-cmd": "./payload/secret.txt" },
      }),
      "packages/contained-bin-pkg/package.json": JSON.stringify({
        name: "contained-bin-pkg",
        version: "1.0.0",
        bin: { "contained-cmd": "bin/run.js" },
      }),
      "packages/contained-bin-pkg/bin/run.js": '#!/usr/bin/env node\nconsole.log("contained-cmd ok");\n',
    });

    const root = String(dir);
    const secretPath = join(root, "outside", "secret.txt");
    // A mode without any execute bits, so a chmod performed by bin linking is observable.
    chmodSync(secretPath, 0o600);
    // In-package path component that resolves to a directory outside the package.
    symlinkSync(join(root, "outside"), join(root, "packages", "resolved-escape-pkg", "payload"));

    await using install = spawn({
      cmd: [bunExe(), "install"],
      cwd: root,
      stdout: "ignore",
      stdin: "ignore",
      stderr: "pipe",
      env: bunEnv,
    });
    const [installStderr, installExit] = await Promise.all([install.stderr.text(), install.exited]);
    expect(installStderr).not.toContain("error:");
    expect(installExit).toBe(0);

    // The file outside the package keeps its mode and contents.
    expect(statSync(secretPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(secretPath, "utf8")).toBe(secretContents);

    // No `.bin` entry was created for the bin whose resolved target leaves the package.
    expect(existsSync(join(root, "node_modules", ".bin", "escape-cmd"))).toBeFalse();

    // The workspace bin that resolves inside its package is still linked and made executable,
    // even though node_modules/<name> is a symlink into packages/.
    const containedBin = join(root, "node_modules", ".bin", "contained-cmd");
    expect(existsSync(containedBin)).toBeTrue();
    expect(realpathSync(containedBin)).toBe(realpathSync(join(root, "packages", "contained-bin-pkg", "bin", "run.js")));
    expect(statSync(join(root, "packages", "contained-bin-pkg", "bin", "run.js")).mode & 0o111).not.toBe(0);
  },
);
