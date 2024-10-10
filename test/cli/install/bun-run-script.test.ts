import { file, spawn, spawnSync } from "bun";
import { beforeEach, describe, expect, it } from "bun:test";
import { exists, mkdir, rm, writeFile } from "fs/promises";
import { bunEnv, bunExe, bunEnv as env, isWindows, tempDirWithFiles, tmpdirSync } from "harness";
import { join } from "path";
import { readdirSorted } from "./dummy.registry";

let run_dir: string;

beforeEach(async () => {
  run_dir = tmpdirSync();
});

it("can run a script", async () => {
  await writeFile(
    join(run_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      scripts: {
        foo: "echo hello world",
      },
    }),
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "run-script", "foo"],
    cwd: run_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await new Response(stderr).text();
  expect(err).toEqual(`$ echo hello world\n`);
  const out = await new Response(stdout).text();
  expect(out).toEqual("hello world\n");
  expect(await exited).toBe(0);
});

it("cannot run a file", async () => {
  await writeFile(
    join(run_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      scripts: {
        foo: "echo hello world",
      },
    }),
  );
  await writeFile(join(run_dir, "index.js"), `console.log('hello from js');\n`);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "run-script", "index.js"],
    cwd: run_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await new Response(stderr).text();
  expect(err).toEqual(`error: Script not found "index.js"\n`);
  const out = await new Response(stdout).text();
  expect(out).toBeEmpty();
  expect(await exited).toBe(1);
});

it("can run a script when there is a folder matching its name", async () => {
  await writeFile(
    join(run_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      scripts: {
        foo: "echo hello world",
      },
    }),
  );
  await mkdir(join(run_dir, "foo"));
  await writeFile(join(run_dir, "foo", "index.js"), `console.log('hello from js');\n`);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "run-script", "foo"],
    cwd: run_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const err = await new Response(stderr).text();
  expect(err).toEqual(`$ echo hello world\n`);
  const out = await new Response(stdout).text();
  expect(out).toEqual("hello world\n");
  expect(await exited).toBe(0);
});
