import { spawn } from "bun";
import { beforeAll, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { rm, writeFile } from "fs/promises";
import { bunEnv, bunExe, isWindows, readdirSorted, tmpdirSync } from "harness";
import { copyFileSync, readdirSync } from "node:fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

let x_dir: string;
let current_tmpdir: string;
let install_cache_dir: string;
let env = { ...bunEnv };

beforeAll(() => {
  setDefaultTimeout(1000 * 60 * 5);
});

beforeEach(async () => {
  const waiting: Promise<void>[] = [];
  if (current_tmpdir) {
    waiting.push(rm(current_tmpdir, { recursive: true, force: true }));
  }

  if (install_cache_dir) {
    waiting.push(rm(install_cache_dir, { recursive: true, force: true }));
  }

  const tmp = isWindows ? tmpdir() : "/tmp";
  readdirSync(tmp).forEach(file => {
    if (file.startsWith("bunx-") || file.startsWith("bun-x.test")) {
      waiting.push(rm(join(tmp, file), { recursive: true, force: true }));
    }
  });

  install_cache_dir = tmpdirSync();
  current_tmpdir = tmpdirSync();
  x_dir = tmpdirSync();

  env.TEMP = current_tmpdir;
  env.BUN_TMPDIR = env.TMPDIR = current_tmpdir;
  env.TMPDIR = current_tmpdir;
  env.BUN_INSTALL_CACHE_DIR = install_cache_dir;

  await Promise.all(waiting);
});

it("should choose the tagged versions instead of the PATH versions when a tag is specified", async () => {
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

it("should install and run default (latest) version", async () => {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "x", "uglify-js", "--compress"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: new TextEncoder().encode("console.log(6 * 7);"),
    stderr: "pipe",
    env,
  });
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  const out = await new Response(stdout).text();
  expect(out.split(/\r?\n/)).toEqual(["console.log(42);", ""]);
  expect(await exited).toBe(0);
});

it("should install and run specified version", async () => {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "x", "uglify-js@3.14.1", "-v"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  const out = await new Response(stdout).text();
  expect(out.split(/\r?\n/)).toEqual(["uglify-js 3.14.1", ""]);
  expect(await exited).toBe(0);
});

it("should output usage if no arguments are passed", async () => {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "x"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(err).toContain("Usage: ");
  const out = await new Response(stdout).text();
  expect(out).toHaveLength(0);
  expect(await exited).toBe(1);
});

it("should work for @scoped packages", async () => {
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

it("should execute from current working directory", async () => {
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
  const [err, out, exitCode] = await Promise.all([new Response(stderr).text(), new Response(stdout).text(), exited]);
  expect(err).not.toContain("error:");
  expect(await readdirSorted(x_dir)).toEqual(["test.js"]);
  expect(out.split(/\r?\n/)).toEqual(["console.log(42);", ""]);
  expect(exitCode).toBe(0);
});

it("should work for github repository", async () => {
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

it("should work for github repository with committish", async () => {
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

it.each(["--version", "-v"])("should print the version using %s and exit", async flag => {
  const subprocess = spawn({
    cmd: [bunExe(), "x", flag],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  let [err, out, exited] = await Promise.all([
    new Response(subprocess.stderr).text(),
    new Response(subprocess.stdout).text(),
    subprocess.exited,
  ]);

  expect(err).not.toContain("error:");
  expect(out.trim()).toContain(Bun.version);
  expect(exited).toBe(0);
});

it("should print the revision and exit", async () => {
  const subprocess = spawn({
    cmd: [bunExe(), "x", "--revision"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  let [err, out, exited] = await Promise.all([
    new Response(subprocess.stderr).text(),
    new Response(subprocess.stdout).text(),
    subprocess.exited,
  ]);

  expect(err).not.toContain("error:");
  expect(out.trim()).toContain(Bun.version);
  expect(out.trim()).toContain(Bun.revision.slice(0, 7));
  expect(exited).toBe(0);
});

it("should pass --version to the package if specified", async () => {
  const subprocess = spawn({
    cmd: [bunExe(), "x", "esbuild", "--version"],
    cwd: x_dir,
    stdout: "pipe",
    stdin: "inherit",
    stderr: "pipe",
    env,
  });

  let [err, out, exited] = await Promise.all([
    new Response(subprocess.stderr).text(),
    new Response(subprocess.stdout).text(),
    subprocess.exited,
  ]);

  expect(err).not.toContain("error:");
  expect(out.trim()).not.toContain(Bun.version);
  expect(exited).toBe(0);
});

it('should set "npm_config_user_agent" to bun', async () => {
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
  });
  expect(await installFinished).toBe(0);

  const subprocess = spawn({
    cmd: [bunExe(), "x", "print-pm"],
    cwd: x_dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [err, out, exited] = await Promise.all([
    new Response(subprocess.stderr).text(),
    new Response(subprocess.stdout).text(),
    subprocess.exited,
  ]);

  expect(err).not.toContain("error:");
  expect(out.trim()).toContain(`bun/${Bun.version}`);
  expect(exited).toBe(0);
});

/**
 * IMPORTANT
 * Please only use packages with small unpacked sizes for tests. It helps keep them fast.
 */
describe("bunx --no-install", () => {
  const run = (...args: string[]): Promise<[stderr: string, stdout: string, exitCode: number]> => {
    const subprocess = spawn({
      cmd: [bunExe(), "x", ...args],
      cwd: x_dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    return Promise.all([
      new Response(subprocess.stderr).text(),
      new Response(subprocess.stdout).text(),
      subprocess.exited,
    ] as const);
  };

  it("if the package is not installed, it should fail and print an error message", async () => {
    const [err, out, exited] = await run("--no-install", "http-server", "--version");

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
  it.each(["typescript", "http-server", "eslint"])("`bunx --no-install %s` should find cached packages", async pkg => {
    // not cached
    {
      const [err, out, code] = await run(pkg, "--version");
      expect(err).not.toContain("error:");
      expect(out).not.toBeEmpty();
      expect(code).toBe(0);
    }

    // cached
    {
      const [err, out, code] = await run("--no-install", pkg, "--version");
      expect(err).not.toContain("error:");
      expect(out).not.toBeEmpty();
      expect(code).toBe(0);
    }
  });

  it("when an exact version match is found, should find cached packages", async () => {
    // not cached
    {
      const [err, out, code] = await run("http-server@14.0.0", "--version");
      expect(err).not.toContain("error:");
      expect(out).not.toBeEmpty();
      expect(code).toBe(0);
    }

    // cached
    {
      const [err, out, code] = await run("--no-install", "http-server@14.0.0", "--version");
      expect(err).not.toContain("error:");
      expect(out).not.toBeEmpty();
      expect(code).toBe(0);
    }
  });
});

it("should handle postinstall scripts correctly with symlinked bunx", async () => {
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

  let [err, out, exited] = await Promise.all([
    new Response(subprocess.stderr).text(),
    new Response(subprocess.stdout).text(),
    subprocess.exited,
  ]);

  expect(err).not.toContain("error:");
  expect(err).not.toContain("Cannot find module 'exec'");
  expect(out.trim()).not.toContain(Bun.version);
  expect(exited).toBe(0);
});
