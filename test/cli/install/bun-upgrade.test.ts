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

it("should display error message and suggest command", async () => {
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
