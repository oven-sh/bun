import { spawn } from "bun";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { bunExe, bunEnv as env } from "harness";
import { mkdtemp, realpath, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readdirSorted } from "./dummy.registry";

let x_dir: string;

beforeEach(async () => {
  x_dir = await realpath(await mkdtemp(join(tmpdir(), "bun-x.test")));
});
afterEach(async () => {
  await rm(x_dir, { force: true, recursive: true });
});

it("should install and run default (latest) version", async () => {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "x", "uglify-js", "--compress"],
    cwd: x_dir,
    stdout: null,
    stdin: new TextEncoder().encode("console.log(6 * 7);"),
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.split(/\r?\n/)).toEqual(["console.log(42);", ""]);
  expect(await exited).toBe(0);
});

it("should install and run specified version", async () => {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "x", "uglify-js@3.14.1", "-v"],
    cwd: x_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.split(/\r?\n/)).toEqual(["uglify-js 3.14.1", ""]);
  expect(await exited).toBe(0);
});

it("should output usage if no arguments are passed", async () => {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "x"],
    cwd: x_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toContain("usage: ");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out).toHaveLength(0);
  expect(await exited).toBe(1);
});

it("should work for @scoped packages", async () => {
  await rm(join(await realpath(tmpdir()), "@withfig"), { force: true, recursive: true });
  // without cache
  const withoutCache = spawn({
    cmd: [bunExe(), "x", "@withfig/autocomplete-tools", "--help"],
    cwd: x_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  expect(withoutCache.stderr).toBeDefined();
  let err = await new Response(withoutCache.stderr).text();
  expect(err).not.toContain("error");
  expect(withoutCache.stdout).toBeDefined();
  let out = await new Response(withoutCache.stdout).text();
  expect(out.trim()).toContain("Usage: @withfig/autocomplete-tool");
  expect(await withoutCache.exited).toBe(0);

  // cached
  const cached = spawn({
    cmd: [bunExe(), "x", "@withfig/autocomplete-tools", "--help"],
    cwd: x_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  expect(cached.stderr).toBeDefined();
  err = await new Response(cached.stderr).text();
  expect(err).not.toContain("error");
  expect(cached.stdout).toBeDefined();
  out = await new Response(cached.stdout).text();
  expect(out.trim()).toContain("Usage: @withfig/autocomplete-tool");
  expect(await cached.exited).toBe(0);
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
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.split(/\r?\n/)).toEqual(["console.log(42);", ""]);
  expect(await exited).toBe(0);
  expect(await readdirSorted(x_dir)).toEqual(["test.js"]);
});
