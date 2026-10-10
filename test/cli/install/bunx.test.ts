import { spawn, type Server } from "bun";
import { afterAll, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { bunEnv, bunExe, isMusl, isWindows, readdirSorted, tempDir, tmpdirSync } from "harness";
import { chmodSync, copyFileSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "os";
import { delimiter, join, resolve } from "path";
import { dummyAfterAll, dummyBeforeAll, dummyBeforeEach, dummyRegistry, getPort, setHandler } from "./dummy.registry";

setDefaultTimeout(1000 * 60 * 5);

let x_dir: string;
let env = { ...bunEnv } as Record<string, string>;

// Each test that hits the network gets its own isolated tmpdir + install cache
// so the network-heavy tests can run concurrently without sharing bunx cache state.
function setup() {
  const install_cache_dir = tmpdirSync();
  const current_tmpdir = tmpdirSync();
  const x_dir = tmpdirSync();
  return {
    x_dir,
    env: {
      ...bunEnv,
      TEMP: current_tmpdir,
      BUN_TMPDIR: current_tmpdir,
      TMPDIR: current_tmpdir,
      BUN_INSTALL_CACHE_DIR: install_cache_dir,
    } as Record<string, string>,
  };
}

// Drop every PATH entry that already provides `name`, so `bunx <name>` cannot
// short-circuit to a binary that happens to be installed on this machine.
// Bun.which does the resolving, so Windows' .exe/.cmd lookup matches bunx's.
function pathWithout(name: string, PATH: string | undefined): string {
  return (PATH ?? "")
    .split(delimiter)
    .filter(dir => dir && !Bun.which(name, { PATH: dir }))
    .join(delimiter);
}

beforeAll(async () => {
  // Clean stale bunx cache dirs from previous runs once up front instead of before every test.
  const tmp = isWindows ? tmpdir() : "/tmp";
  const waiting: Promise<void>[] = [];
  readdirSync(tmp).forEach(file => {
    if (file.startsWith("bunx-") || file.startsWith("bun-x.test")) {
      waiting.push(rm(join(tmp, file), { recursive: true, force: true }));
    }
  });
  await Promise.all(waiting);
});

beforeEach(() => {
  // Sequential tests (the mock-registry suites below) still read these module-level vars.
  ({ x_dir, env } = setup());
});

it.concurrent("should choose the tagged versions instead of the PATH versions when a tag is specified", async () => {
  const { x_dir, env } = setup();
  let semverVersions = [
    "7.0.0",
    "7.1.0",
    "7.1.1",
    "7.1.2",
    "7.1.3",
    "7.2.0",
    "7.2.1",
    "7.2.2",
    "7.2.3",
    "7.3.0",
    "7.3.1",
    "7.3.2",
    "7.3.3",
    "7.3.4",
    "7.3.5",
    "7.3.6",
    "7.3.7",
    "7.3.8",
    "7.4.0",
    "7.5.0",
    "7.5.1",
    "7.5.2",
    "7.5.3",
    "7.5.4",
    "7.6.0",
  ].sort();
  if (isWindows) {
    // Windows does not support race-free installs.
    semverVersions = semverVersions.slice(0, 2);
  }

  const processes = semverVersions.map((version, i) => {
    return spawn({
      cmd: [bunExe(), "x", "semver@" + version, "--help"],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "ignore",
      env: {
        ...env,
        // BUN_DEBUG_QUIET_LOGS: undefined,
        // BUN_DEBUG: "/tmp/bun-debug.txt." + i,
      },
    });
  });

  const results = await Promise.all(processes.map(p => p.exited));
  expect(results).toEqual(semverVersions.map(() => 0));
  const outputs = (await Promise.all(processes.map(p => new Response(p.stdout).text()))).map(a =>
    a.substring(0, a.indexOf("\n")),
  );
  expect(outputs).toEqual(semverVersions.map(v => "SemVer " + v));
});

it.concurrent("should install and run default (latest) version", async () => {
  const { x_dir, env } = setup();
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "x", "uglify-js", "--compress"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: new TextEncoder().encode("console.log(6 * 7);"),
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  const out = await stdout.text();
  expect(out.split(/\r?\n/)).toEqual(["console.log(42);", ""]);
  expect(await exited).toBe(0);
});

it.concurrent("should install and run specified version", async () => {
  const { x_dir, env } = setup();
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "x", "uglify-js@3.14.1", "-v"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });
  const err = await stderr.text();
  expect(err).not.toContain("error:");
  const out = await stdout.text();
  expect(out.split(/\r?\n/)).toEqual(["uglify-js 3.14.1", ""]);
  expect(await exited).toBe(0);
});

it.concurrent("should output usage if no arguments are passed", async () => {
  const { x_dir, env } = setup();
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "x"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  const err = await stderr.text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Usage: ");
  const out = await stdout.text();
  expect(out).toHaveLength(0);
  expect(await exited).toBe(1);
});

