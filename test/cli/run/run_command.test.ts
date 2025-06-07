import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, bunRun, isWindows, tempDirWithFiles } from "harness";

let cwd: string;

describe("bun", () => {
  test("should error with missing script", () => {
    const { exitCode, stdout, stderr } = spawnSync({
      cwd,
      cmd: [bunExe(), "run", "dev"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(stdout.toString()).toBeEmpty();
    expect(stderr.toString()).toMatch(/Script not found/);
    expect(exitCode).toBe(1);
  });

  test("should work with valid package.json", () => {
    const dir = tempDirWithFiles("tmp", {
      "package.json": JSON.stringify({
        name: "test",
        scripts: {
          start: "echo VALID_PACKAGE_JSON",
        },
      }),
    });

    const { stdout, stderr } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(stdout.toString()).toInclude("VALID_PACKAGE_JSON");
    expect(stderr.toString()).toBeEmpty();
  });

  test("should show specific error when package.json has a syntax error", () => {
    // `"private": True` should be `"private": true`
    const dir = tempDirWithFiles("tmp", {
      "package.json": `{
        "name": "test",
        "scripts": {
          "start": "echo INVALID_PACKAGE_JSON"
        },
        "private": True
      }`,
    });

    const { stdout, stderr } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(stderr.toString()).toInclude("error:");
    expect(stderr.toString()).toInclude("Unexpected True");
    expect(stdout.toString()).toInclude("Failed parsing package.json");
    expect(stdout.toString()).not.toInclude("No package.json found");
  });

  test("should handle missing package.json correctly", () => {
    const dir = tempDirWithFiles("pkg-json-missing", {
      "index.js": "console.log('Hello World!');",
    });

    const { stdout } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(stdout.toString()).toInclude("No package.json found");
    expect(stdout.toString()).not.toInclude("Failed parsing package.json");
  });
});

test.if(isWindows)("[windows] A file in drive root runs", () => {
  const path = "C:\\root-file" + Math.random().toString().slice(2) + ".js";
  try {
    writeFileSync(path, "console.log(`PASS`);");
    const { stdout } = bunRun("C:\\root-file.js", {});
    expect(stdout).toBe("PASS");
  } catch {
    rmSync(path);
  }
});
