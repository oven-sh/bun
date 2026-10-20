import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, readFileSync, realpathSync, statSync, symlinkSync } from "fs";
import { mkdir, rm, writeFile } from "fs/promises";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join, sep } from "path";
import { TestRegistry } from "registry";

let verdaccio: TestRegistry;

setDefaultTimeout(1000 * 60 * 5);

beforeAll(async () => {
  verdaccio = new TestRegistry();
  await verdaccio.start();
});

afterAll(() => {
  verdaccio.stop();
});

// POSIX puts a symlink at `.bin/<name>`. Windows writes `<name>.exe` (a copy
// of the shim PE) plus `<name>.bunx` whose first UTF-16LE field is the target
// path relative to node_modules.
function binEntry(binDir: string, name: string) {
  return join(binDir, isWindows ? `${name}.exe` : name);
}
function readBinTarget(binDir: string, name: string) {
  if (isWindows) {
    const raw = readFileSync(join(binDir, `${name}.bunx`)).toString("utf16le");
    // bin_path is terminated by `"` then NUL; keep only the path and normalize
    // separators so callers can compare against join() output.
    const end = raw.indexOf('"');
    return (end === -1 ? raw : raw.slice(0, end)).replaceAll("/", sep);
  }
  return realpathSync(join(binDir, name));
}

