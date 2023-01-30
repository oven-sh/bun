import { spawn } from "bun";
import {
  afterEach,
  beforeEach,
  expect,
  it,
} from "bun:test";
import { bunExe } from "bunExe";
import { bunEnv as env } from "bunEnv";
import { realpathSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

let x_dir;

beforeEach(async () => {
  x_dir = realpathSync(await mkdtemp(join(tmpdir(), "bun-install.test")));
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
  expect(out.split(/\r?\n/)).toEqual([
    "console.log(42);",
    "",
  ]);
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
  expect(out.split(/\r?\n/)).toEqual([
    "uglify-js 3.14.1",
    "",
  ]);
  expect(await exited).toBe(0);
});
