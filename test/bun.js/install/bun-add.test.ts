import { spawn } from "bun";
import {
  afterEach,
  beforeEach,
  expect,
  it,
} from "bun:test";
import { bunExe } from "bunExe";
import { bunEnv as env } from "bunEnv";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { basename, join, relative } from "path";
import { tmpdir } from "os";

let package_dir, add_dir;

beforeEach(async () => {
  add_dir = await mkdtemp(join(tmpdir(), "bun-add.test"));
  package_dir = await mkdtemp(join(tmpdir(), "bun-add.pkg"));
});
afterEach(async () => {
  await rm(add_dir, { force: true, recursive: true });
  await rm(package_dir, { force: true, recursive: true });
});

it("should add existing package", async () => {
  await writeFile(join(add_dir, "package.json"), JSON.stringify({
    name: "foo",
    version: "0.0.1",
  }));
  await writeFile(join(package_dir, "package.json"), JSON.stringify({
    name: "bar",
    version: "0.0.2",
  }));
  const add_path = relative(package_dir, add_dir);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add",`file:${add_path}`],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual([
    "bun add",
    " Saved lockfile",
    "",
  ]);
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+ms\]\s*$/, "").split(/\r?\n/)).toEqual([
    ` + foo@${add_path}`,
    "",
    "",
    "",
    " 1 packages installed",
  ]);
  expect(await exited).toBe(0);
});

it("should reject missing package", async () => {
  await writeFile(join(package_dir, "package.json"), JSON.stringify({
    name: "bar",
    version: "0.0.2",
  }));
  const add_path = relative(package_dir, add_dir);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add",`file:${add_path}`],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual([
    "bun add",
    `error: file:${add_path}@file:${add_path} failed to resolve`,
    "",
  ]);
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out).toBe("");
  expect(await exited).toBe(1);
});

it("should reject invalid path without segfault", async () => {
  await writeFile(join(add_dir, "package.json"), JSON.stringify({
    name: "foo",
    version: "0.0.1",
  }));
  await writeFile(join(package_dir, "package.json"), JSON.stringify({
    name: "bar",
    version: "0.0.2",
  }));
  const add_path = relative(package_dir, add_dir);
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "add",`file://${add_path}`],
    cwd: package_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err.replace(/^(.*?) v[^\n]+/, "$1").split(/\r?\n/)).toEqual([
    "bun add",
    `error: file://${add_path}@file://${add_path} failed to resolve`,
    "",
  ]);
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out).toBe("");
  expect(await exited).toBe(1);
});
