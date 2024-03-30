import { spawn } from "bun";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { bunExe, bunEnv as env, isWindows } from "harness";
import { mkdtemp, realpath, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readdirSorted } from "./dummy.registry";
import { readdirSync } from "js/node/fs/export-star-from";

let x_dir: string;

beforeEach(async () => {
  x_dir = await realpath(await mkdtemp(join(tmpdir(), "bun-x.test")));

  const tmp = isWindows ? tmpdir() : "/tmp";
  const waiting: Promise<void>[] = [];
  readdirSync(tmp).forEach(file => {
    if (file.startsWith("bunx-")) {
      waiting.push(rm(join(tmp, file), { recursive: true, force: true }));
    }
  });
  await Promise.all(waiting);
});

it("should choose the tagged versions instead of the PATH versions when a tag is specified", async () => {
  const processes = Array.from({ length: 3 }, (_, i) => {
    return spawn({
      cmd: [bunExe(), "x", "semver@7.5." + i, "--help"],
      cwd: x_dir,
      stdout: "pipe",
      stdin: "ignore",
      stderr: "inherit",
      env,
    });
  });

  const results = await Promise.all(processes.map(p => p.exited));
  expect(results).toEqual([0, 0, 0]);
  const outputs = (await Promise.all(processes.map(p => new Response(p.stdout).text()))).map(a =>
    a.substring(0, a.indexOf("\n")),
  );
  expect(outputs).toEqual(["SemVer 7.5.0", "SemVer 7.5.1", "SemVer 7.5.2"]);
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
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(err).not.toContain("panic:");
  expect(stdout).toBeDefined();
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
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(err).not.toContain("panic:");
  expect(stdout).toBeDefined();
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

  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(err).not.toContain("panic:");
  expect(err).toContain("Usage: ");
  expect(stdout).toBeDefined();
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
  expect(err).not.toContain("panic:");
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
  expect(err).not.toContain("panic:");

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
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error:");
  expect(err).not.toContain("panic:");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.split(/\r?\n/)).toEqual(["console.log(42);", ""]);
  expect(await exited).toBe(0);
  expect(await readdirSorted(x_dir)).toEqual(["test.js"]);
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
  expect(err).not.toContain("panic:");
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
  expect(err).not.toContain("panic:");
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
  expect(err).not.toContain("panic:");
  expect(out.trim()).toContain("hello bun!");
  expect(exited).toBe(0);

  // cached
  const cached = spawn({
    cmd: [bunExe(), "x", "github:piuccio/cowsay#HEAD", "hello bun!"],
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
  expect(err).not.toContain("panic:");
  expect(out.trim()).toContain("hello bun!");
  expect(exited).toBe(0);
});
