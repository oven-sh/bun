import { spawn } from "bun";
import { afterAll, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { bunEnv, bunExe, isWindows, readdirSorted, tempDir } from "harness";
import { chmodSync, copyFileSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "os";
import { delimiter, join, resolve } from "path";
import type { TestContext } from "./dummy.registry";
import {
  createTestContext,
  destroyTestContext,
  dummyAfterAll,
  dummyBeforeAll,
  dummyRegistryForContext,
  setContextHandler,
} from "./dummy.registry";

setDefaultTimeout(1000 * 60 * 5);

let x_dir: string;
type BunxTestEnv = Record<string, string | undefined> & {
  TEMP: string;
  BUN_TMPDIR: string;
  TMPDIR: string;
  BUN_INSTALL_CACHE_DIR: string;
};
let env: BunxTestEnv;
const temporaryDirectories = new Set<ReturnType<typeof tempDir>>();

// Each test that hits the network gets its own isolated tmpdir + install cache
// so the network-heavy tests can run concurrently without sharing bunx cache state.
function setup() {
  const install_cache_dir = tempDir("bunx-install-cache", {});
  const current_tmpdir = tempDir("bunx-tmp", {});
  const x_dir = tempDir("bunx-cwd", {});
  temporaryDirectories.add(install_cache_dir);
  temporaryDirectories.add(current_tmpdir);
  temporaryDirectories.add(x_dir);
  return {
    x_dir,
    env: {
      ...bunEnv,
      TEMP: current_tmpdir,
      BUN_TMPDIR: current_tmpdir,
      TMPDIR: current_tmpdir,
      BUN_INSTALL_CACHE_DIR: install_cache_dir,
    } as BunxTestEnv,
  };
}

type PackageInvocationCase = {
  invocation: string;
  useBunx: boolean;
  explicitPackage: boolean;
};
type LinkerCase = { linker: "hoisted" | "isolated" };

const packageInvocationCases: PackageInvocationCase[] = [
  { invocation: "bun x --package", useBunx: false, explicitPackage: true },
  { invocation: "bunx --package", useBunx: true, explicitPackage: true },
  { invocation: "bun x", useBunx: false, explicitPackage: false },
  { invocation: "bunx", useBunx: true, explicitPackage: false },
];
const implicitPackageInvocationCases = packageInvocationCases.filter(({ explicitPackage }) => !explicitPackage);
const linkerCases: LinkerCase[] = [{ linker: "hoisted" }, { linker: "isolated" }];

async function withTestContext(
  opts: { linker?: "hoisted" | "isolated" } | undefined,
  fn: (ctx: TestContext) => Promise<void>,
): Promise<void> {
  const ctx = await createTestContext(opts?.linker ? { linker: opts.linker } : undefined);
  try {
    await fn(ctx);
  } finally {
    destroyTestContext(ctx);
  }
}

function packageInvocationCommand(
  { useBunx, explicitPackage }: PackageInvocationCase,
  packageSpec: string,
  binName: string,
): { cmd: string[]; argv0?: string } {
  const cmd = useBunx ? [bunExe()] : [bunExe(), "x"];
  cmd.push(...(explicitPackage ? ["--package", packageSpec, binName] : [packageSpec]));
  return useBunx ? { cmd, argv0: isWindows ? "bunx.exe" : "bunx" } : { cmd };
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

afterAll(async () => {
  await Promise.all(Array.from(temporaryDirectories, directory => directory[Symbol.asyncDispose]()));
  temporaryDirectories.clear();
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

it.concurrent.each(implicitPackageInvocationCases)(
  "$invocation discovers the bin from an anonymous URL package",
  async invocationCase => {
    const { x_dir, env } = setup();
    const tarball = Bun.gzipSync(
      await new Bun.Archive({
        "package/package.json": JSON.stringify({
          name: "actual-url-package",
          version: "1.0.0",
          bin: { "actual-url-cli": "cli.js" },
        }),
        "package/cli.js": `#!/usr/bin/env bun
console.log("url-package:" + process.argv.slice(2).join(","));
`,
      }).bytes(),
    );
    const requests: string[] = [];
    await using server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push(`${request.method} ${url.pathname}`);
        return new Response(tarball);
      },
    });
    const run = async (packageUrl: string, argument: string, noInstall = false) => {
      const command = packageInvocationCommand(invocationCase, packageUrl);
      if (noInstall) command.cmd.splice(invocationCase.useBunx ? 1 : 2, 0, "--no-install");
      command.cmd.push(argument);
      const subprocess = spawn({
        ...command,
        cwd: x_dir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        subprocess.stdout.text(),
        subprocess.stderr.text(),
        subprocess.exited,
      ]);
      return { stdout, stderr, exitCode };
    };

    const uncachedUrl = new URL("/opaque/not-cached@8", server.url).href;
    const uncached = await run(uncachedUrl, "uncached", true);
    expect(uncached).toEqual({
      stdout: "",
      stderr: `error: Could not find an existing installation for package '${uncachedUrl}'. Stopping because --no-install was passed.\n`,
      exitCode: 1,
    });
    expect(requests).toEqual([]);

    const packageUrl = new URL("/opaque/download@8", server.url).href;
    const cold = await run(packageUrl, "cold");
    expect(cold).toMatchObject({ stdout: "url-package:cold\n", exitCode: 0 });
    expect(cold.stderr).not.toContain("unrecognised dependency format");
    expect(requests).toEqual(["GET /opaque/download@8"]);

    const warm = await run(packageUrl, "warm");
    expect(warm).toMatchObject({ stdout: "url-package:warm\n", exitCode: 0 });
    expect(warm.stderr).not.toContain("unrecognised dependency format");
    expect(requests).toEqual(["GET /opaque/download@8"]);
  },
);

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
  const testEnv = { ...env, npm_config_user_agent: undefined };
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
    env: testEnv,
  });
  expect(await installFinished).toBe(0);

  const subprocess = spawn({
    cmd: [bunExe(), "x", "print-pm"],
    cwd: x_dir,
    stdout: "pipe",
    stderr: "pipe",
    env: testEnv,
  });

  const [err, out, exited] = await Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited]);

  expect(err).not.toContain("error:");
  expect(out.trim()).toContain(`bun/${Bun.version.replace(/-debug$/, "")}`);
  expect(exited).toBe(0);
});

