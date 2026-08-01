import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, realpathSync, statSync, symlinkSync } from "fs";
import { rm, writeFile } from "fs/promises";
import { bunEnv, bunExe, isWindows, tempDir, VerdaccioRegistry } from "harness";
import { join } from "path";

let verdaccio: VerdaccioRegistry;

setDefaultTimeout(1000 * 60 * 5);

beforeAll(async () => {
  verdaccio = new VerdaccioRegistry();
  await verdaccio.start();
});

afterAll(() => {
  verdaccio.stop();
});

describe.skipIf(isWindows).concurrent("native binlink optimization", () => {
  for (const linker of ["hoisted", "isolated"]) {
    test(`uses platform-specific bin instead of main package bin with linker ${linker}`, async () => {
      let env = { ...bunEnv };
      const { packageDir, packageJson } = await verdaccio.createTestDir();
      env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
      env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");

      // Create bunfig
      await writeFile(
        join(packageDir, "bunfig.toml"),
        `
[install]
cache = "${join(packageDir, ".bun-cache").replaceAll("\\", "\\\\")}"
registry = "${verdaccio.registryUrl()}"
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
      const { packageDir, packageJson } = await verdaccio.createTestDir();
      env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
      env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");

      await writeFile(
        join(packageDir, "bunfig.toml"),
        `
[install]
cache = "${join(packageDir, ".bun-cache").replaceAll("\\", "\\\\")}"
registry = "${verdaccio.registryUrl()}"
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
      const { packageDir, packageJson } = await verdaccio.createTestDir();
      env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
      env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");

      await writeFile(
        join(packageDir, "bunfig.toml"),
        `
[install]
cache = "${join(packageDir, ".bun-cache").replaceAll("\\", "\\\\")}"
registry = "${verdaccio.registryUrl()}"
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

  // The postinstall skip must apply to every copy of a nativeDependencies
  // package in the tree, not just the hoisted one. Previously a second,
  // differently-versioned esbuild nested under a transitive dependent would
  // still run `node install.js`.
  describe("nested nativeDependencies", () => {
    async function setup(opts: { linker: "hoisted" | "isolated"; deps: Record<string, string>; extraEnv?: object }) {
      let env: Record<string, string> = { ...bunEnv, ...(opts.extraEnv ?? {}) };
      const { packageDir, packageJson } = await verdaccio.createTestDir();
      env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
      env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");

      await writeFile(
        join(packageDir, "bunfig.toml"),
        `
[install]
cache = "${join(packageDir, ".bun-cache").replaceAll("\\", "\\\\")}"
registry = "${verdaccio.registryUrl()}"
linker = "${opts.linker}"
`,
      );

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "test-app",
          version: "1.0.0",
          dependencies: opts.deps,
          nativeDependencies: ["test-postinstall-skip"],
          trustedDependencies: ["test-postinstall-skip"],
        }),
      );

      async function install() {
        const proc = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "ignore",
          stderr: "pipe",
          env,
        });
        const [, stderr, exit] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stderr).not.toContain("error:");
        expect(exit).toBe(0);
      }

      async function runBin(binPath: string) {
        const proc = spawn({ cmd: [binPath], cwd: packageDir, stdout: "pipe", stdin: "ignore", stderr: "pipe", env });
        const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { out: out.trim(), err, code };
      }

      return { packageDir, env, install, runBin };
    }

    function postinstallRanMarkers(dirs: Record<string, string>) {
      return Object.fromEntries(Object.entries(dirs).map(([k, d]) => [k, existsSync(join(d, "postinstall-ran"))]));
    }

    for (const linker of ["hoisted", "isolated"] as const) {
      test(`skips postinstall for nested copies (${linker}, platform dep in child tree)`, async () => {
        const { packageDir, install, runBin } = await setup({
          linker,
          deps: { "test-postinstall-skip": "2.0.0", "test-postinstall-skip-parent": "1.0.0" },
        });
        await install();

        const nm = join(packageDir, "node_modules");
        const nestedScope =
          linker === "hoisted"
            ? join(nm, "test-postinstall-skip-parent", "node_modules")
            : join(nm, ".bun", "test-postinstall-skip-parent@1.0.0", "node_modules");
        const hoisted = realpathSync(join(nm, "test-postinstall-skip"));
        const nested = realpathSync(join(nestedScope, "test-postinstall-skip"));
        expect({
          hoisted: JSON.parse(readFileSync(join(hoisted, "package.json"), "utf8")).version,
          nested: JSON.parse(readFileSync(join(nested, "package.json"), "utf8")).version,
        }).toEqual({ hoisted: "2.0.0", nested: "1.0.0" });

        expect(postinstallRanMarkers({ hoisted, nested })).toEqual({ hoisted: false, nested: false });

        const hoistedBin = join(nm, ".bin", "skip-test-cmd");
        const nestedBin = join(nestedScope, ".bin", "skip-test-cmd");
        expect(realpathSync(hoistedBin)).toContain("test-postinstall-skip-native");
        expect(realpathSync(nestedBin)).toContain("test-postinstall-skip-native");
        if (linker === "hoisted") {
          // The platform dep lands in the child tree under
          // `test-postinstall-skip/node_modules/`, so the redirect has to cross
          // trees (covers the `target_tree_id != tree_id` defer-and-relink path).
          expect(realpathSync(nestedBin)).toContain(
            join("test-postinstall-skip", "node_modules", "test-postinstall-skip-native"),
          );
        }
        expect(await runBin(hoistedBin)).toEqual({ out: "native v2.0.0", err: "", code: 0 });
        expect(await runBin(nestedBin)).toEqual({ out: "native v1.0.0", err: "", code: 0 });

        // Lockfile-only reinstall.
        await rm(nm, { recursive: true, force: true });
        await install();
        expect(postinstallRanMarkers({ hoisted, nested })).toEqual({ hoisted: false, nested: false });
        expect(realpathSync(nestedBin)).toContain("test-postinstall-skip-native");
        expect(await runBin(hoistedBin)).toEqual({ out: "native v2.0.0", err: "", code: 0 });
        expect(await runBin(nestedBin)).toEqual({ out: "native v1.0.0", err: "", code: 0 });

        // No-op reinstall keeps the redirect intact.
        await install();
        expect(postinstallRanMarkers({ hoisted, nested })).toEqual({ hoisted: false, nested: false });
        expect(await runBin(nestedBin)).toEqual({ out: "native v1.0.0", err: "", code: 0 });

        if (linker === "hoisted") {
          // Removing only the nested `.bin` folder and reinstalling recreates the redirect.
          await rm(join(nestedScope, ".bin"), { recursive: true, force: true });
          await install();
          expect(realpathSync(nestedBin)).toContain("test-postinstall-skip-native");
          expect(await runBin(nestedBin)).toEqual({ out: "native v1.0.0", err: "", code: 0 });
        }
      });
    }

    test("skips postinstall for nested copies (hoisted, platform dep as sibling)", async () => {
      // parent@2.0.0 also depends on test-postinstall-skip-native@1.0.0 directly,
      // so the platform package lands in the same tree as the nested main package.
      const { packageDir, install, runBin } = await setup({
        linker: "hoisted",
        deps: { "test-postinstall-skip": "2.0.0", "test-postinstall-skip-parent": "2.0.0" },
      });
      await install();

      const nested = join(packageDir, "node_modules", "test-postinstall-skip-parent", "node_modules");
      expect(existsSync(join(nested, "test-postinstall-skip-native"))).toBeTrue();
      expect(existsSync(join(nested, "test-postinstall-skip", "node_modules"))).toBeFalse();

      expect(
        postinstallRanMarkers({
          hoisted: join(packageDir, "node_modules", "test-postinstall-skip"),
          nested: join(nested, "test-postinstall-skip"),
        }),
      ).toEqual({ hoisted: false, nested: false });

      const nestedBin = join(nested, ".bin", "skip-test-cmd");
      expect(realpathSync(nestedBin)).toBe(realpathSync(join(nested, "test-postinstall-skip-native", "bin", "cmd.js")));
      expect(await runBin(nestedBin)).toEqual({ out: "native v1.0.0", err: "", code: 0 });
    });

    test("skips postinstall for nested copies (hoisted, platform dep in ancestor tree)", async () => {
      // Root depends on native@1.0.0 directly and on skip@2.0.0. The nested
      // skip@1.0.0's optional native@1.0.0 dedupes into root, so the redirect
      // crosses upward into tree 0.
      const { packageDir, install, runBin } = await setup({
        linker: "hoisted",
        deps: {
          "test-postinstall-skip": "2.0.0",
          "test-postinstall-skip-native": "1.0.0",
          "test-postinstall-skip-parent": "1.0.0",
        },
      });
      await install();

      const nested = join(packageDir, "node_modules", "test-postinstall-skip-parent", "node_modules");
      // native@1.0.0 is at root; nothing under the nested tree.
      expect(
        JSON.parse(
          readFileSync(join(packageDir, "node_modules", "test-postinstall-skip-native", "package.json"), "utf8"),
        ).version,
      ).toBe("1.0.0");
      expect(existsSync(join(nested, "test-postinstall-skip-native"))).toBeFalse();
      expect(existsSync(join(nested, "test-postinstall-skip", "node_modules"))).toBeFalse();

      expect(
        postinstallRanMarkers({
          nested: join(nested, "test-postinstall-skip"),
        }),
      ).toEqual({ nested: false });

      const nestedBin = join(nested, ".bin", "skip-test-cmd");
      expect(realpathSync(nestedBin)).toBe(
        realpathSync(join(packageDir, "node_modules", "test-postinstall-skip-native", "bin", "cmd.js")),
      );
      expect(await runBin(nestedBin)).toEqual({ out: "native v1.0.0", err: "", code: 0 });
    });

    test("BUN_FEATURE_FLAG_DISABLE_IGNORE_SCRIPTS runs nested postinstall", async () => {
      const { packageDir, install } = await setup({
        linker: "hoisted",
        deps: { "test-postinstall-skip": "2.0.0", "test-postinstall-skip-parent": "1.0.0" },
        extraEnv: { BUN_FEATURE_FLAG_DISABLE_IGNORE_SCRIPTS: "1" },
      });
      await install();

      expect(
        postinstallRanMarkers({
          hoisted: join(packageDir, "node_modules", "test-postinstall-skip"),
          nested: join(
            packageDir,
            "node_modules",
            "test-postinstall-skip-parent",
            "node_modules",
            "test-postinstall-skip",
          ),
        }),
      ).toEqual({ hoisted: true, nested: true });
    });
  });
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
