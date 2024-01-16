// @known-failing-on-windows: 1 failing
import { describe, test, expect, beforeAll } from "bun:test";
import { spawnSync } from "bun";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

let cwd_root: string;
let cwd_packages: string;
let cwd_a: string;
let cwd_b: string;

beforeAll(() => {
  var path = require("path");
  cwd_root = tempDirWithFiles("testworkspace", {
    "packages": {
      "a": {
        "package.json": JSON.stringify({
          "name": "a",
          "scripts": {
            "present": "echo 1234",
          },
        }),
      },
      "b": {
        "package.json": JSON.stringify({
          "name": "b",
          "scripts": {
            "present": "echo 4321",
          },
        }),
      },
    },
    "package.json": JSON.stringify({
      "name": "ws",
      "workspaces": ["packages/a", "packages/b"],
    }),
  });
  cwd_packages = path.join(cwd_root, "packages");
  cwd_a = path.join(cwd_packages, "a");
  cwd_b = path.join(cwd_packages, "b");
});

function runInCwdSuccess(cwd: string, pkgname: string | string[], result: RegExp | RegExp[]) {
  let cmd = [bunExe(), "run"]
  if (pkgname instanceof Array) {
    for (let p of pkgname) {
      cmd.push("-F", p)
    }
  } else {
    cmd.push("-F", pkgname)
  }
  cmd.push("present")
  const { exitCode, stdout, stderr } = spawnSync({
    cwd: cwd,
    cmd: cmd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutval = stdout.toString()
  for (let r of result instanceof Array ? result : [result]) {
    expect(stdoutval).toMatch(r);
  }
  // expect(stderr.toString()).toBeEmpty();
  expect(exitCode).toBe(0);
}

function runInCwdFailure(cwd: string, pkgname: string, result: RegExp) {
  const { exitCode, stdout, stderr } = spawnSync({
    cwd: cwd,
    cmd: [bunExe(), "run", "-F", pkgname, "present"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(stdout.toString()).toBeEmpty();
  expect(stderr.toString()).toMatch(result);
  expect(exitCode).toBe(1);
}

describe("bun", () => {
  test("resolve 'a' from root", () => {
    runInCwdSuccess(cwd_root, "a", /1234/);
  });
  test("resolve 'b' from root", () => {
    runInCwdSuccess(cwd_root, "b", /4321/);
  });
  test("resolve 'a' from middle", () => {
    runInCwdSuccess(cwd_packages, "a", /1234/);
  });
  test("resolve 'b' from middle", () => {
    runInCwdSuccess(cwd_packages, "b", /4321/);
  });
  test("resolve 'a' from self", () => {
    runInCwdSuccess(cwd_a, "a", /1234/);
  });
  test("resolve 'b' from self", () => {
    runInCwdSuccess(cwd_b, "b", /4321/);
  });
  test("resolve 'a' from other", () => {
    runInCwdSuccess(cwd_b, "a", /1234/);
  });
  test("resolve 'b' from other", () => {
    runInCwdSuccess(cwd_a, "b", /4321/);
  });
  test("resolve 'a' and 'b' from 'a'", () => {
    runInCwdSuccess(cwd_a, ["a", "b"], [/1234/, /4321/]);
  });
  test("resolve 'a' and 'b' from 'b'", () => {
    runInCwdSuccess(cwd_a, ["a", "b"], [/1234/, /4321/]);
  });

  test("should error with missing workspace", () => {
    runInCwdFailure(cwd_root, "notpresent", /filter/);
  });
});
