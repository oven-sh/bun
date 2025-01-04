import {
  VerdaccioRegistry,
  isLinux,
  bunEnv as env,
  bunExe,
  assertManifestsPopulated,
  readdirSorted,
  isWindows,
  stderrForInstall,
  runBunInstall,
} from "harness";
import { beforeAll, afterAll, beforeEach, test, expect, describe, setDefaultTimeout } from "bun:test";
import { writeFile, exists, rm, mkdir } from "fs/promises";
import { join, sep } from "path";
import { spawn, file, write } from "bun";

var verdaccio = new VerdaccioRegistry();
var packageDir: string;
var packageJson: string;

beforeAll(async () => {
  setDefaultTimeout(1000 * 60 * 5);
  await verdaccio.start();
});

afterAll(() => {
  verdaccio.stop();
});

beforeEach(async () => {
  ({ packageDir, packageJson } = await verdaccio.createTestDir());
  env.BUN_INSTALL_CACHE_DIR = join(packageDir, ".bun-cache");
  env.BUN_TMPDIR = env.TMPDIR = env.TEMP = join(packageDir, ".bun-tmp");
});

// waiter thread is only a thing on Linux.
for (const forceWaiterThread of isLinux ? [false, true] : [false]) {
  describe("lifecycle scripts" + (forceWaiterThread ? " (waiter thread)" : ""), async () => {
    test("root package with all lifecycle scripts", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;
      const writeScript = async (name: string) => {
        const contents = `
      import { writeFileSync, existsSync, rmSync } from "fs";
      import { join } from "path";

      const file = join(import.meta.dir, "${name}.txt");

      if (existsSync(file)) {
        rmSync(file);
        writeFileSync(file, "${name} exists!");
      } else {
        writeFileSync(file, "${name}!");
      }
      `;
        await writeFile(join(packageDir, `${name}.js`), contents);
      };

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            preinstall: `${bunExe()} preinstall.js`,
            install: `${bunExe()} install.js`,
            postinstall: `${bunExe()} postinstall.js`,
            preprepare: `${bunExe()} preprepare.js`,
            prepare: `${bunExe()} prepare.js`,
            postprepare: `${bunExe()} postprepare.js`,
          },
        }),
      );

      await writeScript("preinstall");
      await writeScript("install");
      await writeScript("postinstall");
      await writeScript("preprepare");
      await writeScript("prepare");
      await writeScript("postprepare");

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });
      var err = await new Response(stderr).text();
      var out = await new Response(stdout).text();
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "preinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "install.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "postinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "preprepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "prepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "postprepare.txt"))).toBeTrue();
      expect(await file(join(packageDir, "preinstall.txt")).text()).toBe("preinstall!");
      expect(await file(join(packageDir, "install.txt")).text()).toBe("install!");
      expect(await file(join(packageDir, "postinstall.txt")).text()).toBe("postinstall!");
      expect(await file(join(packageDir, "preprepare.txt")).text()).toBe("preprepare!");
      expect(await file(join(packageDir, "prepare.txt")).text()).toBe("prepare!");
      expect(await file(join(packageDir, "postprepare.txt")).text()).toBe("postprepare!");

      // add a dependency with all lifecycle scripts
      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            preinstall: `${bunExe()} preinstall.js`,
            install: `${bunExe()} install.js`,
            postinstall: `${bunExe()} postinstall.js`,
            preprepare: `${bunExe()} preprepare.js`,
            prepare: `${bunExe()} prepare.js`,
            postprepare: `${bunExe()} postprepare.js`,
          },
          dependencies: {
            "all-lifecycle-scripts": "1.0.0",
          },
          trustedDependencies: ["all-lifecycle-scripts"],
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ all-lifecycle-scripts@1.0.0",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await file(join(packageDir, "preinstall.txt")).text()).toBe("preinstall exists!");
      expect(await file(join(packageDir, "install.txt")).text()).toBe("install exists!");
      expect(await file(join(packageDir, "postinstall.txt")).text()).toBe("postinstall exists!");
      expect(await file(join(packageDir, "preprepare.txt")).text()).toBe("preprepare exists!");
      expect(await file(join(packageDir, "prepare.txt")).text()).toBe("prepare exists!");
      expect(await file(join(packageDir, "postprepare.txt")).text()).toBe("postprepare exists!");

      const depDir = join(packageDir, "node_modules", "all-lifecycle-scripts");

      expect(await exists(join(depDir, "preinstall.txt"))).toBeTrue();
      expect(await exists(join(depDir, "install.txt"))).toBeTrue();
      expect(await exists(join(depDir, "postinstall.txt"))).toBeTrue();
      expect(await exists(join(depDir, "preprepare.txt"))).toBeFalse();
      expect(await exists(join(depDir, "prepare.txt"))).toBeTrue();
      expect(await exists(join(depDir, "postprepare.txt"))).toBeFalse();

      expect(await file(join(depDir, "preinstall.txt")).text()).toBe("preinstall!");
      expect(await file(join(depDir, "install.txt")).text()).toBe("install!");
      expect(await file(join(depDir, "postinstall.txt")).text()).toBe("postinstall!");
      expect(await file(join(depDir, "prepare.txt")).text()).toBe("prepare!");

      await rm(join(packageDir, "preinstall.txt"));
      await rm(join(packageDir, "install.txt"));
      await rm(join(packageDir, "postinstall.txt"));
      await rm(join(packageDir, "preprepare.txt"));
      await rm(join(packageDir, "prepare.txt"));
      await rm(join(packageDir, "postprepare.txt"));
      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lockb"));

      // all at once
      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ all-lifecycle-scripts@1.0.0",
        "",
        "1 package installed",
      ]);

      expect(await file(join(packageDir, "preinstall.txt")).text()).toBe("preinstall!");
      expect(await file(join(packageDir, "install.txt")).text()).toBe("install!");
      expect(await file(join(packageDir, "postinstall.txt")).text()).toBe("postinstall!");
      expect(await file(join(packageDir, "preprepare.txt")).text()).toBe("preprepare!");
      expect(await file(join(packageDir, "prepare.txt")).text()).toBe("prepare!");
      expect(await file(join(packageDir, "postprepare.txt")).text()).toBe("postprepare!");

      expect(await file(join(depDir, "preinstall.txt")).text()).toBe("preinstall!");
      expect(await file(join(depDir, "install.txt")).text()).toBe("install!");
      expect(await file(join(depDir, "postinstall.txt")).text()).toBe("postinstall!");
      expect(await file(join(depDir, "prepare.txt")).text()).toBe("prepare!");
    });

    test("workspace lifecycle scripts", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          workspaces: ["packages/*"],
          scripts: {
            preinstall: `touch preinstall.txt`,
            install: `touch install.txt`,
            postinstall: `touch postinstall.txt`,
            preprepare: `touch preprepare.txt`,
            prepare: `touch prepare.txt`,
            postprepare: `touch postprepare.txt`,
          },
        }),
      );

      await mkdir(join(packageDir, "packages", "pkg1"), { recursive: true });
      await writeFile(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          version: "1.0.0",
          scripts: {
            preinstall: `touch preinstall.txt`,
            install: `touch install.txt`,
            postinstall: `touch postinstall.txt`,
            preprepare: `touch preprepare.txt`,
            prepare: `touch prepare.txt`,
            postprepare: `touch postprepare.txt`,
          },
        }),
      );

      await mkdir(join(packageDir, "packages", "pkg2"), { recursive: true });
      await writeFile(
        join(packageDir, "packages", "pkg2", "package.json"),
        JSON.stringify({
          name: "pkg2",
          version: "1.0.0",
          scripts: {
            preinstall: `touch preinstall.txt`,
            install: `touch install.txt`,
            postinstall: `touch postinstall.txt`,
            preprepare: `touch preprepare.txt`,
            prepare: `touch prepare.txt`,
            postprepare: `touch postprepare.txt`,
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      var err = await new Response(stderr).text();
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(err).toContain("Saved lockfile");
      var out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "preinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "install.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "postinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "preprepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "prepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "postprepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg1", "preinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg1", "install.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg1", "postinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg1", "preprepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "packages", "pkg1", "prepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg1", "postprepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "packages", "pkg2", "preinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg2", "install.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg2", "postinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg2", "preprepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "packages", "pkg2", "prepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg2", "postprepare.txt"))).toBeFalse();
    });

    test("dependency lifecycle scripts run before root lifecycle scripts", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      const script = '[[ -f "./node_modules/uses-what-bin-slow/what-bin.txt" ]]';
      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "uses-what-bin-slow": "1.0.0",
          },
          trustedDependencies: ["uses-what-bin-slow"],
          scripts: {
            install: script,
            postinstall: script,
            preinstall: script,
            prepare: script,
            postprepare: script,
            preprepare: script,
          },
        }),
      );

      // uses-what-bin-slow will wait one second then write a file to disk. The root package should wait for
      // for this to happen before running its lifecycle scripts.

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      var err = await new Response(stderr).text();
      var out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });

    test("install a dependency with lifecycle scripts, then add to trusted dependencies and install again", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "all-lifecycle-scripts": "1.0.0",
          },
          trustedDependencies: [],
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      var err = await new Response(stderr).text();
      var out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ all-lifecycle-scripts@1.0.0",
        "",
        "1 package installed",
        "",
        "Blocked 3 postinstalls. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      const depDir = join(packageDir, "node_modules", "all-lifecycle-scripts");
      expect(await exists(join(depDir, "preinstall.txt"))).toBeFalse();
      expect(await exists(join(depDir, "install.txt"))).toBeFalse();
      expect(await exists(join(depDir, "postinstall.txt"))).toBeFalse();
      expect(await exists(join(depDir, "preprepare.txt"))).toBeFalse();
      expect(await exists(join(depDir, "prepare.txt"))).toBeTrue();
      expect(await exists(join(depDir, "postprepare.txt"))).toBeFalse();
      expect(await file(join(depDir, "prepare.txt")).text()).toBe("prepare!");

      // add to trusted dependencies
      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "all-lifecycle-scripts": "1.0.0",
          },
          trustedDependencies: ["all-lifecycle-scripts"],
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        expect.stringContaining("Checked 1 install across 2 packages (no changes)"),
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await file(join(depDir, "preinstall.txt")).text()).toBe("preinstall!");
      expect(await file(join(depDir, "install.txt")).text()).toBe("install!");
      expect(await file(join(depDir, "postinstall.txt")).text()).toBe("postinstall!");
      expect(await file(join(depDir, "prepare.txt")).text()).toBe("prepare!");
      expect(await exists(join(depDir, "preprepare.txt"))).toBeFalse();
      expect(await exists(join(depDir, "postprepare.txt"))).toBeFalse();
    });

    test("adding a package without scripts to trustedDependencies", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "what-bin": "1.0.0",
          },
          trustedDependencies: ["what-bin"],
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      var err = await new Response(stderr).text();
      var out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        expect.stringContaining("+ what-bin@1.0.0"),
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bin", "what-bin"]);
      const what_bin_bins = !isWindows ? ["what-bin"] : ["what-bin.bunx", "what-bin.exe"];
      // prettier-ignore
      expect(await readdirSorted(join(packageDir, "node_modules", ".bin"))).toEqual(what_bin_bins);

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lockb"));

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: { "what-bin": "1.0.0" },
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        expect.stringContaining("+ what-bin@1.0.0"),
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bin", "what-bin"]);
      expect(await readdirSorted(join(packageDir, "node_modules", ".bin"))).toEqual(what_bin_bins);

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bin", "what-bin"]);
      expect(await readdirSorted(join(packageDir, "node_modules", ".bin"))).toEqual(what_bin_bins);

      // add it to trusted dependencies
      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "what-bin": "1.0.0",
          },
          trustedDependencies: ["what-bin"],
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bin", "what-bin"]);
      expect(await readdirSorted(join(packageDir, "node_modules", ".bin"))).toEqual(what_bin_bins);
    });

    test("lifecycle scripts run if node_modules is deleted", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "lifecycle-postinstall": "1.0.0",
          },
          trustedDependencies: ["lifecycle-postinstall"],
        }),
      );
      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });
      var err = await new Response(stderr).text();
      var out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ lifecycle-postinstall@1.0.0",
        "",
        // @ts-ignore
        "1 package installed",
      ]);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(await exists(join(packageDir, "node_modules", "lifecycle-postinstall", "postinstall.txt"))).toBeTrue();
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      await rm(join(packageDir, "node_modules"), { force: true, recursive: true });
      await rm(join(packageDir, ".bun-cache"), { recursive: true, force: true });
      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));
      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ lifecycle-postinstall@1.0.0",
        "",
        "1 package installed",
      ]);
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(await exists(join(packageDir, "node_modules", "lifecycle-postinstall", "postinstall.txt"))).toBeTrue();
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });

    test("INIT_CWD is set to the correct directory", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            install: "bun install.js",
          },
          dependencies: {
            "lifecycle-init-cwd": "1.0.0",
            "another-init-cwd": "npm:lifecycle-init-cwd@1.0.0",
          },
          trustedDependencies: ["lifecycle-init-cwd", "another-init-cwd"],
        }),
      );

      await writeFile(
        join(packageDir, "install.js"),
        `
      const fs = require("fs");
      const path = require("path");

      fs.writeFileSync(
      path.join(__dirname, "test.txt"),
      process.env.INIT_CWD || "does not exist"
      );
      `,
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      const out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ another-init-cwd@1.0.0",
        "+ lifecycle-init-cwd@1.0.0",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await file(join(packageDir, "test.txt")).text()).toBe(packageDir);
      expect(await file(join(packageDir, "node_modules/lifecycle-init-cwd/test.txt")).text()).toBe(packageDir);
      expect(await file(join(packageDir, "node_modules/another-init-cwd/test.txt")).text()).toBe(packageDir);
    });

    test("failing lifecycle script should print output", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "lifecycle-failing-postinstall": "1.0.0",
          },
          trustedDependencies: ["lifecycle-failing-postinstall"],
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("hello");
      expect(await exited).toBe(1);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      const out = await new Response(stdout).text();
      expect(out).toEqual(expect.stringContaining("bun install v1."));
    });

    test("failing root lifecycle script should print output correctly", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "fooooooooo",
          version: "1.0.0",
          scripts: {
            preinstall: `${bunExe()} -e "throw new Error('Oops!')"`,
          },
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      expect(await exited).toBe(1);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await Bun.readableStreamToText(stdout)).toEqual(expect.stringContaining("bun install v1."));
      const err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("error: Oops!");
      expect(err).toContain('error: preinstall script from "fooooooooo" exited with 1');
    });

    test("exit 0 in lifecycle scripts works", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            postinstall: "exit 0",
            prepare: "exit 0",
            postprepare: "exit 0",
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("No packages! Deleted empty lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        expect.stringContaining("done"),
        "",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });

    test("--ignore-scripts should skip lifecycle scripts", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          dependencies: {
            "lifecycle-failing-postinstall": "1.0.0",
          },
          trustedDependencies: ["lifecycle-failing-postinstall"],
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install", "--ignore-scripts"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("hello");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ lifecycle-failing-postinstall@1.0.0",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });

    test("it should add `node-gyp rebuild` as the `install` script when `install` and `postinstall` don't exist and `binding.gyp` exists in the root of the package", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "binding-gyp-scripts": "1.5.0",
          },
          trustedDependencies: ["binding-gyp-scripts"],
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ binding-gyp-scripts@1.5.0",
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "node_modules/binding-gyp-scripts/build.node"))).toBeTrue();
    });

    test("automatic node-gyp scripts should not run for untrusted dependencies, and should run after adding to `trustedDependencies`", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      const packageJSON: any = {
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "binding-gyp-scripts": "1.5.0",
        },
      };
      await writeFile(packageJson, JSON.stringify(packageJSON));

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      let err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ binding-gyp-scripts@1.5.0",
        "",
        "2 packages installed",
        "",
        "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "node_modules", "binding-gyp-scripts", "build.node"))).toBeFalse();

      packageJSON.trustedDependencies = ["binding-gyp-scripts"];
      await writeFile(packageJson, JSON.stringify(packageJSON));

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = stderrForInstall(await Bun.readableStreamToText(stderr));
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");

      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "node_modules", "binding-gyp-scripts", "build.node"))).toBeTrue();
    });

    test("automatic node-gyp scripts work in package root", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "node-gyp": "1.5.0",
          },
        }),
      );

      await writeFile(join(packageDir, "binding.gyp"), "");

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ node-gyp@1.5.0",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "build.node"))).toBeTrue();

      await rm(join(packageDir, "build.node"));

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "build.node"))).toBeTrue();
    });

    test("auto node-gyp scripts work when scripts exists other than `install` and `preinstall`", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "node-gyp": "1.5.0",
          },
          scripts: {
            postinstall: "exit 0",
            prepare: "exit 0",
            postprepare: "exit 0",
          },
        }),
      );

      await writeFile(join(packageDir, "binding.gyp"), "");

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ node-gyp@1.5.0",
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "build.node"))).toBeTrue();
    });

    for (const script of ["install", "preinstall"]) {
      test(`does not add auto node-gyp script when ${script} script exists`, async () => {
        const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

        const packageJSON: any = {
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "node-gyp": "1.5.0",
          },
          scripts: {
            [script]: "exit 0",
          },
        };
        await writeFile(packageJson, JSON.stringify(packageJSON));
        await writeFile(join(packageDir, "binding.gyp"), "");

        const { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env: testEnv,
        });

        const err = await new Response(stderr).text();
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        const out = await new Response(stdout).text();
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          "+ node-gyp@1.5.0",
          "",
          "1 package installed",
        ]);
        expect(await exited).toBe(0);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

        expect(await exists(join(packageDir, "build.node"))).toBeFalse();
      });
    }

    test("git dependencies also run `preprepare`, `prepare`, and `postprepare` scripts", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "lifecycle-install-test": "dylan-conway/lifecycle-install-test#3ba6af5b64f2d27456e08df21d750072dffd3eee",
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      let err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ lifecycle-install-test@github:dylan-conway/lifecycle-install-test#3ba6af5",
        "",
        "1 package installed",
        "",
        "Blocked 6 postinstalls. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "preprepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "prepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "postprepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "preinstall.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "install.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "postinstall.txt"))).toBeFalse();

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "lifecycle-install-test": "dylan-conway/lifecycle-install-test#3ba6af5b64f2d27456e08df21d750072dffd3eee",
          },
          trustedDependencies: ["lifecycle-install-test"],
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = stderrForInstall(await Bun.readableStreamToText(stderr));
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");

      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "preprepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "prepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "postprepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "preinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "install.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "postinstall.txt"))).toBeTrue();
    });

    test("root lifecycle scripts should wait for dependency lifecycle scripts", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "uses-what-bin-slow": "1.0.0",
          },
          trustedDependencies: ["uses-what-bin-slow"],
          scripts: {
            install: '[[ -f "./node_modules/uses-what-bin-slow/what-bin.txt" ]]',
          },
        }),
      );

      // Package `uses-what-bin-slow` has an install script that will sleep for 1 second
      // before writing `what-bin.txt` to disk. The root package has an install script that
      // checks if this file exists. If the root package install script does not wait for
      // the other to finish, it will fail.

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ uses-what-bin-slow@1.0.0",
        "",
        "2 packages installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });

    async function createPackagesWithScripts(
      packagesCount: number,
      scripts: Record<string, string>,
    ): Promise<string[]> {
      const dependencies: Record<string, string> = {};
      const dependenciesList: string[] = [];

      for (let i = 0; i < packagesCount; i++) {
        const packageName: string = "stress-test-package-" + i;
        const packageVersion = "1.0." + i;

        dependencies[packageName] = "file:./" + packageName;
        dependenciesList[i] = packageName;

        const packagePath = join(packageDir, packageName);
        await mkdir(packagePath);
        await writeFile(
          join(packagePath, "package.json"),
          JSON.stringify({
            name: packageName,
            version: packageVersion,
            scripts,
          }),
        );
      }

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "stress-test",
          version: "1.0.0",
          dependencies,
          trustedDependencies: dependenciesList,
        }),
      );

      return dependenciesList;
    }

    test("reach max concurrent scripts", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      const scripts = {
        "preinstall": `${bunExe()} -e 'Bun.sleepSync(500)'`,
      };

      const dependenciesList = await createPackagesWithScripts(4, scripts);

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install", "--concurrent-scripts=2"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await Bun.readableStreamToText(stdout);
      expect(out).not.toContain("Blocked");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        ...dependenciesList.map(dep => `+ ${dep}@${dep}`),
        "",
        "4 packages installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });

    test("stress test", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      const dependenciesList = await createPackagesWithScripts(500, {
        "postinstall": `${bunExe()} --version`,
      });

      // the script is quick, default number for max concurrent scripts
      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await Bun.readableStreamToText(stdout);
      expect(out).not.toContain("Blocked");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        ...dependenciesList.map(dep => `+ ${dep}@${dep}`).sort((a, b) => a.localeCompare(b)),
        "",
        "500 packages installed",
      ]);

      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });

    test("it should install and use correct binary version", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      // this should install `what-bin` in two places:
      //
      // - node_modules/.bin/what-bin@1.5.0
      // - node_modules/uses-what-bin/node_modules/.bin/what-bin@1.0.0

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "uses-what-bin": "1.0.0",
            "what-bin": "1.5.0",
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      var err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      var out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        expect.stringContaining("+ uses-what-bin@1.0.0"),
        "+ what-bin@1.5.0",
        "",
        "3 packages installed",
        "",
        "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await file(join(packageDir, "node_modules", "what-bin", "what-bin.js")).text()).toContain(
        "what-bin@1.5.0",
      );
      expect(
        await file(join(packageDir, "node_modules", "uses-what-bin", "node_modules", "what-bin", "what-bin.js")).text(),
      ).toContain("what-bin@1.0.0");

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lockb"));

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "uses-what-bin": "1.5.0",
            "what-bin": "1.0.0",
          },
          scripts: {
            install: "what-bin",
          },
          trustedDependencies: ["uses-what-bin"],
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = stderrForInstall(await Bun.readableStreamToText(stderr));
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");

      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await file(join(packageDir, "node_modules", "what-bin", "what-bin.js")).text()).toContain(
        "what-bin@1.0.0",
      );
      expect(
        await file(join(packageDir, "node_modules", "uses-what-bin", "node_modules", "what-bin", "what-bin.js")).text(),
      ).toContain("what-bin@1.5.0");

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      out = await new Response(stdout).text();
      err = await new Response(stderr).text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        expect.stringContaining("+ uses-what-bin@1.5.0"),
        expect.stringContaining("+ what-bin@1.0.0"),
        "",
        "3 packages installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });

    test("node-gyp should always be available for lifecycle scripts", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            install: "node-gyp --version",
          },
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();

      // if node-gyp isn't available, it would return a non-zero exit code
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });

    // if this test fails, `electron` might be removed from the default list
    test("default trusted dependencies should work", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          dependencies: {
            "electron": "1.0.0",
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ electron@1.0.0",
        "",
        "1 package installed",
      ]);
      expect(out).not.toContain("Blocked");
      expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeTrue();
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });

    test("default trusted dependencies should not be used of trustedDependencies is populated", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          dependencies: {
            "uses-what-bin": "1.0.0",
            // fake electron package because it's in the default trustedDependencies list
            "electron": "1.0.0",
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      // electron lifecycle scripts should run, uses-what-bin scripts should not run
      var err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      var out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ electron@1.0.0",
        expect.stringContaining("+ uses-what-bin@1.0.0"),
        "",
        "3 packages installed",
        "",
        "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeTrue();

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, ".bun-cache"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lockb"));

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          dependencies: {
            "uses-what-bin": "1.0.0",
            "electron": "1.0.0",
          },
          trustedDependencies: ["uses-what-bin"],
        }),
      );

      // now uses-what-bin scripts should run and electron scripts should not run.

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      out = await Bun.readableStreamToText(stdout);
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ electron@1.0.0",
        expect.stringContaining("+ uses-what-bin@1.0.0"),
        "",
        "3 packages installed",
        "",
        "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeFalse();
    });

    test("does not run any scripts if trustedDependencies is an empty list", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          dependencies: {
            "uses-what-bin": "1.0.0",
            "electron": "1.0.0",
          },
          trustedDependencies: [],
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await Bun.readableStreamToText(stderr);
      const out = await Bun.readableStreamToText(stdout);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ electron@1.0.0",
        expect.stringContaining("+ uses-what-bin@1.0.0"),
        "",
        "3 packages installed",
        "",
        "Blocked 2 postinstalls. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeFalse();
    });

    test("will run default trustedDependencies after install that didn't include them", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          dependencies: {
            electron: "1.0.0",
          },
          trustedDependencies: ["blah"],
        }),
      );

      // first install does not run electron scripts

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      var err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      var out = await Bun.readableStreamToText(stdout);
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "+ electron@1.0.0",
        "",
        "1 package installed",
        "",
        "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeFalse();

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          dependencies: {
            electron: "1.0.0",
          },
        }),
      );

      // The electron scripts should run now because it's in default trusted dependencies.

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      out = await Bun.readableStreamToText(stdout);
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeTrue();
    });

    describe("--trust", async () => {
      test("unhoisted untrusted scripts, none at root node_modules", async () => {
        const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

        await Promise.all([
          write(
            packageJson,
            JSON.stringify({
              name: "foo",
              dependencies: {
                // prevents real `uses-what-bin` from hoisting to root
                "uses-what-bin": "npm:a-dep@1.0.3",
              },
              workspaces: ["pkg1"],
            }),
          ),
          write(
            join(packageDir, "pkg1", "package.json"),
            JSON.stringify({
              name: "pkg1",
              dependencies: {
                "uses-what-bin": "1.0.0",
              },
            }),
          ),
        ]);

        await runBunInstall(testEnv, packageDir);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

        const results = await Promise.all([
          exists(join(packageDir, "node_modules", "pkg1", "node_modules", "uses-what-bin")),
          exists(join(packageDir, "node_modules", "pkg1", "node_modules", "uses-what-bin", "what-bin.txt")),
        ]);

        expect(results).toEqual([true, false]);

        const { stderr, exited } = spawn({
          cmd: [bunExe(), "pm", "trust", "--all"],
          cwd: packageDir,
          stdout: "ignore",
          stderr: "pipe",
          env: testEnv,
        });

        const err = await Bun.readableStreamToText(stderr);
        expect(err).not.toContain("error:");

        expect(await exited).toBe(0);

        expect(
          await exists(join(packageDir, "node_modules", "pkg1", "node_modules", "uses-what-bin", "what-bin.txt")),
        ).toBeTrue();
      });
      const trustTests = [
        {
          label: "only name",
          packageJson: {
            name: "foo",
          },
        },
        {
          label: "empty dependencies",
          packageJson: {
            name: "foo",
            dependencies: {},
          },
        },
        {
          label: "populated dependencies",
          packageJson: {
            name: "foo",
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
          },
        },

        {
          label: "empty trustedDependencies",
          packageJson: {
            name: "foo",
            trustedDependencies: [],
          },
        },

        {
          label: "populated dependencies, empty trustedDependencies",
          packageJson: {
            name: "foo",
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
            trustedDependencies: [],
          },
        },

        {
          label: "populated dependencies and trustedDependencies",
          packageJson: {
            name: "foo",
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
            trustedDependencies: ["uses-what-bin"],
          },
        },

        {
          label: "empty dependencies and trustedDependencies",
          packageJson: {
            name: "foo",
            dependencies: {},
            trustedDependencies: [],
          },
        },
      ];
      for (const { label, packageJson } of trustTests) {
        test(label, async () => {
          const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

          await writeFile(join(packageDir, "package.json"), JSON.stringify(packageJson));

          let { stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "i", "--trust", "uses-what-bin@1.0.0"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            stdin: "pipe",
            env: testEnv,
          });

          let err = stderrForInstall(await Bun.readableStreamToText(stderr));
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          let out = await Bun.readableStreamToText(stdout);
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun add v1."),
            "",
            "installed uses-what-bin@1.0.0",
            "",
            "2 packages installed",
          ]);
          expect(await exited).toBe(0);
          expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
          expect(await file(join(packageDir, "package.json")).json()).toEqual({
            name: "foo",
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
            trustedDependencies: ["uses-what-bin"],
          });

          // another install should not error with json SyntaxError
          ({ stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "i"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            stdin: "pipe",
            env: testEnv,
          }));

          err = stderrForInstall(await Bun.readableStreamToText(stderr));
          expect(err).not.toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          out = await Bun.readableStreamToText(stdout);
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun install v1."),
            "",
            "Checked 2 installs across 3 packages (no changes)",
          ]);
          expect(await exited).toBe(0);
        });
      }
      describe("packages without lifecycle scripts", async () => {
        test("initial install", async () => {
          const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

          await writeFile(
            packageJson,
            JSON.stringify({
              name: "foo",
            }),
          );

          const { stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "i", "--trust", "no-deps@1.0.0"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            stdin: "pipe",
            env: testEnv,
          });

          const err = stderrForInstall(await Bun.readableStreamToText(stderr));
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          const out = await Bun.readableStreamToText(stdout);
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun add v1."),
            "",
            "installed no-deps@1.0.0",
            "",
            "1 package installed",
          ]);
          expect(await exited).toBe(0);
          expect(await exists(join(packageDir, "node_modules", "no-deps"))).toBeTrue();
          expect(await file(packageJson).json()).toEqual({
            name: "foo",
            dependencies: {
              "no-deps": "1.0.0",
            },
          });
        });
        test("already installed", async () => {
          const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

          await writeFile(
            packageJson,
            JSON.stringify({
              name: "foo",
            }),
          );
          let { stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "i", "no-deps"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            stdin: "pipe",
            env: testEnv,
          });

          let err = stderrForInstall(await Bun.readableStreamToText(stderr));
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          let out = await Bun.readableStreamToText(stdout);
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun add v1."),
            "",
            "installed no-deps@2.0.0",
            "",
            "1 package installed",
          ]);
          expect(await exited).toBe(0);
          expect(await exists(join(packageDir, "node_modules", "no-deps"))).toBeTrue();
          expect(await file(packageJson).json()).toEqual({
            name: "foo",
            dependencies: {
              "no-deps": "^2.0.0",
            },
          });

          // oops, I wanted to run the lifecycle scripts for no-deps, I'll install
          // again with --trust.

          ({ stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "i", "--trust", "no-deps"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            stdin: "pipe",
            env: testEnv,
          }));

          // oh, I didn't realize no-deps doesn't have
          // any lifecycle scripts. It shouldn't automatically add to
          // trustedDependencies.

          err = await Bun.readableStreamToText(stderr);
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          out = await Bun.readableStreamToText(stdout);
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun add v1."),
            "",
            "installed no-deps@2.0.0",
            "",
            expect.stringContaining("done"),
            "",
          ]);
          expect(await exited).toBe(0);
          expect(await exists(join(packageDir, "node_modules", "no-deps"))).toBeTrue();
          expect(await file(packageJson).json()).toEqual({
            name: "foo",
            dependencies: {
              "no-deps": "^2.0.0",
            },
          });
        });
      });
    });

    describe("updating trustedDependencies", async () => {
      test("existing trustedDependencies, unchanged trustedDependencies", async () => {
        const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

        await writeFile(
          packageJson,
          JSON.stringify({
            name: "foo",
            trustedDependencies: ["uses-what-bin"],
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
          }),
        );

        let { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "i"],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
          env: testEnv,
        });

        let err = stderrForInstall(await Bun.readableStreamToText(stderr));
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(err).not.toContain("warn:");
        let out = await Bun.readableStreamToText(stdout);
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          expect.stringContaining("+ uses-what-bin@1.0.0"),
          "",
          "2 packages installed",
        ]);
        expect(await exited).toBe(0);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

        expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
        expect(await file(packageJson).json()).toEqual({
          name: "foo",
          dependencies: {
            "uses-what-bin": "1.0.0",
          },
          trustedDependencies: ["uses-what-bin"],
        });

        // no changes, lockfile shouldn't be saved
        ({ stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "i"],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
          env: testEnv,
        }));

        err = stderrForInstall(await Bun.readableStreamToText(stderr));
        expect(err).not.toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(err).not.toContain("warn:");
        out = await Bun.readableStreamToText(stdout);
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          "Checked 2 installs across 3 packages (no changes)",
        ]);
        expect(await exited).toBe(0);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
      });

      test("existing trustedDependencies, removing trustedDependencies", async () => {
        const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

        await writeFile(
          packageJson,
          JSON.stringify({
            name: "foo",
            trustedDependencies: ["uses-what-bin"],
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
          }),
        );

        let { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "i"],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
          env: testEnv,
        });

        let err = stderrForInstall(await Bun.readableStreamToText(stderr));
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(err).not.toContain("warn:");
        let out = await Bun.readableStreamToText(stdout);
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          expect.stringContaining("+ uses-what-bin@1.0.0"),
          "",
          "2 packages installed",
        ]);
        expect(await exited).toBe(0);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

        expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
        expect(await file(packageJson).json()).toEqual({
          name: "foo",
          dependencies: {
            "uses-what-bin": "1.0.0",
          },
          trustedDependencies: ["uses-what-bin"],
        });

        await writeFile(
          packageJson,
          JSON.stringify({
            name: "foo",
            dependencies: {
              "uses-what-bin": "1.0.0",
            },
          }),
        );

        // this script should not run because uses-what-bin is no longer in trustedDependencies
        await rm(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"), { force: true });

        ({ stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "i"],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
          env: testEnv,
        }));

        err = stderrForInstall(await Bun.readableStreamToText(stderr));
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(err).not.toContain("warn:");
        out = await Bun.readableStreamToText(stdout);
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          "Checked 2 installs across 3 packages (no changes)",
        ]);
        expect(await exited).toBe(0);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

        expect(await file(packageJson).json()).toEqual({
          name: "foo",
          dependencies: {
            "uses-what-bin": "1.0.0",
          },
        });
        expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeFalse();
      });

      test("non-existent trustedDependencies, then adding it", async () => {
        const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

        await writeFile(
          packageJson,
          JSON.stringify({
            name: "foo",
            dependencies: {
              "electron": "1.0.0",
            },
          }),
        );

        let { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "i"],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
          env: testEnv,
        });

        let err = stderrForInstall(await Bun.readableStreamToText(stderr));
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(err).not.toContain("warn:");
        let out = await Bun.readableStreamToText(stdout);
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          "+ electron@1.0.0",
          "",
          "1 package installed",
        ]);
        expect(await exited).toBe(0);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

        expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeTrue();
        expect(await file(packageJson).json()).toEqual({
          name: "foo",
          dependencies: {
            "electron": "1.0.0",
          },
        });

        await writeFile(
          packageJson,
          JSON.stringify({
            name: "foo",
            trustedDependencies: ["electron"],
            dependencies: {
              "electron": "1.0.0",
            },
          }),
        );

        await rm(join(packageDir, "node_modules", "electron", "preinstall.txt"), { force: true });

        // lockfile should save evenn though there are no changes to trustedDependencies due to
        // the default list

        ({ stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "i"],
          cwd: packageDir,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "pipe",
          env: testEnv,
        }));

        err = stderrForInstall(await Bun.readableStreamToText(stderr));
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(err).not.toContain("warn:");
        out = await Bun.readableStreamToText(stdout);
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          expect.stringContaining("bun install v1."),
          "",
          "Checked 1 install across 2 packages (no changes)",
        ]);
        expect(await exited).toBe(0);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

        expect(await exists(join(packageDir, "node_modules", "electron", "preinstall.txt"))).toBeTrue();
      });
    });

    test("node -p should work in postinstall scripts", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            postinstall: `node -p "require('fs').writeFileSync('postinstall.txt', 'postinstall')"`,
          },
        }),
      );

      const originalPath = env.PATH;
      env.PATH = "";

      let { stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      env.PATH = originalPath;

      let err = stderrForInstall(await Bun.readableStreamToText(stderr));
      expect(err).toContain("No packages! Deleted empty lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      expect(await exists(join(packageDir, "postinstall.txt"))).toBeTrue();
    });

    test("ensureTempNodeGypScript works", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            preinstall: "node-gyp --version",
          },
        }),
      );

      const originalPath = env.PATH;
      env.PATH = "";

      let { stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        env,
      });

      env.PATH = originalPath;

      let err = stderrForInstall(await Bun.readableStreamToText(stderr));
      expect(err).toContain("No packages! Deleted empty lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });

    test("bun pm trust and untrusted on missing package", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          dependencies: {
            "uses-what-bin": "1.5.0",
          },
        }),
      );

      let { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "i"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      let err = stderrForInstall(await Bun.readableStreamToText(stderr));
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");
      let out = await Bun.readableStreamToText(stdout);
      expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "",
        expect.stringContaining("+ uses-what-bin@1.5.0"),
        "",
        "2 packages installed",
        "",
        "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
        "",
      ]);
      expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeFalse();
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

      // remove uses-what-bin from node_modules, bun pm trust and untrusted should handle missing package
      await rm(join(packageDir, "node_modules", "uses-what-bin"), { recursive: true, force: true });

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "pm", "untrusted"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = stderrForInstall(await Bun.readableStreamToText(stderr));
      expect(err).toContain("bun pm untrusted");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");
      out = await Bun.readableStreamToText(stdout);
      expect(out).toContain("Found 0 untrusted dependencies with scripts");
      expect(await exited).toBe(0);

      ({ stderr, exited } = spawn({
        cmd: [bunExe(), "pm", "trust", "uses-what-bin"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      expect(await exited).toBe(1);

      err = await Bun.readableStreamToText(stderr);
      expect(err).toContain("bun pm trust");
      expect(err).toContain("0 scripts ran");
      expect(err).toContain("uses-what-bin");
    });

    describe("add trusted, delete, then add again", async () => {
      // when we change bun install to delete dependencies from node_modules
      // for both cases, we need to update this test
      for (const withRm of [true, false]) {
        test(withRm ? "withRm" : "withoutRm", async () => {
          const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

          await writeFile(
            packageJson,
            JSON.stringify({
              name: "foo",
              dependencies: {
                "no-deps": "1.0.0",
                "uses-what-bin": "1.0.0",
              },
            }),
          );

          let { stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "install"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            env: testEnv,
          });

          let err = stderrForInstall(await Bun.readableStreamToText(stderr));
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          let out = await Bun.readableStreamToText(stdout);
          expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual([
            expect.stringContaining("bun install v1."),
            "",
            expect.stringContaining("+ no-deps@1.0.0"),
            expect.stringContaining("+ uses-what-bin@1.0.0"),
            "",
            "3 packages installed",
            "",
            "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
            "",
          ]);
          expect(await exited).toBe(0);
          assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

          expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeFalse();

          ({ stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "pm", "trust", "uses-what-bin"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            env: testEnv,
          }));

          err = stderrForInstall(await Bun.readableStreamToText(stderr));
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          out = await Bun.readableStreamToText(stdout);
          expect(out).toContain("1 script ran across 1 package");
          expect(await exited).toBe(0);

          expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "what-bin.txt"))).toBeTrue();
          expect(await file(packageJson).json()).toEqual({
            name: "foo",
            dependencies: {
              "no-deps": "1.0.0",
              "uses-what-bin": "1.0.0",
            },
            trustedDependencies: ["uses-what-bin"],
          });

          // now remove and install again
          if (withRm) {
            ({ stdout, stderr, exited } = spawn({
              cmd: [bunExe(), "rm", "uses-what-bin"],
              cwd: packageDir,
              stdout: "pipe",
              stderr: "pipe",
              env: testEnv,
            }));

            err = stderrForInstall(await Bun.readableStreamToText(stderr));
            expect(err).toContain("Saved lockfile");
            expect(err).not.toContain("not found");
            expect(err).not.toContain("error:");
            expect(err).not.toContain("warn:");
            out = await Bun.readableStreamToText(stdout);
            expect(out).toContain("1 package removed");
            expect(out).toContain("uses-what-bin");
            expect(await exited).toBe(0);
          }
          await writeFile(
            packageJson,
            JSON.stringify({
              name: "foo",
              dependencies: {
                "no-deps": "1.0.0",
              },
            }),
          );

          ({ stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "install"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            env: testEnv,
          }));

          err = stderrForInstall(await Bun.readableStreamToText(stderr));
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          out = await Bun.readableStreamToText(stdout);
          let expected = withRm
            ? ["", "Checked 1 install across 2 packages (no changes)"]
            : ["", expect.stringContaining("1 package removed")];
          expected = [expect.stringContaining("bun install v1."), ...expected];
          expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual(expected);
          expect(await exited).toBe(0);
          expect(await exists(join(packageDir, "node_modules", "uses-what-bin"))).toBe(!withRm);

          // add again, bun pm untrusted should report it as untrusted

          await writeFile(
            packageJson,
            JSON.stringify({
              name: "foo",
              dependencies: {
                "no-deps": "1.0.0",
                "uses-what-bin": "1.0.0",
              },
            }),
          );

          ({ stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "i"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            env: testEnv,
          }));

          err = stderrForInstall(await Bun.readableStreamToText(stderr));
          expect(err).toContain("Saved lockfile");
          expect(err).not.toContain("not found");
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          out = await Bun.readableStreamToText(stdout);
          expected = withRm
            ? [
                "",
                expect.stringContaining("+ uses-what-bin@1.0.0"),
                "",
                "1 package installed",
                "",
                "Blocked 1 postinstall. Run `bun pm untrusted` for details.",
                "",
              ]
            : ["", expect.stringContaining("Checked 3 installs across 4 packages (no changes)"), ""];
          expected = [expect.stringContaining("bun install v1."), ...expected];
          expect(out.replace(/\s*\[[0-9\.]+m?s\]$/m, "").split(/\r?\n/)).toEqual(expected);

          ({ stdout, stderr, exited } = spawn({
            cmd: [bunExe(), "pm", "untrusted"],
            cwd: packageDir,
            stdout: "pipe",
            stderr: "pipe",
            env: testEnv,
          }));

          err = stderrForInstall(await Bun.readableStreamToText(stderr));
          expect(err).not.toContain("error:");
          expect(err).not.toContain("warn:");
          out = await Bun.readableStreamToText(stdout);
          expect(out).toContain("./node_modules/uses-what-bin @1.0.0".replaceAll("/", sep));
          expect(await exited).toBe(0);
        });
      }
    });

    describe.if(!forceWaiterThread || process.platform === "linux")("does not use 100% cpu", async () => {
      test("install", async () => {
        const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

        await writeFile(
          packageJson,
          JSON.stringify({
            name: "foo",
            version: "1.0.0",
            scripts: {
              preinstall: `${bunExe()} -e 'Bun.sleepSync(1000)'`,
            },
          }),
        );

        const proc = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "ignore",
          stderr: "ignore",
          stdin: "ignore",
          env: testEnv,
        });

        expect(await proc.exited).toBe(0);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

        expect(proc.resourceUsage()?.cpuTime.total).toBeLessThan(750_000);
      });

      // https://github.com/oven-sh/bun/issues/11252
      test.todoIf(isWindows)("bun pm trust", async () => {
        const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

        const dep = isWindows ? "uses-what-bin-slow-window" : "uses-what-bin-slow";
        await writeFile(
          packageJson,
          JSON.stringify({
            name: "foo",
            version: "1.0.0",
            dependencies: {
              [dep]: "1.0.0",
            },
          }),
        );

        var { exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "ignore",
          stderr: "ignore",
          env: testEnv,
        });

        expect(await exited).toBe(0);
        assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());

        expect(await exists(join(packageDir, "node_modules", dep, "what-bin.txt"))).toBeFalse();

        const proc = spawn({
          cmd: [bunExe(), "pm", "trust", "--all"],
          cwd: packageDir,
          stdout: "ignore",
          stderr: "ignore",
          env: testEnv,
        });

        expect(await proc.exited).toBe(0);

        expect(await exists(join(packageDir, "node_modules", dep, "what-bin.txt"))).toBeTrue();

        expect(proc.resourceUsage()?.cpuTime.total).toBeLessThan(750_000 * (isWindows ? 5 : 1));
      });
    });
  });

  describe("stdout/stderr is inherited from root scripts during install", async () => {
    test("without packages", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      const exe = bunExe().replace(/\\/g, "\\\\");
      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          scripts: {
            "preinstall": `${exe} -e 'process.stderr.write("preinstall stderr 🍦\\n")'`,
            "install": `${exe} -e 'process.stdout.write("install stdout 🚀\\n")'`,
            "prepare": `${exe} -e 'Bun.sleepSync(200); process.stdout.write("prepare stdout done ✅\\n")'`,
          },
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = stderrForInstall(await Bun.readableStreamToText(stderr));
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");
      expect(err.split(/\r?\n/)).toEqual([
        "No packages! Deleted empty lockfile",
        "",
        `$ ${exe} -e 'process.stderr.write("preinstall stderr 🍦\\n")'`,
        "preinstall stderr 🍦",
        `$ ${exe} -e 'process.stdout.write("install stdout 🚀\\n")'`,
        `$ ${exe} -e 'Bun.sleepSync(200); process.stdout.write("prepare stdout done ✅\\n")'`,
        "",
      ]);
      const out = await Bun.readableStreamToText(stdout);
      expect(out.split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "install stdout 🚀",
        "prepare stdout done ✅",
        "",
        expect.stringContaining("done"),
        "",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });

    test("with a package", async () => {
      const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;

      const exe = bunExe().replace(/\\/g, "\\\\");
      await writeFile(
        packageJson,
        JSON.stringify({
          name: "foo",
          version: "1.2.3",
          scripts: {
            "preinstall": `${exe} -e 'process.stderr.write("preinstall stderr 🍦\\n")'`,
            "install": `${exe} -e 'process.stdout.write("install stdout 🚀\\n")'`,
            "prepare": `${exe} -e 'Bun.sleepSync(200); process.stdout.write("prepare stdout done ✅\\n")'`,
          },
          dependencies: {
            "no-deps": "1.0.0",
          },
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = stderrForInstall(await Bun.readableStreamToText(stderr));
      expect(err).not.toContain("error:");
      expect(err).not.toContain("warn:");
      expect(err.split(/\r?\n/)).toEqual([
        "Resolving dependencies",
        expect.stringContaining("Resolved, downloaded and extracted "),
        "Saved lockfile",
        "",
        `$ ${exe} -e 'process.stderr.write("preinstall stderr 🍦\\n")'`,
        "preinstall stderr 🍦",
        `$ ${exe} -e 'process.stdout.write("install stdout 🚀\\n")'`,
        `$ ${exe} -e 'Bun.sleepSync(200); process.stdout.write("prepare stdout done ✅\\n")'`,
        "",
      ]);
      const out = await Bun.readableStreamToText(stdout);
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        expect.stringContaining("bun install v1."),
        "install stdout 🚀",
        "prepare stdout done ✅",
        "",
        expect.stringContaining("+ no-deps@1.0.0"),
        "",
        "1 package installed",
      ]);
      expect(await exited).toBe(0);
      assertManifestsPopulated(join(packageDir, ".bun-cache"), verdaccio.registryUrl());
    });
  });
}