describe.concurrent("native binlink optimization", () => {
  for (const linker of ["hoisted", "isolated"]) {
    test(`uses platform-specific bin instead of main package bin with linker ${linker}`, async () => {
      let env = { ...bunEnv };
      const { packageDir, packageJson } = await verdaccio.createTestDir();
      env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
      env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");

      // Create bunfig
      await writeFile(
        join(packageDir, "bunfig.toml"),
        Bun.TOML.stringify({
          install: {
            cache: join(packageDir, ".bun-cache"),
            registry: verdaccio.registryUrl(),
            linker,
          },
        }),
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

      const binDir = join(packageDir, "node_modules", ".bin");
      const binPath = binEntry(binDir, "test-binlink-cmd");

      async function runInstall() {
        const proc = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "inherit",
          stdin: "ignore",
          stderr: "inherit",
          env,
        });
        expect(await proc.exited).toBe(0);
      }

      async function expectPlatformBin() {
        const proc = spawn({
          cmd: [binPath],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "ignore",
          stderr: "inherit",
          env,
        });
        const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
        expect(stdout).toContain("SUCCESS: Using platform-specific bin");
        expect(exitCode).toBe(0);
      }

      await runInstall();
      expect(readBinTarget(binDir, "test-binlink-cmd")).toContain(join("test-native-binlink-target", "bin", "main.js"));
      await expectPlatformBin();

      // Now delete the node_modules folder, keep the bun.lock, re-install
      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await runInstall();
      await expectPlatformBin();

      // Now do a no-op re-install.
      await runInstall();
      await expectPlatformBin();

      // Now do an install with the .bin folder gone
      await rm(binDir, { recursive: true, force: true });
      await runInstall();
      await expectPlatformBin();
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
        Bun.TOML.stringify({
          install: {
            cache: join(packageDir, ".bun-cache"),
            registry: verdaccio.registryUrl(),
            linker,
          },
        }),
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

      const binDir = join(packageDir, "node_modules", ".bin");
      const binPath = binEntry(binDir, "fallback-cmd");
      expect(readBinTarget(binDir, "fallback-cmd")).toContain(join("test-native-binlink-fallback", "cli.js"));

      const binProc = spawn({
        cmd: [binPath],
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
        cmd: [binPath],
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
  }

  // The link leaves node_modules, so its text depends on where node_modules really is.
  test.skipIf(isWindows)("in a workspace whose node_modules is a link to another folder", async () => {
    const { packageDir, packageJson } = await verdaccio.createTestDir();
    const env = { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(packageDir, ".bun-cache") };
    const app = join(packageDir, "packages", "app");
    await mkdir(app, { recursive: true });
    await mkdir(join(packageDir, "volume"));
    symlinkSync(join("..", "..", "volume"), join(app, "node_modules"));
    await Promise.all([
      writeFile(
        join(packageDir, "bunfig.toml"),
        Bun.TOML.stringify({
          install: { cache: join(packageDir, ".bun-cache"), registry: verdaccio.registryUrl(), linker: "isolated" },
        }),
      ),
      writeFile(
        packageJson,
        JSON.stringify({
          name: "test-app",
          workspaces: ["packages/*"],
          nativeDependencies: ["test-native-binlink"],
          trustedDependencies: ["test-native-binlink"],
        }),
      ),
      writeFile(
        join(app, "package.json"),
        JSON.stringify({ name: "app", dependencies: { "test-native-binlink": "1.0.0" } }),
      ),
    ]);

    const binDir = join(app, "node_modules", ".bin");
    for (const removed of [null, null, binDir]) {
      if (removed) await rm(removed, { recursive: true });
      await using proc = spawn({ cmd: [bunExe(), "install"], cwd: packageDir, stdout: "pipe", stderr: "pipe", env });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(stderr).not.toContain("error:");
      expect(lstatSync(join(app, "node_modules")).isSymbolicLink()).toBe(true);
      expect(readBinTarget(binDir, "test-binlink-cmd")).toContain(join("test-native-binlink-target", "bin", "main.js"));
      expect(exitCode).toBe(0);
    }
  });

  // test-native-binlink-libc has a glibc and a musl platform package with identical os/cpu
  // lists (the shape of @anthropic-ai/claude-code, which is on the default list). Only the one
  // matching the target libc is installed, so the bin has to be linked to that one and not to
  // whichever comes first.
  for (const linker of ["hoisted", "isolated"]) {
    for (const libc of ["glibc", "musl"]) {
      test(`links the bin to the ${libc} platform package with linker ${linker}`, async () => {
        const env = { ...bunEnv };
        const { packageDir, packageJson } = await verdaccio.createTestDir();
        env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
        env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");

        await writeFile(
          join(packageDir, "bunfig.toml"),
          Bun.TOML.stringify({
            install: {
              cache: join(packageDir, ".bun-cache"),
              registry: verdaccio.registryUrl(),
              linker,
            },
          }),
        );
        await writeFile(
          packageJson,
          JSON.stringify({
            name: "test-app",
            version: "1.0.0",
            dependencies: { "test-native-binlink-libc": "1.0.0" },
            nativeDependencies: ["test-native-binlink-libc"],
            trustedDependencies: ["test-native-binlink-libc"],
          }),
        );

        const install = spawn({
          cmd: [bunExe(), "install", "--libc", libc],
          cwd: packageDir,
          stdout: "ignore",
          stdin: "ignore",
          stderr: "pipe",
          env,
        });
        const [installStderr, installExitCode] = await Promise.all([install.stderr.text(), install.exited]);
        expect(installStderr).not.toContain("error:");
        expect(installExitCode).toBe(0);

        const binDir = join(packageDir, "node_modules", ".bin");
        expect(readBinTarget(binDir, "test-binlink-libc-cmd")).toContain(
          join(`test-native-binlink-libc-${libc}`, "bin", "main.js"),
        );

        const bin = spawn({
          cmd: [binEntry(binDir, "test-binlink-libc-cmd")],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "ignore",
          stderr: "inherit",
          env,
        });
        const [binStdout, binExitCode] = await Promise.all([bin.stdout.text(), bin.exited]);
        expect(binStdout).toContain(`SUCCESS: Using test-native-binlink-libc-${libc}`);
        expect(binExitCode).toBe(0);
      });
    }
  }

  // The postinstall skip must apply to every copy of a nativeDependencies
  // package in the tree, not just the hoisted one. Previously a second,
  // differently-versioned esbuild nested under a transitive dependent would
  // still run `node install.js`.
  describe("nested nativeDependencies", () => {
    async function setup(opts: { linker: "hoisted" | "isolated"; deps: Record<string, string>; extraEnv?: object }) {
      let env: NodeJS.Dict<string> = { ...bunEnv, ...(opts.extraEnv ?? {}) };
      const { packageDir, packageJson } = await verdaccio.createTestDir();
      env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
      env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");

      await writeFile(
        join(packageDir, "bunfig.toml"),
        Bun.TOML.stringify({
          install: {
            cache: join(packageDir, ".bun-cache"),
            registry: verdaccio.registryUrl(),
            linker: opts.linker,
          },
        }),
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

      async function runBin(binDir: string, name: string) {
        const proc = spawn({
          cmd: [binEntry(binDir, name)],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "ignore",
          stderr: "pipe",
          env,
        });
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

        const hoistedBinDir = join(nm, ".bin");
        const nestedBinDir = join(nestedScope, ".bin");
        expect(readBinTarget(hoistedBinDir, "skip-test-cmd")).toContain("test-postinstall-skip-native");
        expect(readBinTarget(nestedBinDir, "skip-test-cmd")).toContain("test-postinstall-skip-native");
        if (linker === "hoisted") {
          // The platform dep lands in the child tree under
          // `test-postinstall-skip/node_modules/`, so the redirect has to cross
          // trees (covers the `target_tree_id != tree_id` defer-and-relink path).
          expect(readBinTarget(nestedBinDir, "skip-test-cmd")).toContain(
            join("test-postinstall-skip", "node_modules", "test-postinstall-skip-native"),
          );
        }
        expect(await runBin(hoistedBinDir, "skip-test-cmd")).toEqual({ out: "native v2.0.0", err: "", code: 0 });
        expect(await runBin(nestedBinDir, "skip-test-cmd")).toEqual({ out: "native v1.0.0", err: "", code: 0 });

        // Lockfile-only reinstall.
        await rm(nm, { recursive: true, force: true });
        await install();
        expect(postinstallRanMarkers({ hoisted, nested })).toEqual({ hoisted: false, nested: false });
        expect(readBinTarget(nestedBinDir, "skip-test-cmd")).toContain("test-postinstall-skip-native");
        expect(await runBin(hoistedBinDir, "skip-test-cmd")).toEqual({ out: "native v2.0.0", err: "", code: 0 });
        expect(await runBin(nestedBinDir, "skip-test-cmd")).toEqual({ out: "native v1.0.0", err: "", code: 0 });

        // No-op reinstall keeps the redirect intact.
        await install();
        expect(postinstallRanMarkers({ hoisted, nested })).toEqual({ hoisted: false, nested: false });
        expect(await runBin(nestedBinDir, "skip-test-cmd")).toEqual({ out: "native v1.0.0", err: "", code: 0 });

        if (linker === "hoisted") {
          // Removing only the nested `.bin` folder and reinstalling recreates the redirect.
          await rm(nestedBinDir, { recursive: true, force: true });
          await install();
          expect(readBinTarget(nestedBinDir, "skip-test-cmd")).toContain("test-postinstall-skip-native");
          expect(await runBin(nestedBinDir, "skip-test-cmd")).toEqual({ out: "native v1.0.0", err: "", code: 0 });
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

      const nestedBinDir = join(nested, ".bin");
      if (isWindows) {
        expect(readBinTarget(nestedBinDir, "skip-test-cmd")).toBe(
          join("test-postinstall-skip-native", "bin", "cmd.js"),
        );
      } else {
        expect(readBinTarget(nestedBinDir, "skip-test-cmd")).toBe(
          realpathSync(join(nested, "test-postinstall-skip-native", "bin", "cmd.js")),
        );
      }
      expect(await runBin(nestedBinDir, "skip-test-cmd")).toEqual({ out: "native v1.0.0", err: "", code: 0 });
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

      const nestedBinDir = join(nested, ".bin");
      if (isWindows) {
        expect(readBinTarget(nestedBinDir, "skip-test-cmd")).toBe(
          join("..", "..", "test-postinstall-skip-native", "bin", "cmd.js"),
        );
      } else {
        expect(readBinTarget(nestedBinDir, "skip-test-cmd")).toBe(
          realpathSync(join(packageDir, "node_modules", "test-postinstall-skip-native", "bin", "cmd.js")),
        );
      }
      expect(await runBin(nestedBinDir, "skip-test-cmd")).toEqual({ out: "native v1.0.0", err: "", code: 0 });
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

  // The platform package stands in for the scripts of a nativeDependencies package only when the bins redirect into it.
  describe("lifecycle scripts follow the redirect of the bins", () => {
    const skip = "test-postinstall-skip";
    const skipNative = "test-postinstall-skip-native";
    const skipParent = "test-postinstall-skip-parent";
    const scripts = "test-native-binlink-scripts";
    const scriptsNative = "test-native-binlink-scripts-native";

    async function setup(opts: {
      linker: "hoisted" | "isolated";
      deps: Record<string, string>;
      native: string[];
      // `null` leaves the key out. The default is `native`.
      trusted?: string[] | null;
      ignoreScripts?: string[];
      registry?: TestRegistry;
      extraEnv?: object;
    }) {
      const registry = opts.registry ?? verdaccio;
      const { packageDir, packageJson } = await registry.createTestDir({ bunfigOpts: { linker: opts.linker } });
      const env: NodeJS.Dict<string> = { ...bunEnv, ...opts.extraEnv };
      env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
      env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");
      const nodeModules = join(packageDir, "node_modules");

      async function writeManifest(changes: { deps?: Record<string, string>; trusted?: string[] | null } = {}) {
        const trusted = changes.trusted !== undefined ? changes.trusted : opts.trusted;
        await writeFile(
          packageJson,
          JSON.stringify({
            name: "test-app",
            version: "1.0.0",
            dependencies: changes.deps ?? opts.deps,
            nativeDependencies: opts.native,
            trustedDependencies: trusted === undefined ? opts.native : (trusted ?? undefined),
            ignoreScripts: opts.ignoreScripts,
          }),
        );
      }
      await writeManifest();

      async function bun(...args: string[]) {
        await using proc = spawn({
          cmd: [bunExe(), ...args],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "ignore",
          stderr: "pipe",
          env,
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stdout, stderr, exitCode };
      }

      async function install(...args: string[]) {
        const { stderr, exitCode } = await bun("install", ...args);
        expect(stderr).not.toContain("error:");
        expect(exitCode).toBe(0);
      }

      // What the command prints.
      async function run(name: string, binDir = join(nodeModules, ".bin")) {
        await using proc = spawn({
          cmd: [binEntry(binDir, name)],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "ignore",
          stderr: "inherit",
          env,
        });
        const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);
        return stdout.trim();
      }

      // The lifecycle scripts that ran in the package.
      function ran(dir = join(nodeModules, opts.native[0])) {
        const pkg = realpathSync(dir);
        return ["preinstall", "postinstall"].filter(script => existsSync(join(pkg, `${script}-ran`)));
      }

      // Both linkers put a dependency beside the package that depends on it.
      function hasBeside(platformPackage: string, dir = join(nodeModules, opts.native[0])) {
        return existsSync(join(realpathSync(dir), "..", platformPackage, "package.json"));
      }

      // The `node_modules` that holds the dependencies of `name`.
      function scopeOf(name: string, version: string) {
        return opts.linker === "hoisted"
          ? join(nodeModules, name, "node_modules")
          : join(nodeModules, ".bun", `${name}@${version}`, "node_modules");
      }

      return { packageDir, packageJson, nodeModules, writeManifest, bun, install, run, ran, hasBeside, scopeOf };
    }

    function failDownloadOf(tarball: string) {
      return new TestRegistry({
        intercept: request =>
          request.url.endsWith(`/${tarball}`) ? new Response("not found", { status: 404 }) : undefined,
      }).start();
    }

    for (const linker of ["hoisted", "isolated"] as const) {
      test(`--omit=optional, then --offline, leave the platform package out (${linker})`, async () => {
        const { nodeModules, install, run, ran, hasBeside } = await setup({
          linker,
          deps: { [skip]: "2.0.0" },
          native: [skip],
        });
        const state = async () => ({ platform: hasBeside(skipNative), ran: ran(), bin: await run("skip-test-cmd") });
        const expected = { platform: false, ran: ["postinstall"], bin: "shim v2.0.0" };

        await install("--omit=optional");
        expect(await state()).toEqual(expected);

        // The cache does not have the platform package, so `--offline` cannot place it.
        await rm(nodeModules, { recursive: true, force: true });
        await install("--offline");
        expect(await state()).toEqual(expected);
      });

      test(`the platform package fails to download (${linker})`, async () => {
        using registry = failDownloadOf(`${skipNative}-2.0.0.tgz`);
        const { nodeModules, install, run, ran, hasBeside } = await setup({
          linker,
          registry,
          deps: { [skip]: "2.0.0" },
          native: [skip],
        });
        const state = async () => ({ platform: hasBeside(skipNative), ran: ran(), bin: await run("skip-test-cmd") });
        const expected = { platform: false, ran: ["postinstall"], bin: "shim v2.0.0" };

        await install();
        expect(await state()).toEqual(expected);

        // From bun.lock the download fails while the packages are placed, not while they are resolved.
        await rm(nodeModules, { recursive: true, force: true });
        await install();
        expect(await state()).toEqual(expected);
      });

      test(`the platform package does not have the bin (${linker})`, async () => {
        const { install, run, ran, hasBeside } = await setup({
          linker,
          deps: { [scripts]: "1.0.0" },
          native: [scripts],
        });

        await install();
        expect({ platform: hasBeside(scriptsNative), ran: ran(), bin: await run("scripts-test-cmd") }).toEqual({
          platform: true,
          ran: ["preinstall", "postinstall"],
          bin: "shim v1.0.0",
        });
      });

      test(`the platform package has one of two bins (${linker})`, async () => {
        const { install, run, ran } = await setup({ linker, deps: { [scripts]: "3.0.0" }, native: [scripts] });

        await install();
        expect({
          ran: ran(),
          cmd: await run("scripts-test-cmd"),
          other: await run("scripts-test-other"),
        }).toEqual({ ran: ["postinstall"], cmd: "native", other: "other v3.0.0" });
      });

      test(`the platform package has no file in the directories.bin folder (${linker})`, async () => {
        const { install, run, ran } = await setup({ linker, deps: { [scripts]: "4.0.0" }, native: [scripts] });

        await install();
        expect({ ran: ran(), bin: await run("scripts-test-tool") }).toEqual({
          ran: ["postinstall"],
          bin: "tool v4.0.0",
        });
      });

      // Without a bin, no link shows that the platform package is usable.
      test(`the package has no bin (${linker})`, async () => {
        const { install, ran, hasBeside } = await setup({ linker, deps: { [scripts]: "2.0.0" }, native: [scripts] });

        await install();
        expect({ platform: hasBeside(scriptsNative), ran: ran() }).toEqual({ platform: true, ran: ["postinstall"] });
      });

      test(`BUN_FEATURE_FLAG_DISABLE_NATIVE_DEPENDENCY_LINKER=1 (${linker})`, async () => {
        const { install, run, ran, hasBeside } = await setup({
          linker,
          deps: { [skip]: "2.0.0" },
          native: [skip],
          extraEnv: { BUN_FEATURE_FLAG_DISABLE_NATIVE_DEPENDENCY_LINKER: "1" },
        });

        await install();
        expect({ platform: hasBeside(skipNative), ran: ran(), bin: await run("skip-test-cmd") }).toEqual({
          platform: true,
          ran: ["postinstall"],
          bin: "shim v2.0.0",
        });
      });

      test(`the redirect also stands in for a preinstall (${linker})`, async () => {
        const { install, run, ran } = await setup({ linker, deps: { [scripts]: "5.0.0" }, native: [scripts] });

        await install();
        expect({ ran: ran(), bin: await run("scripts-test-cmd") }).toEqual({ ran: [], bin: "native" });
      });

      // `--omit=optional` cuts the platform package out of the package's dependencies. The root still installs it.
      test(`--omit=optional with the platform package as a direct dependency (${linker})`, async () => {
        const { install, run, ran } = await setup({
          linker,
          deps: { [skip]: "2.0.0", [skipNative]: "2.0.0" },
          native: [skip],
        });

        await install("--omit=optional");
        expect({ ran: ran(), bin: await run("skip-test-cmd") }).toEqual({ ran: [], bin: "native v2.0.0" });
      });

      // The second copy does not get the name in `.bin`. The platform package still has the bin.
      test(`a bin name that another copy of the package has taken changes nothing (${linker})`, async () => {
        const { nodeModules, install, run, ran } = await setup({
          linker,
          deps: { "aaa-skip": `npm:${skip}@2.0.0`, [skip]: "2.0.0" },
          native: [skip],
        });
        const state = async () => ({
          copy: ran(join(nodeModules, "aaa-skip")),
          skip: ran(),
          bin: await run("skip-test-cmd"),
        });

        await install();
        expect(await state()).toEqual({ copy: [], skip: [], bin: "native v2.0.0" });

        await rm(nodeModules, { recursive: true, force: true });
        await install("--omit=optional");
        expect(await state()).toEqual({ copy: ["postinstall"], skip: ["postinstall"], bin: "shim v2.0.0" });
      });

      test(`two packages in one node_modules and a nested copy each get their own answer (${linker})`, async () => {
        const { nodeModules, install, run, ran, scopeOf } = await setup({
          linker,
          deps: { [skip]: "2.0.0", [scripts]: "1.0.0", [skipParent]: "1.0.0" },
          native: [skip, scripts],
        });
        const nested = scopeOf(skipParent, "1.0.0");

        const state = async () => ({
          skip: ran(join(nodeModules, skip)),
          scripts: ran(join(nodeModules, scripts)),
          nested: ran(join(nested, skip)),
          skipBin: await run("skip-test-cmd"),
          scriptsBin: await run("scripts-test-cmd"),
          nestedBin: await run("skip-test-cmd", join(nested, ".bin")),
        });
        const expected = {
          skip: [],
          scripts: ["preinstall", "postinstall"],
          nested: [],
          skipBin: "native v2.0.0",
          scriptsBin: "shim v1.0.0",
          nestedBin: "native v1.0.0",
        };

        await install();
        expect(await state()).toEqual(expected);

        await rm(nodeModules, { recursive: true, force: true });
        await install();
        expect(await state()).toEqual(expected);
      });

      // Hoisted: the platform package of the nested copy is in a node_modules that is placed later.
      test(`the platform package of a nested copy fails to download (${linker})`, async () => {
        using registry = failDownloadOf(`${skipNative}-1.0.0.tgz`);
        const { nodeModules, install, run, ran, scopeOf } = await setup({
          linker,
          registry,
          deps: { [skip]: "2.0.0", [skipParent]: "1.0.0" },
          native: [skip],
        });
        const nested = scopeOf(skipParent, "1.0.0");

        await install();
        expect({
          hoisted: ran(),
          nested: ran(join(nested, skip)),
          hoistedBin: await run("skip-test-cmd"),
          nestedBin: await run("skip-test-cmd", join(nested, ".bin")),
        }).toEqual({ hoisted: [], nested: ["postinstall"], hoistedBin: "native v2.0.0", nestedBin: "shim v1.0.0" });
      });

      for (const [gate, options, args] of [
        ["a package that is not trusted", { trusted: [] }, []],
        ["--ignore-scripts", {}, ["--ignore-scripts"]],
        ["a package in ignoreScripts", { ignoreScripts: [scripts] }, []],
      ] as const) {
        test(`${gate} runs no script without the redirect either (${linker})`, async () => {
          const { install, run, ran } = await setup({
            linker,
            deps: { [scripts]: "1.0.0" },
            native: [scripts],
            ...options,
          });

          await install(...args);
          expect({ ran: ran(), bin: await run("scripts-test-cmd") }).toEqual({ ran: [], bin: "shim v1.0.0" });
        });
      }

      test(`a package in place that becomes trusted runs its scripts without the redirect (${linker})`, async () => {
        const { writeManifest, install, run, ran } = await setup({
          linker,
          deps: { [skip]: "2.0.0" },
          native: [skip],
          trusted: null,
        });
        const state = async () => ({ ran: ran(), bin: await run("skip-test-cmd") });

        await install("--omit=optional");
        expect(await state()).toEqual({ ran: [], bin: "shim v2.0.0" });

        await writeManifest({ trusted: [skip] });
        await install("--omit=optional");
        expect(await state()).toEqual({ ran: ["postinstall"], bin: "shim v2.0.0" });
      });

      test(`a package in place that becomes trusted keeps the redirect and runs no script (${linker})`, async () => {
        const { writeManifest, install, run, ran } = await setup({
          linker,
          deps: { [skip]: "2.0.0" },
          native: [skip],
          trusted: null,
        });
        const state = async () => ({ ran: ran(), bin: await run("skip-test-cmd") });

        await install();
        expect(await state()).toEqual({ ran: [], bin: "native v2.0.0" });

        await writeManifest({ trusted: [skip] });
        await install();
        expect(await state()).toEqual({ ran: [], bin: "native v2.0.0" });
      });

      test(`bun add --trust of a package in place runs its scripts without the redirect (${linker})`, async () => {
        const { packageJson, bun, install, run, ran } = await setup({
          linker,
          deps: { [skip]: "2.0.0" },
          native: [skip],
          trusted: null,
        });

        await install("--omit=optional");
        const { stderr, exitCode } = await bun("add", "--trust", `${skip}@2.0.0`, "--omit=optional");
        expect(stderr).not.toContain("error:");
        expect({
          ran: ran(),
          bin: await run("skip-test-cmd"),
          trusted: JSON.parse(readFileSync(packageJson, "utf8")).trustedDependencies,
        }).toEqual({ ran: ["postinstall"], bin: "shim v2.0.0", trusted: [skip] });
        expect(exitCode).toBe(0);
      });
    }

    // The nested copy still waits for its answer when the other script fails. In place it would count as installed.
    test("a failed script removes a package whose answer waits (hoisted)", async () => {
      const failing = "lifecycle-failing-postinstall";
      const deps = { [skip]: "2.0.0", [skipParent]: "1.0.0" };
      const { nodeModules, writeManifest, bun, install, run, ran, scopeOf } = await setup({
        linker: "hoisted",
        deps: { ...deps, [failing]: "1.0.0" },
        native: [skip],
        // The main thread places a trusted package itself, so the order of the packages is fixed.
        trusted: [skip, skipNative, skipParent, failing],
      });
      const nested = scopeOf(skipParent, "1.0.0");

      await install("--lockfile-only");
      const { stderr, exitCode } = await bun("install");
      expect(stderr).toContain(`script from "${failing}" exited with 1`);
      expect({
        root: existsSync(join(nodeModules, skip, "package.json")),
        nested: existsSync(join(nested, skip)),
      }).toEqual({ root: true, nested: false });
      expect(exitCode).toBe(1);

      await writeManifest({ deps });
      await install();
      expect({ ran: ran(join(nested, skip)), bin: await run("skip-test-cmd", join(nested, ".bin")) }).toEqual({
        ran: [],
        bin: "native v1.0.0",
      });
    });

    describe("bun add -g", () => {
      async function setupGlobal(linker: "hoisted" | "isolated") {
        const { packageDir } = await verdaccio.createTestDir({ bunfigOpts: { linker } });
        const binDir = join(packageDir, "global-bin-dir");
        const globalDir = join(packageDir, "global-install-dir", "install", "global");
        const env: NodeJS.Dict<string> = { ...bunEnv };
        env.BUN_INSTALL = join(packageDir, "global-install-dir");
        env.BUN_INSTALL_BIN = binDir;
        env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
        env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");
        await Promise.all([
          mkdir(binDir, { recursive: true }),
          mkdir(globalDir, { recursive: true }).then(() =>
            writeFile(
              join(globalDir, "package.json"),
              JSON.stringify({ dependencies: {}, nativeDependencies: [skip], trustedDependencies: [skip] }),
            ),
          ),
        ]);

        async function add() {
          await using proc = spawn({
            cmd: [bunExe(), "add", "-g", `--config=${join(packageDir, "bunfig.toml")}`, `${skip}@2.0.0`],
            cwd: packageDir,
            stdout: "pipe",
            stdin: "ignore",
            stderr: "pipe",
            env,
          });
          const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          return { stderr, exitCode };
        }

        const postinstallRan = () =>
          existsSync(join(realpathSync(join(globalDir, "node_modules", skip)), "postinstall-ran"));
        return { packageDir, binDir, env, add, postinstallRan };
      }

      for (const linker of ["hoisted", "isolated"] as const) {
        test(`links the bin into the platform package and runs no script (${linker})`, async () => {
          const { packageDir, binDir, env, add, postinstallRan } = await setupGlobal(linker);

          const { stderr, exitCode } = await add();
          expect(stderr).not.toContain("error:");
          await using proc = spawn({
            cmd: [binEntry(binDir, "skip-test-cmd")],
            cwd: packageDir,
            stdout: "pipe",
            stdin: "ignore",
            stderr: "inherit",
            env,
          });
          const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);
          expect({ postinstallRan: postinstallRan(), bin: stdout.trim() }).toEqual({
            postinstallRan: false,
            bin: "native v2.0.0",
          });
          expect(exitCode).toBe(0);
        });

        test(`reports a bin name that something else has taken once (${linker})`, async () => {
          const { binDir, add } = await setupGlobal(linker);
          await writeFile(join(binDir, isWindows ? "skip-test-cmd.exe" : "skip-test-cmd"), "not a bin of the package");

          const { stderr, exitCode } = await add();
          expect(stderr.split("\n").filter(line => line.includes("failed to link"))).toEqual([
            expect.stringContaining("EEXIST"),
          ]);
          expect(readFileSync(join(binDir, isWindows ? "skip-test-cmd.exe" : "skip-test-cmd"), "utf8")).toBe(
            "not a bin of the package",
          );
          expect(exitCode).toBe(1);
        });
      }
    });
  });
});

// Regression for `bunx @anthropic-ai/claude-code` silently exiting / the
// Windows "Unsupported 16-Bit Application" dialog: the parent package's `bin`
// points at a stub that postinstall is meant to replace, while the platform
// optionalDependency ships the real binary at a different path. Each version
// of the fixture exercises one of the alternate-path probes in
// `bin::Linker::resolve_bin_target`.
describe.concurrent("native binlink altpath", () => {
  const shapes = [
    {
      version: "1.0.0",
      targetFile: "altpath-cmd",
      description: "<pkg>/<bin_name> (claude-code-linux shape)",
    },
    {
      version: "2.0.0",
      targetFile: "launcher.exe",
      description: "<pkg>/<basename(target)> (bin key differs from target stem)",
    },
    {
      version: "3.0.0",
      targetFile: "altpath-cmd.exe",
      description: "<pkg>/<bin_name>.exe (@esbuild/win32 shape)",
    },
    {
      version: "4.0.0",
      targetFile: "altpath-cmd",
      description: "<pkg>/<bin_name> when the bin value does not fit the path buffer",
    },
  ] as const;

  for (const linker of ["hoisted", "isolated"]) {
    for (const { version, targetFile, description } of shapes) {
      test(`finds native bin via ${description} with linker ${linker}`, async () => {
        let env = { ...bunEnv };
        const { packageDir, packageJson } = await verdaccio.createTestDir();
        env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
        env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");

        await writeFile(
          join(packageDir, "bunfig.toml"),
          Bun.TOML.stringify({
            install: {
              cache: join(packageDir, ".bun-cache"),
              registry: verdaccio.registryUrl(),
              linker,
            },
          }),
        );

        await writeFile(
          packageJson,
          JSON.stringify({
            name: "test-app",
            version: "1.0.0",
            dependencies: {
              "test-native-binlink-altpath": version,
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

        const binDir = join(packageDir, "node_modules", ".bin");
        const binPath = binEntry(binDir, "altpath-cmd");
        // The bin must resolve into the platform-specific package, not back into
        // the parent package's placeholder stub.
        expect(readBinTarget(binDir, "altpath-cmd")).toContain(join("test-native-binlink-altpath-target", targetFile));

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
          cmd: [binPath],
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
  }
});

// The bin linker must not create a `node_modules/.bin` entry (nor chmod or rewrite the
// target) when a package's bin path resolves through an in-package symlink to a location
// outside the package directory. Bins that resolve inside the package must still link,
// including for workspace packages whose node_modules entry is itself a symlink.
//
// POSIX-only: the Windows bin linker writes a shim+metadata pair without
// touching the target file (no chmod, no shebang rewrite), so the attack this
// guards against can't occur there, and the resolved-containment check in
// `link_bin_or_create_shim` is `#[cfg(not(windows))]` accordingly.
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
