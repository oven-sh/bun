import { spawnSync } from "bun";
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

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
