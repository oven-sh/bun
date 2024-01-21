import { spawn, spawnSync } from "bun";
import { afterEach, beforeEach, expect, it, describe } from "bun:test";
import { bunExe, bunEnv as env } from "harness";
import { mkdtemp, realpath, rm, mkdir, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { cpSync } from "js/node/fs/export-star-from";

let run_dir: string;

beforeEach(async () => {
  run_dir = await realpath(
    await mkdtemp(join(tmpdir(), "bun-upgrade.test." + Math.trunc(Math.random() * 9999999).toString(32))),
  );
  cpSync(bunExe(), run_dir);
});
afterEach(async () => {
  await rm(run_dir, { force: true, recursive: true });
});

it("two invalid arguments, should display error message and suggest command", async () => {
  const { stderr, exitCode } = spawn({
    cmd: [bunExe(), "upgrade", "bun-types", "--dev"],
    cwd: run_dir,
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
    cwd: run_dir,
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
    cwd: run_dir,
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
    cwd: run_dir,
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
    cwd: run_dir,
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
