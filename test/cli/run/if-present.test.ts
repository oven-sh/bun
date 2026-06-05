import { spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { chmodSync } from "fs";
import { bunEnv, bunExe, isPosix, tempDirWithFiles } from "harness";
import { join } from "path";

let cwd: string;

beforeAll(() => {
  cwd = tempDirWithFiles("--if-present", {
    "present.js": "console.log('Here!');",
    "package.json": JSON.stringify({
      "name": "present",
      "scripts": {
        "present": "echo 'Here!'",
      },
    }),
  });
});

describe("bun", () => {
  test("should error with missing script", () => {
    const { exitCode, stdout, stderr } = spawnSync({
      cwd,
      cmd: [bunExe(), "notpresent"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toBeEmpty();
    expect(stderr.toString()).toMatch(/Script not found/);
    expect(exitCode).toBe(1);
  });
  test("should error with missing module", () => {
    const { exitCode, stdout, stderr } = spawnSync({
      cwd,
      cmd: [bunExe(), "./notpresent.js"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toBeEmpty();
    expect(stderr.toString()).toMatch(/Module not found/);
    expect(exitCode).toBe(1);
  });
  test("should error with missing file", () => {
    const { exitCode, stdout, stderr } = spawnSync({
      cwd,
      cmd: [bunExe(), "/path/to/notpresent.txt"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toBeEmpty();
    expect(stderr.toString()).toMatch(/Module not found/);
    expect(exitCode).toBe(1);
  });
});

describe("bun --if-present", () => {
  test("should not error with missing script", () => {
    const { exitCode, stdout, stderr } = spawnSync({
      cwd,
      cmd: [bunExe(), "--if-present", "notpresent"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toBeEmpty();
    expect(stderr.toString()).toBeEmpty();
    expect(exitCode).toBe(0);
  });
  test("should not error with missing module", () => {
    const { exitCode, stdout, stderr } = spawnSync({
      cwd,
      cmd: [bunExe(), "--if-present", "./notpresent.js"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toBeEmpty();
    expect(stderr.toString()).toBeEmpty();
    expect(exitCode).toBe(0);
  });
  test("should not error with missing file", () => {
    const { exitCode, stdout, stderr } = spawnSync({
      cwd,
      cmd: [bunExe(), "--if-present", "/path/to/notpresent.txt"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toBeEmpty();
    expect(stderr.toString()).toBeEmpty();
    expect(exitCode).toBe(0);
  });
  test("should run present script", () => {
    const { exitCode, stdout, stderr } = spawnSync({
      cwd,
      cmd: [bunExe(), "run", "present"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toMatch(/Here!/);
    expect(stderr.toString()).not.toBeEmpty();
    expect(exitCode).toBe(0);
  });
  test("should run present module", () => {
    const { exitCode, stdout, stderr } = spawnSync({
      cwd,
      cmd: [bunExe(), "run", "present.js"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toMatch(/Here!/);
    expect(stderr.toString()).toBeEmpty();
    expect(exitCode).toBe(0);
  });
});

// https://github.com/oven-sh/bun/issues/31877
describe("bun run --if-present does not fall back to a same-named binary", () => {
  // `test` is /usr/bin/test on POSIX; with no args it exits 1.
  test.skipIf(!isPosix)("does not run a system $PATH binary", () => {
    const dir = tempDirWithFiles("if-present-path", {
      "package.json": JSON.stringify({ name: "no-scripts" }),
    });
    const { exitCode, stdout, stderr } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--if-present", "test"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toBeEmpty();
    expect(stderr.toString()).toBeEmpty();
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isPosix)("does not run a node_modules/.bin binary", () => {
    const dir = tempDirWithFiles("if-present-bin", {
      "package.json": JSON.stringify({ name: "no-scripts" }),
      "node_modules/.bin/mytool": "#!/bin/sh\necho BIN_RAN\nexit 3\n",
    });
    chmodSync(join(dir, "node_modules", ".bin", "mytool"), 0o755);
    const { exitCode, stdout, stderr } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--if-present", "mytool"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).not.toContain("BIN_RAN");
    expect(stderr.toString()).toBeEmpty();
    expect(exitCode).toBe(0);
  });

  // Control: the fix is scoped to --if-present, so without it the binary runs.
  test.skipIf(!isPosix)("without --if-present, the node_modules/.bin binary still runs", () => {
    const dir = tempDirWithFiles("if-present-bin-control", {
      "package.json": JSON.stringify({ name: "no-scripts" }),
      "node_modules/.bin/mytool": "#!/bin/sh\necho BIN_RAN\nexit 3\n",
    });
    chmodSync(join(dir, "node_modules", ".bin", "mytool"), 0o755);
    const { exitCode, stdout } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "mytool"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toContain("BIN_RAN");
    expect(exitCode).toBe(3);
  });

  test("still runs a present script", () => {
    const dir = tempDirWithFiles("if-present-present", {
      "package.json": JSON.stringify({ name: "has-script", scripts: { test: "echo SCRIPT_RAN" } }),
    });
    const { exitCode, stdout } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--if-present", "test"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toContain("SCRIPT_RAN");
    expect(exitCode).toBe(0);
  });
});
