import { spawn, spawnSync } from "bun";
import { afterEach, beforeEach, expect, it, describe } from "bun:test";
import { bunExe, bunEnv as env } from "harness";
import { mkdtemp, realpath, rm, mkdir, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

let x_dir: string;

beforeEach(async () => {
  x_dir = await realpath(await mkdtemp(join(tmpdir(), "bun-x.test")));
});
afterEach(async () => {
  await rm(x_dir, { force: true, recursive: true });
});

it("two invalid arguments, should display error message and suggest command", async () => {
  const { stderr, exitCode } = spawn({
    cmd: [bunExe(), "upgrade", "bun-types", "--dev"],
    cwd: x_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain(
    "error: this command updates bun itself, and does not take package names.",
  );
  expect(err.split(/\r?\n/)).toContain(
    "Use `bun update bun-types --dev` instead.",
  );
});

it("two invalid arguments flipped, should display error message and suggest command", async () => {
  const { stderr, exitCode } = spawn({
    cmd: [bunExe(), "upgrade", "--dev", "bun-types"],
    cwd: x_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain(
    "error: this command updates bun itself, and does not take package names.",
  );
  expect(err.split(/\r?\n/)).toContain(
    "Use `bun update --dev bun-types` instead.",
  );
});

it("one invalid argument, should display error message and suggest command", async () => {
  const { stderr, exitCode } = spawn({
    cmd: [bunExe(), "upgrade", "bun-types"],
    cwd: x_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain(
    "error: this command updates bun itself, and does not take package names.",
  );
  expect(err.split(/\r?\n/)).toContain(
    "Use `bun update bun-types` instead.",
  );
});

it("one valid argument, should succeed", async () => {
  const { stderr, exitCode } = spawn({
    cmd: [bunExe(), "upgrade", "--help"],
    cwd: x_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  // Should not contain error message
  expect(err.split(/\r?\n/)).not.toContain(
    "error: this command updates bun itself, and does not take package names.",
  );
  expect(err.split(/\r?\n/)).not.toContain(
    "Use `bun update --help` instead.",
  );
});

it("two valid argument, should succeed", async () => {
  const { stderr, exitCode } = spawn({
    cmd: [bunExe(), "upgrade", "--stable", "--profile"],
    cwd: x_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  // Should not contain error message
  expect(err.split(/\r?\n/)).not.toContain(
    "error: this command updates bun itself, and does not take package names.",
  );
  expect(err.split(/\r?\n/)).not.toContain(
    "Use `bun update --stable --profile` instead.",
  );
});