/**
 * IMPORTANT
 * Please only use packages with small unpacked sizes for tests. It helps keep them fast.
 */
describe("bunx --no-install", () => {
  const run = (
    ctx: { x_dir: string; env: BunxTestEnv },
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

describe("package selection", () => {
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
    beforeAll(() => {
      dummyBeforeAll();
    });

    afterAll(() => {
      dummyAfterAll();
    });

    async function installBinCollisionFixture(ctx: TestContext) {
      const urls: string[] = [];
      const fixtureDir = join(import.meta.dir, "registry", "packages", "what-bin");
      setContextHandler(
        ctx,
        dummyRegistryForContext(
          ctx,
          urls,
          {
            "1.0.0": { bin: { "what-bin": "what-bin.js" }, as: "1.0.0" },
            "1.5.0": { bin: { "what-bin": "what-bin.js" }, as: "1.5.0" },
          },
          0,
          fixtureDir,
        ),
      );

      const xDir = ctx.package_dir;
      await mkdir(join(xDir, "no-bin"));
      await writeFile(join(xDir, "no-bin", "package.json"), JSON.stringify({ name: "no-bin", version: "1.0.0" }));
      await mkdir(join(xDir, "unsafe-bin"));
      await writeFile(
        join(xDir, "unsafe-bin", "package.json"),
        JSON.stringify({ name: "unsafe-bin", version: "1.0.0", bin: { "what-bin": "../../outside.js" } }),
      );
      await writeFile(
        join(xDir, "package.json"),
        JSON.stringify({
          name: "bunx-bin-collision",
          private: true,
          devDependencies: {
            "z-old-what-bin": "npm:what-bin@1.0.0",
            "what-bin": "1.5.0",
            "no-bin": "file:./no-bin",
            "unsafe-bin": "file:./unsafe-bin",
          },
        }),
      );

      const install = spawn({
        cmd: [bunExe(), "install"],
        cwd: xDir,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...env, npm_config_registry: ctx.registry_url },
      });
      const [installOut, installErr, installExitCode] = await Promise.all([
        install.stdout.text(),
        install.stderr.text(),
        install.exited,
      ]);
      expect({ installOut, installErr, installExitCode }).toMatchObject({
        installErr: expect.stringContaining("Saved lockfile"),
        installExitCode: 0,
      });

      const sharedBin = Bun.which("what-bin", { PATH: join(xDir, "node_modules", ".bin") });
      expect(sharedBin).not.toBeNull();
      const shared = spawn({
        cmd: [sharedBin!],
        cwd: xDir,
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      const [sharedOut, sharedErr, sharedExitCode] = await Promise.all([
        shared.stdout.text(),
        shared.stderr.text(),
        shared.exited,
      ]);
      expect({ sharedOut, sharedErr, sharedExitCode }).toEqual({
        sharedOut: "",
        sharedErr: "",
        sharedExitCode: 0,
      });
      expect(await Bun.file(join(xDir, "what-bin.txt")).text()).toBe("what-bin@1.5.0");
      await rm(join(xDir, "what-bin.txt"));
    }

    it("should install specified package when binary differs from package name", async () => {
      await withTestContext(undefined, async ctx => {
        const urls: string[] = [];
        setContextHandler(
          ctx,
          dummyRegistryForContext(ctx, urls, {
            "1.0.0": {
              bin: {
                "different-bin": "index.js",
              },
              as: "1.0.0",
            },
          }),
        );

        const subprocess = spawn({
          cmd: [bunExe(), "x", "--package", "my-special-pkg", "different-bin", "--help"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stdin: "inherit",
          stderr: "pipe",
          env: { ...env, npm_config_registry: ctx.registry_url },
        });

        const [err, out, exited] = await Promise.all([
          subprocess.stderr.text(),
          subprocess.stdout.text(),
          subprocess.exited,
        ]);

        expect(urls.some(url => url.includes("/my-special-pkg"))).toBe(true);
        expect(err).toContain("Saved lockfile");
        expect(out).toContain("different-bin from my-special-pkg");
        expect(exited).toBe(0);
      });
    });

    it("should support -p shorthand with mock registry", async () => {
      await withTestContext(undefined, async ctx => {
        const urls: string[] = [];
        setContextHandler(
          ctx,
          dummyRegistryForContext(ctx, urls, {
            "2.0.0": {
              bin: {
                "tool": "cli.js",
              },
              as: "2.0.0",
            },
          }),
        );

        const subprocess = spawn({
          cmd: [bunExe(), "x", "-p", "actual-package", "tool", "--version"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stdin: "inherit",
          stderr: "pipe",
          env: { ...env, npm_config_registry: ctx.registry_url },
        });

        const [err, out, exited] = await Promise.all([
          subprocess.stderr.text(),
          subprocess.stdout.text(),
          subprocess.exited,
        ]);

        expect(urls.some(url => url.includes("/actual-package"))).toBe(true);
        expect(err).not.toContain("error:");
        expect(out).toContain("tool from actual-package");
        expect(exited).toBe(0);
      });
    });

    it("should support --package=<pkg> syntax with mock registry", async () => {
      await withTestContext(undefined, async ctx => {
        const urls: string[] = [];
        setContextHandler(
          ctx,
          dummyRegistryForContext(ctx, urls, {
            "3.0.0": {
              bin: {
                "runner": "run.js",
              },
              as: "3.0.0",
            },
          }),
        );

        const subprocess = spawn({
          cmd: [bunExe(), "x", "--package=runner-pkg", "runner", "--help"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stdin: "inherit",
          stderr: "pipe",
          env: { ...env, npm_config_registry: ctx.registry_url },
        });

        const [err, out, exited] = await Promise.all([
          subprocess.stderr.text(),
          subprocess.stdout.text(),
          subprocess.exited,
        ]);

        expect(urls.some(url => url.includes("/runner-pkg"))).toBe(true);
        expect(err).not.toContain("error:");
        expect(out).toContain("runner from runner-pkg");
        expect(exited).toBe(0);
      });
    });

    it("should fail to run alternate binary without --package flag", async () => {
      await withTestContext(undefined, async ctx => {
        // Attempt to run multi-tool-alt without --package flag
        // This should fail because bunx would try to install a package named "multi-tool-alt"
        const subprocess = spawn({
          cmd: [bunExe(), "x", "multi-tool-alt"],
          cwd: ctx.package_dir,
          stdout: "pipe",
          stdin: "inherit",
          stderr: "pipe",
          env: { ...env, npm_config_registry: ctx.registry_url },
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
    });

    it("should execute the correct binary when package has multiple binaries", async () => {
      await withTestContext(undefined, async ctx => {
        const urls: string[] = [];

        // Create the tarball with both binaries that output different messages
        // First, let's create the package structure
        using packageRoot = tempDir("bunx-multi-tool-package", {});
        const packageDir = join(packageRoot, "package");

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
        chmodSync(join(packageDir, "bin", "multi-tool.js"), 0o755);
        chmodSync(join(packageDir, "bin", "multi-tool-alt.js"), 0o755);

        // Create the tarball with package/ prefix. It goes to a temp dir the
        // registry is pointed at — writing it under import.meta.dir would
        // rewrite a checked-in file on every run.
        using tgzDir = tempDir("bunx-multi-tool-tarball", {});
        await Bun.$`tar -czf ${join(tgzDir, "multi-tool-pkg-1.0.0.tgz")} package`.cwd(packageRoot);

        setContextHandler(
          ctx,
          dummyRegistryForContext(
            ctx,
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
          cwd: ctx.package_dir,
          stdout: "pipe",
          stdin: "inherit",
          stderr: "pipe",
          env: { ...env, npm_config_registry: ctx.registry_url },
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

    describe.each(linkerCases)("with $linker linker", ({ linker }) => {
      it.each(packageInvocationCases)(
        "$invocation uses the named package's bin on naming collision",
        async invocationCase => {
          await withTestContext({ linker }, async ctx => {
            await installBinCollisionFixture(ctx);
            const xDir = ctx.package_dir;

            const selected = spawn({
              ...packageInvocationCommand(invocationCase, "z-old-what-bin", "what-bin"),
              cwd: xDir,
              stdout: "pipe",
              stderr: "pipe",
              env: { ...env, npm_config_registry: ctx.registry_url },
            });
            const [selectedOut, selectedErr, selectedExitCode] = await Promise.all([
              selected.stdout.text(),
              selected.stderr.text(),
              selected.exited,
            ]);
            expect({ selectedOut, selectedErr, selectedExitCode }).toEqual({
              selectedOut: "",
              selectedErr: "",
              selectedExitCode: 0,
            });
            expect(await Bun.file(join(xDir, "what-bin.txt")).text()).toBe("what-bin@1.0.0");
          });
        },
      );

      it("an explicit package never falls back to another package's bin", async () => {
        await withTestContext({ linker }, async ctx => {
          await installBinCollisionFixture(ctx);
          const xDir = ctx.package_dir;

          const missing = spawn({
            cmd: [bunExe(), "x", "--package", "no-bin", "what-bin"],
            cwd: xDir,
            stdout: "pipe",
            stderr: "pipe",
            env: { ...env, npm_config_registry: ctx.registry_url },
          });
          const [missingOut, missingErr, missingExitCode] = await Promise.all([
            missing.stdout.text(),
            missing.stderr.text(),
            missing.exited,
          ]);
          expect({ missingOut, missingErr, missingExitCode }).toEqual({
            missingOut: "",
            missingErr: expect.stringContaining("Package no-bin does not provide a binary named what-bin"),
            missingExitCode: 1,
          });
          expect(await Bun.file(join(xDir, "what-bin.txt")).exists()).toBe(false);

          const unsafe = spawn({
            cmd: [bunExe(), "x", "--package", "unsafe-bin", "what-bin"],
            cwd: xDir,
            stdout: "pipe",
            stderr: "pipe",
            env: { ...env, npm_config_registry: ctx.registry_url },
          });
          const [unsafeOut, unsafeErr, unsafeExitCode] = await Promise.all([
            unsafe.stdout.text(),
            unsafe.stderr.text(),
            unsafe.exited,
          ]);
          expect({ unsafeOut, unsafeErr, unsafeExitCode }).toEqual({
            unsafeOut: "",
            unsafeErr: expect.stringContaining("Package unsafe-bin does not provide a binary named what-bin"),
            unsafeExitCode: 1,
          });
          expect(await Bun.file(join(xDir, "what-bin.txt")).exists()).toBe(false);
        });
      });
    });

    describe("cold-cache install", () => {
      it.each(packageInvocationCases)("$invocation uses the named package's bin", async invocationCase => {
        await withTestContext(undefined, async ctx => {
          const urls: string[] = [];
          const fixtureDir = join(import.meta.dir, "registry", "packages", "what-bin");
          setContextHandler(
            ctx,
            dummyRegistryForContext(
              ctx,
              urls,
              {
                "1.0.0": {
                  bin: { "what-bin": "what-bin.js" },
                  dependencies: { "new-what-bin": "npm:what-bin@1.5.0" },
                },
                "1.5.0": { bin: { "what-bin": "what-bin.js" } },
              },
              0,
              fixtureDir,
            ),
          );

          const xDir = ctx.package_dir;
          const packageSpec = `z-cold-${invocationCase.invocation.replaceAll(" ", "-")}@npm:what-bin@1.0.0`;
          const subprocess = spawn({
            ...packageInvocationCommand(invocationCase, packageSpec, "what-bin"),
            cwd: xDir,
            stdout: "pipe",
            stderr: "pipe",
            env: { ...env, npm_config_registry: ctx.registry_url },
          });
          const [stdout, stderr, exitCode] = await Promise.all([
            subprocess.stdout.text(),
            subprocess.stderr.text(),
            subprocess.exited,
          ]);
          expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
          expect(await Bun.file(join(xDir, "what-bin.txt")).text()).toBe("what-bin@1.0.0");
          await rm(join(xDir, "what-bin.txt"));

          const cacheEntries = (await readdirSorted(env.BUN_TMPDIR)).filter(entry => entry.startsWith("bunx-"));
          // beforeEach gives each case its own BUN_TMPDIR.
          expect(cacheEntries).toHaveLength(1);
          const cacheEntry = cacheEntries[0];
          const sharedBin = Bun.which("what-bin", {
            PATH: join(env.BUN_TMPDIR, cacheEntry, "node_modules", ".bin"),
          });
          expect(sharedBin).not.toBeNull();
          const shared = spawn({
            cmd: [sharedBin!],
            cwd: xDir,
            stdout: "pipe",
            stderr: "pipe",
            env,
          });
          const [sharedOut, sharedErr, sharedExitCode] = await Promise.all([
            shared.stdout.text(),
            shared.stderr.text(),
            shared.exited,
          ]);
          expect({ sharedOut, sharedErr, sharedExitCode }).toEqual({
            sharedOut: "",
            sharedErr: "",
            sharedExitCode: 0,
          });
          expect(await Bun.file(join(xDir, "what-bin.txt")).text()).toBe("what-bin@1.5.0");
        });
      });
    });
  });
});

// Regression: `bunx @scope/name` guesses the bin name as `name` (the
// unscoped portion), then searched the full system $PATH with it. When
// `name` happened to match an unrelated system binary — e.g.
// `bunx @uidotsh/install` matching /usr/bin/install — the system binary
// was executed instead of the package's actual bin.
describe("scoped packages should not match unrelated system binaries", () => {
  beforeAll(() => {
    dummyBeforeAll();
  });

  afterAll(() => {
    dummyAfterAll();
  });

  it("`bunx @scope/install` runs the package's bin, not a system binary named `install`", async () => {
    await withTestContext(undefined, async ctx => {
      // Create a scoped package whose bin name does NOT match the unscoped
      // portion of the package name, mirroring @uidotsh/install whose bin is
      // "uidotsh-installer".
      using pkgRoot = tempDir("bunx-scoped-package", {});
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
      using tgzDir = tempDir("bunx-scoped-tarball", {});
      // The dummy registry serves the tarball by basename of the request URL,
      // which for `@scope/install` + version 1.0.0 is `install-1.0.0.tgz`.
      await Bun.$`tar -czf ${join(tgzDir, "install-1.0.0.tgz")} -C ${pkgRoot} package`;

      // Create a fake "install" binary in $PATH to simulate /usr/bin/install.
      using fakeBinDir = tempDir("bunx-scoped-path", {});
      if (isWindows) {
        await writeFile(join(fakeBinDir, "install.cmd"), `@echo WRONG: ran a system binary from PATH\r\n`);
      } else {
        const fakeBin = join(fakeBinDir, "install");
        await writeFile(fakeBin, `#!/bin/sh\necho "WRONG: ran a system binary from PATH"\n`);
        chmodSync(fakeBin, 0o755);
      }

      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(ctx, urls, { "1.0.0": { bin: { "scoped-tool": "cli.js" }, as: "1.0.0" } }, 0, tgzDir),
      );

      const subprocess = spawn({
        cmd: [bunExe(), "x", "@scope/install"],
        cwd: ctx.package_dir,
        stdout: "pipe",
        stdin: "inherit",
        stderr: "pipe",
        env: {
          ...env,
          npm_config_registry: ctx.registry_url,
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
    using fakeBinDir = tempDir("bunx-scoped-local-path", {});
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
    await withTestContext(undefined, async ctx => {
      // Create a scoped package with a bin name that differs from the
      // unscoped portion AND collides with a system binary we control.
      using pkgRoot = tempDir("bunx-cache-package", {});
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
      using tgzDir = tempDir("bunx-cache-tarball", {});
      await Bun.$`tar -czf ${join(tgzDir, "pkg-1.0.0.tgz")} -C ${pkgRoot} package`;

      // Put a decoy "colliding-tool" (the REAL bin name) in $PATH.
      using fakeBinDir = tempDir("bunx-cache-path", {});
      if (isWindows) {
        await writeFile(join(fakeBinDir, "colliding-tool.cmd"), `@echo WRONG: ran a system binary from PATH\r\n`);
      } else {
        const fakeBin = join(fakeBinDir, "colliding-tool");
        await writeFile(fakeBin, `#!/bin/sh\necho "WRONG: ran a system binary from PATH"\n`);
        chmodSync(fakeBin, 0o755);
      }

      const urls: string[] = [];
      setContextHandler(
        ctx,
        dummyRegistryForContext(
          ctx,
          urls,
          { "1.0.0": { bin: { "colliding-tool": "cli.js" }, as: "1.0.0" } },
          0,
          tgzDir,
        ),
      );

      const runEnv = {
        ...env,
        npm_config_registry: ctx.registry_url,
        PATH: `${fakeBinDir}${delimiter}${env.PATH ?? process.env.PATH ?? ""}`,
      };

      // First run: installs into the bunx cache (no local node_modules).
      {
        const subprocess = spawn({
          cmd: [bunExe(), "x", "@cacheonly/pkg"],
          cwd: ctx.package_dir,
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
          cwd: ctx.package_dir,
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
});

describe("package name aliases", () => {
  beforeAll(() => {
    dummyBeforeAll();
  });

  afterAll(() => {
    dummyAfterAll();
  });

  // `bunx claude` should resolve to `@anthropic-ai/claude-code` (same shape as
  // the `tsc` -> `typescript` rewrite). The npm package named `claude` is an
  // unrelated squatter with no bin, so redirecting is strictly more useful.
  it("`bunx claude` requests @anthropic-ai/claude-code, not the 'claude' squatter", async () => {
    await withTestContext(undefined, async ctx => {
      const urls: string[] = [];
      setContextHandler(ctx, async request => {
        urls.push(request.url);
        return new Response("{}", { status: 404 });
      });

      const subprocess = spawn({
        cmd: [bunExe(), "x", "claude", "--version"],
        cwd: ctx.package_dir,
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
          npm_config_registry: ctx.registry_url,
        },
      });

      const [, , exited] = await Promise.all([subprocess.stderr.text(), subprocess.stdout.text(), subprocess.exited]);

      const paths = urls.map(u => new URL(u).pathname.replace(`/${ctx.id}`, ""));
      // The manifest request must be for the real package, and must never hit
      // the squatter package name.
      expect(paths).toContain("/@anthropic-ai%2fclaude-code");
      expect(paths).not.toContain("/claude");
      // Install fails because the mock registry 404s; that's fine, we only care
      // about which manifest was requested.
      expect(exited).not.toBe(0);
    });
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
