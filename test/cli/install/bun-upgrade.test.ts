import { spawn } from "bun";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { bunExe, bunEnv as env } from "harness";
import { mkdtemp, realpath, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { copyFileSync } from "js/node/fs/export-star-from";

let run_dir: string;
let exe_name: string = "bun-debug" + (process.platform === "win32" ? ".exe" : "");

beforeEach(async () => {
  run_dir = await realpath(
    await mkdtemp(join(tmpdir(), "bun-upgrade.test." + Math.trunc(Math.random() * 9999999).toString(32))),
  );
  copyFileSync(bunExe(), join(run_dir, exe_name));
});
afterEach(async () => {
  await rm(run_dir, { force: true, recursive: true });
});

it("two invalid arguments, should display error message and suggest command", async () => {
  console.log(run_dir, exe_name);
  const { stderr } = spawn({
    cmd: [join(run_dir, exe_name), "upgrade", "bun-types", "--dev"],
    cwd: run_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain("error: This command updates Bun itself, and does not take package names.");
  expect(err.split(/\r?\n/)).toContain("note: Use `bun update bun-types --dev` instead.");
});

it("two invalid arguments flipped, should display error message and suggest command", async () => {
  const { stderr } = spawn({
    cmd: [join(run_dir, exe_name), "upgrade", "--dev", "bun-types"],
    cwd: run_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain("error: This command updates Bun itself, and does not take package names.");
  expect(err.split(/\r?\n/)).toContain("note: Use `bun update --dev bun-types` instead.");
});

it("one invalid argument, should display error message and suggest command", async () => {
  const { stderr } = spawn({
    cmd: [join(run_dir, exe_name), "upgrade", "bun-types"],
    cwd: run_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain("error: This command updates Bun itself, and does not take package names.");
  expect(err.split(/\r?\n/)).toContain("note: Use `bun update bun-types` instead.");
});

it("one valid argument, should succeed", async () => {
  const { stderr } = spawn({
    cmd: [join(run_dir, exe_name), "upgrade", "--help"],
    cwd: run_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  // Should not contain error message
  expect(err.split(/\r?\n/)).not.toContain("error: This command updates bun itself, and does not take package names.");
  expect(err.split(/\r?\n/)).not.toContain("note: Use `bun update --help` instead.");
});

it("two valid argument, should succeed", async () => {
  const { stderr } = spawn({
    cmd: [join(run_dir, exe_name), "upgrade", "--stable", "--profile"],
    cwd: run_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  // Should not contain error message
  expect(err.split(/\r?\n/)).not.toContain("error: This command updates Bun itself, and does not take package names.");
  expect(err.split(/\r?\n/)).not.toContain("note: Use `bun update --stable --profile` instead.");
});

it("zero arguments, should succeed", async () => {
  const { stderr } = spawn({
    cmd: [join(run_dir, exe_name), "upgrade"],
    cwd: run_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  // Should not contain error message
  expect(err.split(/\r?\n/)).not.toContain("error: This command updates Bun itself, and does not take package names.");
});