it.concurrent("should work for @scoped packages", async () => {
  const { x_dir, env } = setup();
  let exited: number, err: string, out: string;
  // without cache
  const withoutCache = spawn({
    cmd: [bunExe(), "--bun", "x", "@babel/cli", "--help"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  [err, out, exited] = await Promise.all([
    new Response(withoutCache.stderr).text(),
    new Response(withoutCache.stdout).text(),
    withoutCache.exited,
  ]);
  expect(err).not.toContain("error:");
  expect(out.trim()).toContain("Usage: babel [options]");
  expect(exited).toBe(0);
  // cached
  const cached = spawn({
    cmd: [bunExe(), "--bun", "x", "@babel/cli", "--help"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  [err, out, exited] = await Promise.all([
    new Response(cached.stderr).text(),
    new Response(cached.stdout).text(),
    cached.exited,
  ]);

  expect(err).not.toContain("error:");

  expect(out.trim()).toContain("Usage: babel [options]");
});

it.concurrent("should execute from current working directory", async () => {
  const { x_dir, env } = setup();
  await writeFile(
    join(x_dir, "test.js"),
    `
console.log(
6
*
7
)`,
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "--bun", "x", "uglify-js", "test.js", "--compress"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });
  const [err, out, exitCode] = await Promise.all([stderr.text(), stdout.text(), exited]);
  expect(err).not.toContain("error:");
  expect(await readdirSorted(x_dir)).toEqual(["test.js"]);
  expect(out.split(/\r?\n/)).toEqual(["console.log(42);", ""]);
  expect(exitCode).toBe(0);
});

it.concurrent("should work for github repository", async () => {
  const { x_dir, env } = setup();
  // without cache
  const withoutCache = spawn({
    cmd: [bunExe(), "x", "github:piuccio/cowsay", "--help"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  let [err, out, exited] = await Promise.all([
    new Response(withoutCache.stderr).text(),
    new Response(withoutCache.stdout).text(),
    withoutCache.exited,
  ]);

  expect(err).not.toContain("error:");
  expect(out.trim()).toContain("Usage: " + (isWindows ? "cli.js" : "cowsay"));
  expect(exited).toBe(0);

  // cached
  const cached = spawn({
    cmd: [bunExe(), "x", "github:piuccio/cowsay", "--help"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  [err, out, exited] = await Promise.all([
    new Response(cached.stderr).text(),
    new Response(cached.stdout).text(),
    cached.exited,
  ]);

  expect(err).not.toContain("error:");
  expect(out.trim()).toContain("Usage: " + (isWindows ? "cli.js" : "cowsay"));
  expect(exited).toBe(0);
});

it.concurrent("should work for github repository with committish", async () => {
  const { x_dir, env } = setup();
  const withoutCache = spawn({
    cmd: [bunExe(), "x", "github:piuccio/cowsay#HEAD", "hello bun!"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  let [err, out, exited] = await Promise.all([
    new Response(withoutCache.stderr).text(),
    new Response(withoutCache.stdout).text(),
    withoutCache.exited,
  ]);

  expect(err).not.toContain("error:");
  expect(out.trim()).toContain("hello bun!");
  expect(exited).toBe(0);

  // cached
  const cached = spawn({
    cmd: [bunExe(), "x", "--no-install", "github:piuccio/cowsay#HEAD", "hello bun!"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  [err, out, exited] = await Promise.all([
    new Response(cached.stderr).text(),
    new Response(cached.stdout).text(),
    cached.exited,
  ]);

  expect(err).not.toContain("error:");
  expect(out.trim()).toContain("hello bun!");
  expect(exited).toBe(0);
});

it.concurrent.each(["--version", "-v"])("should print the version using %s and exit", async flag => {
  const { x_dir, env } = setup();
  const subprocess = spawn({
    cmd: [bunExe(), "x", flag],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  let [err, out, exited] = await Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited]);

  expect(err).not.toContain("error:");
  expect(out.trim()).toContain(Bun.version);
  expect(exited).toBe(0);
});

it.concurrent("should print the revision and exit", async () => {
  const { x_dir, env } = setup();
  const subprocess = spawn({
    cmd: [bunExe(), "x", "--revision"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  let [err, out, exited] = await Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited]);

  expect(err).not.toContain("error:");
  expect(out.trim()).toContain(Bun.version);
  expect(out.trim()).toContain(Bun.revision.slice(0, 7));
  expect(exited).toBe(0);
});

it.concurrent("should pass --version to the package if specified", async () => {
  const { x_dir, env } = setup();
  const subprocess = spawn({
    cmd: [bunExe(), "x", "esbuild", "--version"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  let [err, out, exited] = await Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited]);

  expect(err).not.toContain("error:");
  expect(out.trim()).not.toContain(Bun.version);
  expect(exited).toBe(0);
});

it.concurrent('should set "npm_config_user_agent" to bun', async () => {
  const { x_dir, env } = setup();
  await writeFile(
    join(x_dir, "package.json"),
    JSON.stringify({
      dependencies: {
        "print-pm": resolve(import.meta.dir, "print-pm-1.0.0.tgz"),
      },
    }),
  );

  const { exited: installFinished } = spawn({
    cmd: [bunExe(), "install"],
    cwd: x_dir,
    env,
  });
  expect(await installFinished).toBe(0);

  const subprocess = spawn({
    cmd: [bunExe(), "x", "print-pm"],
    cwd: x_dir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const [err, out, exited] = await Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited]);

  expect(err).not.toContain("error:");
  expect(out.trim()).toContain(`bun/${Bun.version}`);
  expect(exited).toBe(0);
});

/**
 * IMPORTANT
 * Please only use packages with small unpacked sizes for tests. It helps keep them fast.
 */
describe("bunx --no-install", () => {
  const run = (
    ctx: { x_dir: string; env: Record<string, string> },
    ...args: string[]
  ): Promise<[stderr: string, stdout: string, exitCode: number]> => {
    const subprocess = spawn({
      cmd: [bunExe(), "x", ...args],
      cwd: ctx.x_dir,
      env: ctx.env,
      stdout: "pipe",
      stderr: "pipe",
    });

    return Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited] as const);
  };

  it.concurrent("if the package is not installed, it should fail and print an error message", async () => {
    const ctx = setup();
    const [err, out, exited] = await run(ctx, "--no-install", "http-server", "--version");

    expect(err.trim()).toContain("Could not find an existing 'http-server' binary to run.");
    expect(out).toHaveLength(0);
    expect(exited).toBe(1);
  });

  /*
    yes, multiple package tests are neccessary.
      1. there's specialized logic for `bunx tsc` and `bunx typescript`
      2. http-server checks for non-alphanumeric edge cases. Plus it's small
      3. eslint is alphanumeric and extremely common
   */
  it.concurrent.each(["typescript", "http-server", "eslint"])(
    "`bunx --no-install %s` should find cached packages",
    async pkg => {
      const ctx = setup();
      // not cached
      {
        const [err, out, code] = await run(ctx, pkg, "--version");
        expect(err).not.toContain("error:");
        expect(out).not.toBeEmpty();
        expect(code).toBe(0);
      }

      // cached
      {
        const [err, out, code] = await run(ctx, "--no-install", pkg, "--version");
        expect(err).not.toContain("error:");
        expect(out).not.toBeEmpty();
        expect(code).toBe(0);
      }
    },
  );

  it.concurrent("when an exact version match is found, should find cached packages", async () => {
    const ctx = setup();
    // not cached
    {
      const [err, out, code] = await run(ctx, "http-server@14.0.0", "--version");
      expect(err).not.toContain("error:");
      expect(out).not.toBeEmpty();
      expect(code).toBe(0);
    }

    // cached
    {
      const [err, out, code] = await run(ctx, "--no-install", "http-server@14.0.0", "--version");
      expect(err).not.toContain("error:");
      expect(out).not.toBeEmpty();
      expect(code).toBe(0);
    }
  });
});

it.concurrent("should handle postinstall scripts correctly with symlinked bunx", async () => {
  const { x_dir, env } = setup();
  // Create a symlink to bun called "bunx"
  copyFileSync(bunExe(), join(x_dir, isWindows ? "bun.exe" : "bun"));
  copyFileSync(bunExe(), join(x_dir, isWindows ? "bunx.exe" : "bunx"));

  const subprocess = spawn({
    cmd: ["bunx", "esbuild@latest", "--version"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env: {
      ...env,
      PATH: `${x_dir}${isWindows ? ";" : ":"}${env.PATH || ""}`,
    },
  });

  let [err, out, exited] = await Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited]);

  expect(err).not.toContain("error:");
  expect(err).not.toContain("Cannot find module 'exec'");
  expect(out.trim()).not.toContain(Bun.version);
  expect(exited).toBe(0);
});

// Pinned to 20: its engines are "^20.19.0 || ^22.12.0 || >=24.0.0", so the node-24
// requirement this test exercises holds no matter what Node.js version Bun reports.
// @latest tracks Angular's engines upward and breaks whenever they outrun us.
it.concurrent("should handle package that requires node 24", async () => {
  const { x_dir, env } = setup();
  const subprocess = spawn({
    cmd: [bunExe(), "x", "--bun", "@angular/cli@20", "--help"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  let [err, out, exited] = await Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited]);
  expect(err).not.toContain("error:");
  expect(out.trim()).not.toContain(Bun.version);
  expect(exited).toBe(0);
});

describe("--package flag", () => {
  const run = async (...args: string[]): Promise<[err: string, out: string, exited: number]> => {
    const subprocess = spawn({
      cmd: [bunExe(), "x", ...args],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "inherit",
      stderr: "pipe",
      env,
    });

    const [err, out, exited] = await Promise.all([
      subprocess.stderr.text(),
      subprocess.stdout.text(),
      subprocess.exited,
    ]);

    return [err, out, exited];
  };

  it("should error when --package is provided without package name", async () => {
    const [err, out, exited] = await run("--package");
    expect(err).toContain("--package requires a package name");
    expect(exited).toBe(1);
  });

  it("should error when --package is provided without binary name", async () => {
    const [err, out, exited] = await run("--package", "some-package");
    expect(err).toContain("When using --package, you must specify the binary to run");
    expect(exited).toBe(1);
  });

  describe("with mock registry", () => {
    let port: number;

    beforeAll(() => {
      dummyBeforeAll();
      port = getPort()!;
    });

    afterAll(() => {
      dummyAfterAll();
    });

    beforeEach(async () => {
      await dummyBeforeEach();
    });

    const runWithRegistry = async (
      ...args: string[]
    ): Promise<[err: string, out: string, exited: number, urls: string[]]> => {
      const urls: string[] = [];

      const subprocess = spawn({
        cmd: [bunExe(), "x", ...args],
        cwd: x_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env: {
          ...env,
          npm_config_registry: `http://localhost:${port}/`,
        },
      });

      const [err, out, exited] = await Promise.all([
        subprocess.stderr.text(),
        subprocess.stdout.text(),
        subprocess.exited,
      ]);

      return [err, out, exited, urls];
    };

    it("should install specified package when binary differs from package name", async () => {
      const urls: string[] = [];

      // Set up dummy registry with a package that has a different binary name
      setHandler(
        dummyRegistry(urls, {
          "1.0.0": {
            bin: {
              "different-bin": "index.js",
            },
            as: "1.0.0",
          },
        }),
      );

      // Tarball already exists in test directory

      // Without --package, bunx different-bin would fail
      // With --package, we correctly install my-special-pkg
      const subprocess = spawn({
        cmd: [bunExe(), "x", "--package", "my-special-pkg", "different-bin", "--help"],
        cwd: x_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env: {
          ...env,
          npm_config_registry: `http://localhost:${port}/`,
        },
      });

      const [err, out, exited] = await Promise.all([
        subprocess.stderr.text(),
        subprocess.stdout.text(),
        subprocess.exited,
      ]);

      expect(urls.some(url => url.includes("/my-special-pkg"))).toBe(true);
      // The package should install successfully
      expect(err).toContain("Saved lockfile");
    });

    it("should support -p shorthand with mock registry", async () => {
      const urls: string[] = [];

      setHandler(
        dummyRegistry(urls, {
          "2.0.0": {
            bin: {
              "tool": "cli.js",
            },
            as: "2.0.0",
          },
        }),
      );

      // Tarball already exists in test directory

      const subprocess = spawn({
        cmd: [bunExe(), "x", "-p", "actual-package", "tool", "--version"],
        cwd: x_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env: {
          ...env,
          npm_config_registry: `http://localhost:${port}/`,
        },
      });

      const [err, out, exited] = await Promise.all([
        subprocess.stderr.text(),
        subprocess.stdout.text(),
        subprocess.exited,
      ]);

      expect(urls.some(url => url.includes("/actual-package"))).toBe(true);
    });

    it("should support --package=<pkg> syntax with mock registry", async () => {
      const urls: string[] = [];

      setHandler(
        dummyRegistry(urls, {
          "3.0.0": {
            bin: {
              "runner": "run.js",
            },
            as: "3.0.0",
          },
        }),
      );

      // Tarball already exists in test directory

      const subprocess = spawn({
        cmd: [bunExe(), "x", "--package=runner-pkg", "runner", "--help"],
        cwd: x_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env: {
          ...env,
          npm_config_registry: `http://localhost:${port}/`,
        },
      });

      const [err, out, exited] = await Promise.all([
        subprocess.stderr.text(),
        subprocess.stdout.text(),
        subprocess.exited,
      ]);

      expect(urls.some(url => url.includes("/runner-pkg"))).toBe(true);
    });

    it("should fail to run alternate binary without --package flag", async () => {
      // Attempt to run multi-tool-alt without --package flag
      // This should fail because bunx would try to install a package named "multi-tool-alt"
      const subprocess = spawn({
        cmd: [bunExe(), "x", "multi-tool-alt"],
        cwd: x_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env: {
          ...env,
          npm_config_registry: `http://localhost:${port}/`,
        },
      });

      const [err, _out, exited] = await Promise.all([
        subprocess.stderr.text(),
        subprocess.stdout.text(),
        subprocess.exited,
      ]);

      // Should fail because there's no package named "multi-tool-alt"
      expect(err).toContain("error:");
      expect(exited).not.toBe(0);
    });

    it("should execute the correct binary when package has multiple binaries", async () => {
      const urls: string[] = [];

      // Create the tarball with both binaries that output different messages
      // First, let's create the package structure
      const tempDir = tmpdirSync();
      const packageDir = join(tempDir, "package");

      await Bun.$`mkdir -p ${packageDir}/bin`;

      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "multi-tool-pkg",
          version: "1.0.0",
          bin: {
            "multi-tool": "bin/multi-tool.js",
            "multi-tool-alt": "bin/multi-tool-alt.js",
          },
        }),
      );

      await writeFile(
        join(packageDir, "bin", "multi-tool.js"),
        `#!/usr/bin/env node
console.log("EXECUTED: multi-tool (main binary)");
`,
      );

      await writeFile(
        join(packageDir, "bin", "multi-tool-alt.js"),
        `#!/usr/bin/env node
console.log("EXECUTED: multi-tool-alt (alternate binary)");
`,
      );

      // Make the binaries executable
      await Bun.$`chmod +x ${packageDir}/bin/multi-tool.js ${packageDir}/bin/multi-tool-alt.js`;

      // Create the tarball with package/ prefix. It goes to a temp dir the
      // registry is pointed at — writing it under import.meta.dir would
      // rewrite a checked-in file on every run.
      const tgzDir = tmpdirSync();
      await Bun.$`cd ${tempDir} && tar -czf ${join(tgzDir, "multi-tool-pkg-1.0.0.tgz")} package`;

      setHandler(
        dummyRegistry(
          urls,
          {
            "1.0.0": {
              bin: {
                "multi-tool": "bin/multi-tool.js",
                "multi-tool-alt": "bin/multi-tool-alt.js",
              },
              as: "1.0.0",
            },
          },
          0,
          tgzDir,
        ),
      );

      // Test 1: Without --package, bunx multi-tool-alt should fail or install wrong package
      // Test 2: With --package, we can run the alternate binary
      const subprocess = spawn({
        cmd: [bunExe(), "x", "--package", "multi-tool-pkg", "multi-tool-alt"],
        cwd: x_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env: {
          ...env,
          npm_config_registry: `http://localhost:${port}/`,
        },
      });

      const [_err, out, exited] = await Promise.all([
        subprocess.stderr.text(),
        subprocess.stdout.text(),
        subprocess.exited,
      ]);

      // Verify the correct package was requested
      expect(urls.some(url => url.includes("/multi-tool-pkg"))).toBe(true);

      // Verify the correct binary was executed
      expect(out).toContain("EXECUTED: multi-tool-alt (alternate binary)");
      expect(out).not.toContain("EXECUTED: multi-tool (main binary)");
      expect(exited).toBe(0);
    });
  });
});

// Regression: `bunx @scope/name` guesses the bin name as `name` (the
// unscoped portion), then searched the full system $PATH with it. When
// `name` happened to match an unrelated system binary — e.g.
// `bunx @uidotsh/install` matching /usr/bin/install — the system binary
// was executed instead of the package's actual bin.
describe("scoped packages should not match unrelated system binaries", () => {
  let port: number;

  beforeAll(() => {
    dummyBeforeAll();
    port = getPort()!;
  });

  afterAll(() => {
    dummyAfterAll();
  });

  beforeEach(async () => {
    await dummyBeforeEach();
  });

  it("`bunx @scope/install` runs the package's bin, not a system binary named `install`", async () => {
    // Create a scoped package whose bin name does NOT match the unscoped
    // portion of the package name, mirroring @uidotsh/install whose bin is
    // "uidotsh-installer".
    const pkgRoot = tmpdirSync();
    const packageDir = join(pkgRoot, "package");
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "@scope/install",
        version: "1.0.0",
        bin: { "scoped-tool": "cli.js" },
      }),
    );
    await writeFile(
      join(packageDir, "cli.js"),
      `#!/usr/bin/env node\nconsole.log("CORRECT: ran the scoped package's bin");\n`,
    );
    const tgzDir = tmpdirSync();
    // The dummy registry serves the tarball by basename of the request URL,
    // which for `@scope/install` + version 1.0.0 is `install-1.0.0.tgz`.
    await Bun.$`tar -czf ${join(tgzDir, "install-1.0.0.tgz")} -C ${pkgRoot} package`;

    // Create a fake "install" binary in $PATH to simulate /usr/bin/install.
    const fakeBinDir = tmpdirSync();
    if (isWindows) {
      await writeFile(join(fakeBinDir, "install.cmd"), `@echo WRONG: ran a system binary from PATH\r\n`);
    } else {
      const fakeBin = join(fakeBinDir, "install");
      await writeFile(fakeBin, `#!/bin/sh\necho "WRONG: ran a system binary from PATH"\n`);
      await Bun.$`chmod +x ${fakeBin}`;
    }

    const urls: string[] = [];
    setHandler(dummyRegistry(urls, { "1.0.0": { bin: { "scoped-tool": "cli.js" }, as: "1.0.0" } }, 0, tgzDir));

    const subprocess = spawn({
      cmd: [bunExe(), "x", "@scope/install"],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "inherit",
      stderr: "pipe",
      env: {
        ...env,
        npm_config_registry: `http://localhost:${port}/`,
        PATH: `${fakeBinDir}${delimiter}${env.PATH ?? process.env.PATH ?? ""}`,
      },
    });

    const [err, out, exited] = await Promise.all([
      subprocess.stderr.text(),
      subprocess.stdout.text(),
      subprocess.exited,
    ]);

    expect(out).not.toContain("WRONG");
    expect(err).not.toContain("WRONG");
    expect(out).toContain("CORRECT: ran the scoped package's bin");
    expect(exited).toBe(0);
  });

  // Also covers https://github.com/oven-sh/bun/issues/19458 and
  // https://github.com/oven-sh/bun/issues/17904: when a scoped package is
  // already installed locally, bunx must read its package.json (under the
  // full scoped name) to discover the real bin name, instead of guessing
  // the unscoped basename and tripping over a system binary.
  it("locally installed `@scope/name` resolves the real bin from its package.json", async () => {
    await mkdir(join(x_dir, "node_modules", "@myscope", "collide"), { recursive: true });
    await mkdir(join(x_dir, "node_modules", ".bin"), { recursive: true });
    await writeFile(
      join(x_dir, "node_modules", "@myscope", "collide", "package.json"),
      JSON.stringify({ name: "@myscope/collide", version: "1.0.0", bin: { "real-bin": "./real.js" } }),
    );
    await writeFile(
      join(x_dir, "node_modules", "@myscope", "collide", "real.js"),
      `#!/usr/bin/env node\nconsole.log("REAL_BIN_RAN");\n`,
    );
    if (isWindows) {
      await writeFile(
        join(x_dir, "node_modules", ".bin", "real-bin.cmd"),
        `@echo off\r\nnode "%~dp0..\\@myscope\\collide\\real.js" %*\r\n`,
      );
    } else {
      await writeFile(
        join(x_dir, "node_modules", ".bin", "real-bin"),
        `#!/usr/bin/env node\nrequire("../@myscope/collide/real.js");\n`,
      );
      chmodSync(join(x_dir, "node_modules", "@myscope", "collide", "real.js"), 0o755);
      chmodSync(join(x_dir, "node_modules", ".bin", "real-bin"), 0o755);
    }

    // Put a decoy named after the unscoped basename ("collide") in $PATH.
    const fakeBinDir = tmpdirSync();
    if (isWindows) {
      await writeFile(join(fakeBinDir, "collide.cmd"), `@echo off\r\necho DECOY_RAN\r\n`);
    } else {
      const fakeBin = join(fakeBinDir, "collide");
      await writeFile(fakeBin, `#!/bin/sh\necho DECOY_RAN\n`);
      chmodSync(fakeBin, 0o755);
    }

    const subprocess = spawn({
      cmd: [bunExe(), "x", "--no-install", "@myscope/collide"],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "inherit",
      stderr: "pipe",
      env: {
        ...env,
        PATH: `${fakeBinDir}${delimiter}${env.PATH ?? process.env.PATH ?? ""}`,
      },
    });

    const [err, out, exited] = await Promise.all([
      subprocess.stderr.text(),
      subprocess.stdout.text(),
      subprocess.exited,
    ]);

    expect(out.trim()).toBe("REAL_BIN_RAN");
    expect(out).not.toContain("DECOY_RAN");
    expect(err).not.toContain("error:");
    expect(exited).toBe(0);
  });

  // When a scoped package's bin name happens to match its unscoped
  // basename (e.g. `@scope/foo` with bin `foo`), the first $PATH probe —
  // which excludes the system $PATH for scoped packages but still searches
  // node_modules/.bin — should find the locally-linked bin.
  it("locally installed `@scope/foo` whose bin is also named `foo` is still found", async () => {
    await mkdir(join(x_dir, "node_modules", "@myscope", "samebin"), { recursive: true });
    await mkdir(join(x_dir, "node_modules", ".bin"), { recursive: true });
    await writeFile(
      join(x_dir, "node_modules", "@myscope", "samebin", "package.json"),
      JSON.stringify({ name: "@myscope/samebin", version: "1.0.0", bin: { samebin: "./real.js" } }),
    );
    await writeFile(
      join(x_dir, "node_modules", "@myscope", "samebin", "real.js"),
      `#!/usr/bin/env node\nconsole.log("SAMEBIN_RAN");\n`,
    );
    if (isWindows) {
      await writeFile(
        join(x_dir, "node_modules", ".bin", "samebin.cmd"),
        `@echo off\r\nnode "%~dp0..\\@myscope\\samebin\\real.js" %*\r\n`,
      );
    } else {
      await writeFile(
        join(x_dir, "node_modules", ".bin", "samebin"),
        `#!/usr/bin/env node\nrequire("../@myscope/samebin/real.js");\n`,
      );
      chmodSync(join(x_dir, "node_modules", "@myscope", "samebin", "real.js"), 0o755);
      chmodSync(join(x_dir, "node_modules", ".bin", "samebin"), 0o755);
    }

    const subprocess = spawn({
      cmd: [bunExe(), "x", "--no-install", "@myscope/samebin"],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "inherit",
      stderr: "pipe",
      env,
    });

    const [err, out, exited] = await Promise.all([
      subprocess.stderr.text(),
      subprocess.stdout.text(),
      subprocess.exited,
    ]);

    expect(out.trim()).toBe("SAMEBIN_RAN");
    expect(err).not.toContain("error:");
    expect(exited).toBe(0);
  });

  // When a scoped package lives only in the bunx cache (not locally
  // installed) and its real bin name — discovered by reading its
  // package.json — collides with a system binary, bunx must run the
  // cached bin via the absolute-path probe, not the system binary.
  it("bunx-cache-only `@scope/name` whose real bin collides with a system binary runs the cached bin", async () => {
    // Create a scoped package with a bin name that differs from the
    // unscoped portion AND collides with a system binary we control.
    const pkgRoot = tmpdirSync();
    const packageDir = join(pkgRoot, "package");
    await mkdir(packageDir, { recursive: true });
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "@cacheonly/pkg",
        version: "1.0.0",
        bin: { "colliding-tool": "cli.js" },
      }),
    );
    await writeFile(
      join(packageDir, "cli.js"),
      `#!/usr/bin/env node\nconsole.log("CORRECT: ran the cached package's bin");\n`,
    );
    const tgzDir = tmpdirSync();
    await Bun.$`tar -czf ${join(tgzDir, "pkg-1.0.0.tgz")} -C ${pkgRoot} package`;

    // Put a decoy "colliding-tool" (the REAL bin name) in $PATH.
    const fakeBinDir = tmpdirSync();
    if (isWindows) {
      await writeFile(join(fakeBinDir, "colliding-tool.cmd"), `@echo WRONG: ran a system binary from PATH\r\n`);
    } else {
      const fakeBin = join(fakeBinDir, "colliding-tool");
      await writeFile(fakeBin, `#!/bin/sh\necho "WRONG: ran a system binary from PATH"\n`);
      chmodSync(fakeBin, 0o755);
    }

    const urls: string[] = [];
    setHandler(dummyRegistry(urls, { "1.0.0": { bin: { "colliding-tool": "cli.js" }, as: "1.0.0" } }, 0, tgzDir));

    const runEnv = {
      ...env,
      npm_config_registry: `http://localhost:${port}/`,
      PATH: `${fakeBinDir}${delimiter}${env.PATH ?? process.env.PATH ?? ""}`,
    };

    // First run: installs into the bunx cache (no local node_modules).
    {
      const subprocess = spawn({
        cmd: [bunExe(), "x", "@cacheonly/pkg"],
        cwd: x_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env: runEnv,
      });
      const [err, out, exited] = await Promise.all([
        subprocess.stderr.text(),
        subprocess.stdout.text(),
        subprocess.exited,
      ]);
      expect(out).not.toContain("WRONG");
      expect(err).not.toContain("WRONG");
      expect(out).toContain("CORRECT: ran the cached package's bin");
      expect(exited).toBe(0);
    }

    // Second run with --no-install: must resolve the real bin name from
    // the cached package.json and run the cached bin, NOT the colliding
    // system binary.
    {
      const subprocess = spawn({
        cmd: [bunExe(), "x", "--no-install", "@cacheonly/pkg"],
        cwd: x_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env: runEnv,
      });
      const [err, out, exited] = await Promise.all([
        subprocess.stderr.text(),
        subprocess.stdout.text(),
        subprocess.exited,
      ]);
      expect(out).not.toContain("WRONG");
      expect(err).not.toContain("WRONG");
      expect(out).toContain("CORRECT: ran the cached package's bin");
      expect(exited).toBe(0);
    }
  });
});

describe("package name aliases", () => {
  let port: number;

  beforeAll(() => {
    dummyBeforeAll();
    port = getPort()!;
  });

  afterAll(() => {
    dummyAfterAll();
  });

  beforeEach(async () => {
    await dummyBeforeEach();
  });

  // `bunx claude` should resolve to `@anthropic-ai/claude-code` (same shape as
  // the `tsc` -> `typescript` rewrite). The npm package named `claude` is an
  // unrelated squatter with no bin, so redirecting is strictly more useful.
  it("`bunx claude` requests @anthropic-ai/claude-code, not the 'claude' squatter", async () => {
    const urls: string[] = [];
    setHandler(async request => {
      urls.push(request.url);
      return new Response("{}", { status: 404 });
    });

    const subprocess = spawn({
      cmd: [bunExe(), "x", "claude", "--version"],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "inherit",
      stderr: "pipe",
      env: {
        ...env,
        // An untagged `bunx <name>` runs a matching binary already on PATH
        // instead of querying the registry, so a machine with `claude`
        // installed never makes the request this test asserts on. Drop those
        // entries so the alias is what gets exercised, not the developer's or
        // the agent's PATH.
        PATH: pathWithout("claude", env.PATH),
        npm_config_registry: `http://localhost:${port}/`,
      },
    });

    const [, , exited] = await Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited]);

    const paths = urls.map(u => new URL(u).pathname);
    // The manifest request must be for the real package, and must never hit
    // the squatter package name.
    expect(paths).toContain("/@anthropic-ai%2fclaude-code");
    expect(paths).not.toContain("/claude");
    // Install fails because the mock registry 404s; that's fine, we only care
    // about which manifest was requested.
    expect(exited).not.toBe(0);
  });
});

// Regression test: bunx should not crash on corrupted .bunx files (Windows only)
// When the .bunx metadata file is corrupted (e.g., missing quote terminator in bin_path),
// bunx should gracefully fall back to the slow path instead of panicking.
it.skipIf(!isWindows)("should not crash on corrupted .bunx file with missing quote", async () => {
  // First, install a package to create a valid .bunx file
  // Use typescript which creates both .exe and .bunx files
  // Need to init first to create package.json
  const initProc = spawn({
    cmd: [bunExe(), "init", "-y"],
    cwd: x_dir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  await initProc.exited;

  const subprocess1 = spawn({
    cmd: [bunExe(), "add", "typescript@5.0.0"],
    cwd: x_dir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const [err1, out1, exitCode1] = await Promise.all([
    subprocess1.stderr.text(),
    subprocess1.stdout.text(),
    subprocess1.exited,
  ]);

  // Find the .bunx file
  const binDir = join(x_dir, "node_modules", ".bin");
  const bunxFile = join(binDir, "tsc.bunx");

  // Verify the file exists before corrupting it
  expect(await Bun.file(bunxFile).exists()).toBe(true);

  // Create a corrupted .bunx file:
  // Valid format: [bin_path UTF-16LE]["(quote)][null][shebang][bin_len u32][args_len u32][flags u16]
  // Corrupted: Replace the quote with 'X' but keep valid lengths/flags
  const binPath = Buffer.from("typescript\\bin\\tsc", "utf16le");
  const corruptedQuote = Buffer.from("X", "utf16le"); // 'X' instead of '"'
  const nullChar = Buffer.alloc(2, 0);
  const shebang = Buffer.from("node ", "utf16le");
  const binLen = Buffer.alloc(4);
  binLen.writeUInt32LE(binPath.length);
  const argsLen = Buffer.alloc(4);
  argsLen.writeUInt32LE(shebang.length);
  // Valid flags with has_shebang=true, is_node_or_bun=true, version=v5
  const flags = Buffer.alloc(2);
  flags.writeUInt16LE(0xab37);

  const corruptedData = Buffer.concat([binPath, corruptedQuote, nullChar, shebang, binLen, argsLen, flags]);
  await writeFile(bunxFile, corruptedData);

  // Now run bunx - it should NOT crash, but may fail gracefully
  // Using bun run to invoke tsc.exe, which triggers the BunXFastPath
  const subprocess2 = spawn({
    cmd: [bunExe(), "run", "tsc", "--version"],
    cwd: x_dir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const [stderr, stdout, exitCode] = await Promise.all([
    subprocess2.stderr.text(),
    subprocess2.stdout.text(),
    subprocess2.exited,
  ]);

  // The key assertion: we should NOT see a panic
  expect(stderr).not.toContain("panic");
  expect(stderr).not.toContain("reached unreachable code");
});

// The bunx cache root lives at a predictable path inside the shared temp dir
// ($TMPDIR/bunx-<uid>-<pkg>@<version>). bunx must refuse to reuse a
// pre-existing cache root that is not a private directory owned by the
// current user, because the owner of that directory can replace any of the
// cached package's module files after install. The check happens before any
// network or filesystem access inside the cache, so this test is fully
// offline. The check is Unix-only (no uid/world-writable-tmp model on
// Windows).
it.concurrent.skipIf(isWindows)(
  "refuses to reuse a bunx cache directory that other local users can modify",
  async () => {
    const { x_dir, env } = setup();
    const pkg = "bunx-cache-root-fixture";
    const cacheRoot = join(env.TMPDIR, `bunx-${process.getuid!()}-${pkg}@latest`);

    const run = () => {
      const subprocess = spawn({
        cmd: [bunExe(), "x", "--no-install", pkg],
        cwd: x_dir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      return Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited] as const);
    };

    // Legitimate case: a pre-existing cache root that is a private directory
    // owned by the current user is accepted. bunx gets past the cache-root
    // validation and fails later with the normal --no-install "could not
    // find an existing binary" message because the cache is empty.
    await mkdir(cacheRoot, { recursive: true });
    chmodSync(cacheRoot, 0o755);
    {
      const [err, out, exitCode] = await run();
      expect(err).not.toContain("refusing to use bunx cache directory");
      expect(err).toContain(`Could not find an existing '${pkg}' binary to run.`);
      expect(out).toHaveLength(0);
      expect(exitCode).toBe(1);
    }

    // The same cache root made writable by group/other -- the state a
    // pre-created directory in the shared temp dir must be in for another
    // user's install to populate it -- must be refused before bunx reads or
    // writes anything inside it.
    chmodSync(cacheRoot, 0o777);
    {
      const [err, out, exitCode] = await run();
      expect(err).toContain("refusing to use bunx cache directory");
      expect(err).toContain("not a directory owned by the current user");
      expect(out).toHaveLength(0);
      expect(exitCode).toBe(1);
    }

    // A cache root that is a symlink (redirecting the whole install
    // elsewhere) must also be refused.
    await rm(cacheRoot, { recursive: true, force: true });
    const elsewhere = join(env.TMPDIR, "bunx-cache-root-fixture-elsewhere");
    await mkdir(elsewhere, { recursive: true });
    symlinkSync(elsewhere, cacheRoot);
    {
      const [err, out, exitCode] = await run();
      expect(err).toContain("refusing to use bunx cache directory");
      expect(out).toHaveLength(0);
      expect(exitCode).toBe(1);
    }
  },
);

it.concurrent.skipIf(isWindows)(
  "validates every path component of a scoped package's bunx cache directory",
  async () => {
    const { x_dir, env } = setup();
    const scope = "bunx-cache-scope-fixture";
    const pkg = "bunx-cache-root-fixture";
    const scopeDir = join(env.TMPDIR, `bunx-${process.getuid!()}-@${scope}`);

    const run = () => {
      const subprocess = spawn({
        cmd: [bunExe(), "x", "--no-install", `@${scope}/${pkg}`],
        cwd: x_dir,
        stdout: "pipe",
        stdin: "ignore",
        stderr: "pipe",
        env,
      });
      return Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited] as const);
    };

    await mkdir(scopeDir, { recursive: true });
    chmodSync(scopeDir, 0o755);
    {
      const [err, out, exitCode] = await run();
      expect(err).not.toContain("refusing to use bunx cache directory");
      expect(err).toContain(`Could not find an existing '${pkg}' binary to run.`);
      expect(out).toHaveLength(0);
      expect(exitCode).toBe(1);
    }

    chmodSync(scopeDir, 0o777);
    {
      const [err, out, exitCode] = await run();
      expect(err).toContain("refusing to use bunx cache directory");
      expect(err).toContain("not a directory owned by the current user");
      expect(out).toHaveLength(0);
      expect(exitCode).toBe(1);
    }

    await rm(scopeDir, { recursive: true, force: true });
    const elsewhere = join(env.TMPDIR, "bunx-cache-scope-fixture-elsewhere");
    await mkdir(elsewhere, { recursive: true });
    chmodSync(elsewhere, 0o755);
    symlinkSync(elsewhere, scopeDir);
    {
      const [err, out, exitCode] = await run();
      expect(err).toContain("refusing to use bunx cache directory");
      expect(err).toContain("not a directory owned by the current user");
      expect(out).toHaveLength(0);
      expect(exitCode).toBe(1);
    }
  },
);

// A versionless `bunx <name>` takes the copy in the project or stops. When node_modules has the
// command file or the package but it cannot run, neither the bunx cache nor the registry stands
// in for it: on the registry the name can belong to somebody else.
describe("a command that is in the project but cannot run", () => {
  type Pkg = { name: string; bin: string };
  const mytool: Pkg = { name: "mytool", bin: "mytool" };
  const compiler: Pkg = { name: "compiler", bin: "cc-tool" };
  const kit: Pkg = { name: "@acme/kit", bin: "acme-kit" };

  // The registry has <name>@9.9.9 under every name. Its bin prints "REGISTRY <name>".
  // Every run asks under a path prefix of its own, so `asked` holds what that run requested.
  const registryBin: Record<string, string> = { compiler: "cc-tool", "@acme/kit": "acme-kit" };
  const asked = new Map<string, string[]>();
  let registry: Server;
  let runs = 0;

  beforeAll(() => {
    registry = Bun.serve({
      port: 0,
      async fetch(req) {
        const [run, ...rest] = decodeURIComponent(new URL(req.url).pathname).slice(1).split("/");
        asked.get(run)?.push(rest.join("/"));
        const name = rest.slice(0, rest[0].startsWith("@") ? 2 : 1).join("/");
        const unscoped = name.slice(name.indexOf("/") + 1);
        const bin = { [registryBin[name] ?? unscoped]: "cli.js" };
        if (req.url.endsWith(".tgz")) {
          const files = {
            "package/package.json": JSON.stringify({ name, version: "9.9.9", bin }),
            "package/cli.js": `#!/usr/bin/env node\nconsole.log("REGISTRY ${name}");\n`,
          };
          return new Response(await new Bun.Archive(files, { compress: "gzip" }).bytes());
        }
        const tarball = `${registry.url}${run}/${name}/-/${unscoped}-9.9.9.tgz`;
        return Response.json({
          name,
          "dist-tags": { latest: "9.9.9" },
          versions: { "9.9.9": { name, version: "9.9.9", bin, dist: { tarball } } },
        });
      },
    });
  });
  afterAll(() => registry.stop(true));

  const target = (app: string, pkg: Pkg) => join(app, "node_modules", pkg.name, "cli.js");
  // What `which` runs, and what the error names. On Windows the linker of bun writes
  // <bin>.bunx and the <bin>.exe that reads it; this fixture stands a .cmd in for the pair.
  const launcher = (app: string, bin: string) => join(app, "node_modules", ".bin", isWindows ? `${bin}.cmd` : bin);
  const entry = (app: string, bin: string) => join(app, "node_modules", ".bin", isWindows ? `${bin}.bunx` : bin);

  // <root>/app is a project with `pkgs` in node_modules, linked the way `bun install` links them.
  // <root>/tmp holds the bunx cache of the runs in this project.
  function project(pkgs: Pkg[], appPackageJson: object = { name: "app" }) {
    const root = tempDir("bunx-project", {
      tmp: {},
      cache: {},
      app: { "package.json": JSON.stringify(appPackageJson) },
    });
    const app = join(String(root), "app");
    for (const pkg of pkgs) {
      const dir = join(app, "node_modules", pkg.name);
      mkdirSync(dir, { recursive: true });
      mkdirSync(join(app, "node_modules", ".bin"), { recursive: true });
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: pkg.name, version: "1.0.0", bin: { [pkg.bin]: "cli.js" } }),
      );
      writeFileSync(target(app, pkg), `#!/usr/bin/env node\nconsole.log("LOCAL ${pkg.name}");\n`);
      if (isWindows) {
        writeFileSync(launcher(app, pkg.bin), `@node "%~dp0..\\${pkg.name.replace("/", "\\")}\\cli.js" %*\r\n`);
      } else {
        chmodSync(target(app, pkg), 0o755);
        symlinkSync(join("..", pkg.name, "cli.js"), launcher(app, pkg.bin));
      }
    }
    return root;
  }

  async function run(root: string, cwd: string, cmd: string[], env: Record<string, string> = {}) {
    const id = `run${runs++}`;
    asked.set(id, []);
    await using proc = spawn({
      cmd,
      cwd,
      env: {
        ...bunEnv,
        TEMP: join(root, "tmp"),
        TMPDIR: join(root, "tmp"),
        BUN_TMPDIR: join(root, "tmp"),
        BUN_INSTALL_CACHE_DIR: join(root, "cache"),
        BUN_CONFIG_REGISTRY: `${registry.url}${id}/`,
        ...env,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode, asked: asked.get(id)! };
  }
  type Result = Awaited<ReturnType<typeof run>>;

  const isRoot = !isWindows && process.getuid!() === 0;
  const noExecuteBit = "has no execute permission";
  const gone = "does not exist";
  // Windows paths compare without case: the drive letter of a cwd can be in either.
  const fold = (text: string) => (isWindows ? text.toLowerCase() : text);
  // musl defines O_EXEC as O_PATH, so `which` takes a file with no execute bit (#44513).
  // bunx then fails when it runs the file, with no message of its own.
  const hasMessage = (why: string) => !(isMusl && why === noExecuteBit);

  function expectStopped(result: Result, name: string, path: string, why: string) {
    if (hasMessage(why)) {
      expect(fold(result.stderr)).toContain(
        fold(`error: ${name} is installed in this project but cannot run: ${path} ${why}`),
      );
    }
    expect({ stdout: result.stdout, asked: result.asked, exitCode: result.exitCode }).toEqual({
      stdout: "",
      asked: [],
      exitCode: 1,
    });
  }

  type Row = {
    title: string;
    pkg?: Pkg;
    argv: string[];
    // makes the copy in the project unrunnable
    breakIt: (app: string) => void;
    // what the error names: the command or the package, the file, the reason
    name: string;
    file: (app: string) => string;
    why: string;
    note?: (app: string) => string;
    // undoes what would keep the project from being removed
    restore?: (app: string) => void;
    skip?: boolean;
  };
  const rows: Row[] = [
    {
      title: "the bin target has no execute bit",
      argv: ["mytool"],
      breakIt: app => chmodSync(target(app, mytool), 0o644),
      name: "mytool",
      file: app => entry(app, "mytool"),
      why: noExecuteBit,
      note: app => `note: run \`chmod +x "${entry(app, "mytool")}"\`\n`,
      skip: isWindows,
    },
    {
      title: "the .bin entry is a plain file with no execute bit",
      argv: ["mytool"],
      breakIt: app => {
        rmSync(launcher(app, "mytool"));
        writeFileSync(launcher(app, "mytool"), "#!/bin/sh\necho plain\n", { mode: 0o644 });
      },
      name: "mytool",
      file: app => entry(app, "mytool"),
      why: noExecuteBit,
      skip: isWindows,
    },
    {
      title: "the .bin directory cannot be searched",
      argv: ["mytool"],
      breakIt: app => chmodSync(join(app, "node_modules", ".bin"), 0o000),
      name: "mytool",
      file: app => entry(app, "mytool"),
      why: "cannot be accessed (EACCES)",
      restore: app => chmodSync(join(app, "node_modules", ".bin"), 0o755),
      // root searches every directory
      skip: isWindows || isRoot,
    },
    {
      title: "the command is not named like its package and has no execute bit",
      pkg: compiler,
      argv: ["cc-tool"],
      breakIt: app => chmodSync(target(app, compiler), 0o644),
      name: "cc-tool",
      file: app => entry(app, "cc-tool"),
      why: noExecuteBit,
      skip: isWindows,
    },
    {
      title: "the .bunx of the command is there and its .exe is not",
      argv: ["mytool"],
      breakIt: app => {
        rmSync(launcher(app, "mytool"));
        writeFileSync(entry(app, "mytool"), "");
      },
      name: "mytool",
      file: app => entry(app, "mytool"),
      why: "has no .exe launcher next to it",
      note: () => "note: run `bun install` to link it\n",
      skip: !isWindows,
    },
    {
      title: "the .bin link is gone",
      argv: ["mytool"],
      breakIt: app => rmSync(launcher(app, "mytool")),
      name: "mytool",
      file: app => entry(app, "mytool"),
      why: gone,
      note: () =>
        "note: run `bun install` to link it, or ask for a version (`mytool@latest`) to run the copy from the registry\n",
    },
    {
      title: "the .bin directory is gone",
      argv: ["mytool"],
      breakIt: app => rmSync(join(app, "node_modules", ".bin"), { recursive: true }),
      name: "mytool",
      file: app => entry(app, "mytool"),
      why: gone,
    },
    {
      title: "the .bin entry is a directory",
      argv: ["mytool"],
      breakIt: app => {
        rmSync(launcher(app, "mytool"));
        mkdirSync(entry(app, "mytool"));
      },
      name: "mytool",
      file: app => entry(app, "mytool"),
      why: "is not a file",
    },
    {
      title: "the .bin link points to a file that is gone",
      argv: ["mytool"],
      breakIt: app => rmSync(target(app, mytool)),
      name: "mytool",
      file: app => entry(app, "mytool"),
      why: "is a link to a file that does not exist",
      note: () =>
        "note: build or reinstall the package so that the link has a target, or ask for a version (`mytool@latest`) to run the copy from the registry\n",
      skip: isWindows,
    },
    {
      title: "the package.json of the package cannot be parsed",
      argv: ["mytool"],
      breakIt: app => {
        rmSync(launcher(app, "mytool"));
        writeFileSync(join(app, "node_modules", "mytool", "package.json"), `{ "name": "mytool", "bin": {`);
      },
      name: "mytool",
      file: app => join(app, "node_modules", "mytool", "package.json"),
      why: "cannot be read (",
    },
    {
      title: "the bin of the package is not named like the package and has no execute bit",
      pkg: compiler,
      argv: ["compiler"],
      breakIt: app => chmodSync(target(app, compiler), 0o644),
      name: "compiler",
      file: app => entry(app, "cc-tool"),
      why: noExecuteBit,
      note: app =>
        `note: run \`chmod +x "${entry(app, "cc-tool")}"\`, or ask for a version (\`compiler@latest\`) to run the copy from the registry\n`,
      skip: isWindows,
    },
    {
      title: "the link of a scoped package is gone",
      pkg: kit,
      argv: ["@acme/kit"],
      breakIt: app => rmSync(launcher(app, "acme-kit")),
      name: "@acme/kit",
      file: app => entry(app, "acme-kit"),
      why: gone,
    },
    {
      title: "--package, the bin has no execute bit",
      pkg: compiler,
      argv: ["--package", "compiler", "cc-tool"],
      breakIt: app => chmodSync(target(app, compiler), 0o644),
      name: "cc-tool",
      file: app => entry(app, "cc-tool"),
      why: noExecuteBit,
      skip: isWindows,
    },
    {
      title: "--package, the link of the bin is gone",
      pkg: compiler,
      argv: ["-p", "compiler", "cc-tool"],
      breakIt: app => rmSync(launcher(app, "cc-tool")),
      name: "compiler",
      file: app => entry(app, "cc-tool"),
      why: gone,
    },
    {
      title: "--no-install",
      argv: ["--no-install", "mytool"],
      breakIt: app => rmSync(launcher(app, "mytool")),
      name: "mytool",
      file: app => entry(app, "mytool"),
      why: gone,
    },
  ];

  for (const row of rows) {
    it.concurrent.skipIf(row.skip ?? false)(`stops: ${row.title}`, async () => {
      using root = project([row.pkg ?? mytool]);
      const app = join(String(root), "app");
      row.breakIt(app);
      try {
        const result = await run(String(root), app, [bunExe(), "x", ...row.argv]);
        if (row.note && hasMessage(row.why)) expect(fold(result.stderr)).toContain(fold(row.note(app)));
        expectStopped(result, row.name, row.file(app), row.why);
      } finally {
        row.restore?.(app);
      }
    });
  }

  it.concurrent("stops: bun create, the link of the create package is gone", async () => {
    using root = project([{ name: "create-foo", bin: "create-foo" }]);
    const app = join(String(root), "app");
    rmSync(launcher(app, "create-foo"));
    const result = await run(String(root), app, [bunExe(), "create", "foo"]);
    expectStopped(result, "create-foo", entry(app, "create-foo"), gone);
  });

  it.concurrent("stops: a script that calls npx, the link is gone", async () => {
    using root = project([mytool], { name: "app", scripts: { tool: "npx mytool" } });
    const app = join(String(root), "app");
    rmSync(launcher(app, "mytool"));
    const result = await run(String(root), app, [bunExe(), "run", "tool"]);
    expectStopped(result, "mytool", entry(app, "mytool"), gone);
  });

  it.concurrent.skipIf(isWindows)("stops: an executable named bunx, the bin has no execute bit", async () => {
    using root = project([mytool]);
    const app = join(String(root), "app");
    chmodSync(target(app, mytool), 0o644);
    symlinkSync(bunExe(), join(String(root), "bunx"));
    const result = await run(String(root), app, [join(String(root), "bunx"), "mytool"]);
    expectStopped(result, "mytool", entry(app, "mytool"), noExecuteBit);
  });

  it.concurrent("stops: in a directory below the project root, the link is gone", async () => {
    using root = project([mytool]);
    const app = join(String(root), "app");
    mkdirSync(join(app, "src", "deep"), { recursive: true });
    rmSync(launcher(app, "mytool"));
    const result = await run(String(root), join(app, "src", "deep"), [bunExe(), "x", "mytool"]);
    expectStopped(result, "mytool", entry(app, "mytool"), gone);
  });

  // The dependencies of a workspace member are in the node_modules of the workspace root.
  it.concurrent.skipIf(isWindows)("stops: a workspace member, the hoisted bin has no execute bit", async () => {
    using root = project([mytool], { name: "app", workspaces: ["packages/*"] });
    const app = join(String(root), "app");
    const member = join(app, "packages", "a");
    mkdirSync(member, { recursive: true });
    writeFileSync(join(member, "package.json"), JSON.stringify({ name: "a", dependencies: { mytool: "1.0.0" } }));
    chmodSync(target(app, mytool), 0o644);
    const result = await run(String(root), member, [bunExe(), "x", "mytool"]);
    expectStopped(result, "mytool", entry(app, "mytool"), noExecuteBit);
  });

  // The resolver keeps an empty listing for a directory it cannot read. That listing does not
  // say whether node_modules is there.
  it.concurrent.skipIf(isWindows || isRoot)(
    "stops: the directory that holds node_modules cannot be listed",
    async () => {
      using root = project([]);
      const holder = String(root);
      mkdirSync(join(holder, "node_modules", ".bin"), { recursive: true });
      writeFileSync(join(holder, "node_modules", ".bin", "mytool"), "#!/bin/sh\necho plain\n", { mode: 0o644 });
      chmodSync(holder, 0o311);
      try {
        const result = await run(holder, join(holder, "app"), [bunExe(), "x", "mytool"]);
        expectStopped(result, "mytool", join(holder, "node_modules", ".bin", "mytool"), noExecuteBit);
      } finally {
        chmodSync(holder, 0o755);
      }
    },
  );

  it.concurrent("stops: the bunx cache has the registry's copy", async () => {
    using root = project([mytool]);
    const app = join(String(root), "app");
    const elsewhere = join(String(root), "elsewhere");
    mkdirSync(elsewhere);
    const warm = await run(String(root), elsewhere, [bunExe(), "x", "mytool"]);
    expect({ stdout: warm.stdout, exitCode: warm.exitCode }).toEqual({ stdout: "REGISTRY mytool", exitCode: 0 });

    rmSync(launcher(app, "mytool"));
    const result = await run(String(root), app, [bunExe(), "x", "mytool"]);
    expectStopped(result, "mytool", entry(app, "mytool"), gone);
  });

  it.concurrent("runs the copy in the project", async () => {
    using root = project([mytool]);
    const result = await run(String(root), join(String(root), "app"), [bunExe(), "x", "mytool"]);
    expect({ stdout: result.stdout, asked: result.asked, exitCode: result.exitCode }).toEqual({
      stdout: "LOCAL mytool",
      asked: [],
      exitCode: 0,
    });
  });

  it.concurrent("runs the bin of the package in the project when it is not named like the package", async () => {
    using root = project([compiler]);
    const result = await run(String(root), join(String(root), "app"), [bunExe(), "x", "compiler"]);
    expect({ stdout: result.stdout, asked: result.asked, exitCode: result.exitCode }).toEqual({
      stdout: "LOCAL compiler",
      asked: [],
      exitCode: 0,
    });
  });

  // The registry's mytool has a bin named mytool. The project's mytool names its bin mt.
  it.concurrent("runs the package in the project, not the registry's copy in the bunx cache", async () => {
    using root = project([{ name: "mytool", bin: "mt" }]);
    const elsewhere = join(String(root), "elsewhere");
    mkdirSync(elsewhere);
    const warm = await run(String(root), elsewhere, [bunExe(), "x", "mytool"]);
    expect({ stdout: warm.stdout, exitCode: warm.exitCode }).toEqual({ stdout: "REGISTRY mytool", exitCode: 0 });

    const result = await run(String(root), join(String(root), "app"), [bunExe(), "x", "mytool"]);
    expect({ stdout: result.stdout, asked: result.asked, exitCode: result.exitCode }).toEqual({
      stdout: "LOCAL mytool",
      asked: [],
      exitCode: 0,
    });
  });

  const fromRegistry = { stdout: "REGISTRY mytool", asked: ["mytool", "mytool/-/mytool-9.9.9.tgz"], exitCode: 0 };
  const expectFromRegistry = (result: Result) =>
    expect({ stdout: result.stdout, asked: result.asked, exitCode: result.exitCode }).toEqual(fromRegistry);

  it.concurrent("installs from the registry when nothing is in the project", async () => {
    using root = project([]);
    expectFromRegistry(await run(String(root), join(String(root), "app"), [bunExe(), "x", "mytool"]));
  });

  it.concurrent("installs from the registry when a version is asked for", async () => {
    using root = project([mytool]);
    const app = join(String(root), "app");
    rmSync(launcher(app, "mytool"));
    expectFromRegistry(await run(String(root), app, [bunExe(), "x", "mytool@latest"]));
  });

  // musl: `which` takes the file on PATH (#44513), and bunx runs it.
  it.concurrent.skipIf(isWindows || isMusl)(
    "installs from the registry when only PATH has a file of that name with no execute bit",
    async () => {
      using root = project([]);
      const onPath = join(String(root), "on-path");
      mkdirSync(onPath);
      writeFileSync(join(onPath, "mytool"), "#!/bin/sh\necho plain\n", { mode: 0o644 });
      const result = await run(String(root), join(String(root), "app"), [bunExe(), "x", "mytool"], {
        PATH: `${onPath}${delimiter}${bunEnv.PATH}`,
      });
      expectFromRegistry(result);
    },
  );

  it.concurrent.skipIf(isWindows)(
    "installs from the registry when a .bin link is left and its package is gone",
    async () => {
      using root = project([mytool]);
      const app = join(String(root), "app");
      rmSync(join(app, "node_modules", "mytool"), { recursive: true });
      expectFromRegistry(await run(String(root), app, [bunExe(), "x", "mytool"]));
    },
  );

  // Another user's node_modules in a shared parent directory (/tmp) must not stop every command.
  it.concurrent.skipIf(isWindows || isRoot)(
    "installs from the registry when a node_modules above the project cannot be searched",
    async () => {
      using root = project([]);
      const above = join(String(root), "node_modules");
      mkdirSync(join(above, ".bin"), { recursive: true });
      writeFileSync(join(above, ".bin", "mytool"), "#!/bin/sh\necho plain\n", { mode: 0o644 });
      chmodSync(above, 0o000);
      try {
        expectFromRegistry(await run(String(root), join(String(root), "app"), [bunExe(), "x", "mytool"]));
      } finally {
        chmodSync(above, 0o755);
      }
    },
  );

  // The package of another project above this one is not in this project, as for npx.
  it.concurrent("installs from the registry when only a package root above the project has the package", async () => {
    using root = project([]);
    const outer = String(root);
    writeFileSync(join(outer, "package.json"), JSON.stringify({ name: "outer" }));
    mkdirSync(join(outer, "node_modules", "mytool"), { recursive: true });
    writeFileSync(
      join(outer, "node_modules", "mytool", "package.json"),
      JSON.stringify({ name: "mytool", version: "1.0.0", bin: { mytool: "cli.js" } }),
    );
    expectFromRegistry(await run(outer, join(outer, "app"), [bunExe(), "x", "mytool"]));
  });

  // `bun install` sets BUN_WHICH_IGNORE_CWD for a lifecycle script. It can run the script
  // before it links the bins, so a missing link says nothing there.
  it.concurrent("installs from the registry in a lifecycle script when the link is not there", async () => {
    using root = project([mytool]);
    const app = join(String(root), "app");
    rmSync(launcher(app, "mytool"));
    const result = await run(String(root), app, [bunExe(), "x", "mytool"], {
      BUN_WHICH_IGNORE_CWD: join(String(root), "node-gyp-shim"),
    });
    expectFromRegistry(result);
  });

  // A lifecycle script of a dependency runs in the dependency's directory. With the isolated
  // linker the store above it holds every package of the project, and none of them is the
  // dependency's.
  it.concurrent("installs from the registry in a dependency of the isolated store", async () => {
    using root = project([mytool]);
    const app = join(String(root), "app");
    rmSync(join(app, "node_modules", ".bin"), { recursive: true });
    const store = join(app, "node_modules", ".bun");
    const dep = join(store, "dep@1.0.0", "node_modules", "dep");
    mkdirSync(dep, { recursive: true });
    writeFileSync(join(dep, "package.json"), JSON.stringify({ name: "dep", version: "1.0.0" }));
    mkdirSync(join(store, "node_modules", "mytool"), { recursive: true });
    writeFileSync(
      join(store, "node_modules", "mytool", "package.json"),
      JSON.stringify({ name: "mytool", version: "1.0.0", bin: { mytool: "cli.js" } }),
    );
    expectFromRegistry(await run(String(root), dep, [bunExe(), "x", "mytool"]));
  });
});
