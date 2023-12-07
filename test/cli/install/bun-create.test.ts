import { spawn } from "bun";
import { afterEach, beforeEach, expect, it } from "bun:test";
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

it("should create selected template with @ prefix", async () => {
  const { stderr } = spawn({
    cmd: [bunExe(), "create", "@quick-start/some-template"],
    cwd: x_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain(
    `error: package "@quick-start/create-some-template" not found registry.npmjs.org/@quick-start%2fcreate-some-template 404`,
  );
});

it("should create selected template with @ prefix implicit `/create`", async () => {
  const { stderr } = spawn({
    cmd: [bunExe(), "create", "@second-quick-start"],
    cwd: x_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain(
    `error: package "@second-quick-start/create" not found registry.npmjs.org/@second-quick-start%2fcreate 404`,
  );
});

it("should create selected template with @ prefix implicit `/create` with version", async () => {
  const { stderr } = spawn({
    cmd: [bunExe(), "create", "@second-quick-start"],
    cwd: x_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err.split(/\r?\n/)).toContain(
    `error: package "@second-quick-start/create" not found registry.npmjs.org/@second-quick-start%2fcreate 404`,
  );
});

it("should create template from local folder", async () => {
  const bunCreateDir = join(x_dir, "bun-create");
  const testTemplate = "test-template";

  await mkdir(`${bunCreateDir}/${testTemplate}`, { recursive: true });
  const { exited } = spawn({
    cmd: [bunExe(), "create", testTemplate],
    cwd: x_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: { ...env, BUN_CREATE_DIR: bunCreateDir },
  });

  await exited;

  const dirStat = await stat(`${x_dir}/${testTemplate}`);
  expect(dirStat.isDirectory()).toBe(true);
});
