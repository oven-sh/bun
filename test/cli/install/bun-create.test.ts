import { spawn } from "bun";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { bunExe, bunEnv as env } from "harness";
import { mkdtemp, realpath, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

let x_dir: string;

beforeEach(async () => {
  x_dir = await realpath(await mkdtemp(join(tmpdir(), "bun-x.test")));
});
afterEach(async () => {
  await rm(x_dir, { force: true, recursive: true });
});

it("should create selected template with @ prefix", async () => {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "create", "@quick-start/some-template"],
    cwd: x_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain(`error: package "@quick-start/create-some-template" not found registry.npmjs.org/@quick-start%2fcreate-some-template 404`);
});

