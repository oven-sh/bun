// @known-failing-on-windows: 1 failing
import { describe, test, expect, beforeAll } from "bun:test";
import { spawnSync } from "bun";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

let cwd_root = tempDirWithFiles("testworkspace", {
  "packages": {
    "pkga": {
      "package.json": JSON.stringify({
        "name": "pkga",
        "scripts": {
          "present": "echo scripta",
        },
      }),
    },
    "pkgb": {
      "package.json": JSON.stringify({
        "name": "pkgb",
        "scripts": {
          "present": "echo scriptb",
        },
      }),
    },
    "dirname": {
      "package.json": JSON.stringify({
        "name": "pkgc",
        "scripts": {
          "present": "echo scriptc",
        },
      }),
    },
  },
  "package.json": JSON.stringify({
    "name": "ws",
    "scripts": {
      "present": "echo rootscript",
    },
    "workspaces": ["packages/pkga", "packages/pkgb", "packages/dirname"],
  }),
});

let cwd_packages = join(cwd_root, "packages");
let cwd_a = join(cwd_packages, "pkga");
let cwd_b = join(cwd_packages, "pkgb");
let cwd_c = join(cwd_packages, "dirname");

function runInCwdSuccess(
  cwd: string,
  pattern: string | string[],
  target_pattern: RegExp | RegExp[],
  antipattern?: RegExp | RegExp[],
) {
  let cmd = [bunExe(), "run"];
  if (pattern instanceof Array) {
    for (let p of pattern) {
      cmd.push("--filter", p);
    }
  } else {
    cmd.push("--filter", pattern);
  }
  cmd.push("present");
  const { exitCode, stdout, stderr } = spawnSync({
    cwd: cwd,
    cmd: cmd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutval = stdout.toString();
  for (let r of target_pattern instanceof Array ? target_pattern : [target_pattern]) {
    expect(stdoutval).toMatch(r);
  }
  if (antipattern !== undefined) {
    for (let r of antipattern instanceof Array ? antipattern : [antipattern]) {
      expect(stdoutval).not.toMatch(r);
    }
  }
  // expect(stderr.toString()).toBeEmpty();
  expect(exitCode).toBe(0);
}

function runInCwdFailure(cwd: string, pkgname: string, scriptname: string, result: RegExp) {
  const { exitCode, stdout, stderr } = spawnSync({
    cwd: cwd,
    cmd: [bunExe(), "run", "--filter", pkgname, scriptname],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(stdout.toString()).toBeEmpty();
  expect(stderr.toString()).toMatch(result);
  expect(exitCode).toBe(1);
}

describe("bun", () => {
  let dirs = [cwd_root, cwd_packages, cwd_a, cwd_b, cwd_c];
  let packages = [
    {
      name: "pkga",
      output: /scripta/,
    },
    {
      name: "pkgb",
      output: /scriptb/,
    },
    {
      name: "pkgc",
      output: /scriptc/,
    },
  ];

  let names = packages.map(p => p.name);
  for (let d of dirs) {
    for (let { name, output } of packages) {
      test(`resolve ${name} from ${d}`, () => {
        runInCwdSuccess(d, name, output);
      });
    }
  }

  for (let d of dirs) {
    test(`resolve '*' from ${d}`, () => {
      runInCwdSuccess(d, "*", [/scripta/, /scriptb/, /scriptc/, /rootscript/]);
    });
    test(`resolve all from ${d}`, () => {
      runInCwdSuccess(d, names, [/scripta/, /scriptb/, /scriptc/]);
    });
  }

  test("resolve all with glob", () => {
    runInCwdSuccess(cwd_root, "./packages/*", [/scripta/, /scriptb/, /scriptc/]);
  });
  test("resolve all with recursive glob", () => {
    runInCwdSuccess(cwd_root, "./**", [/scripta/, /scriptb/, /scriptc/]);
  });
  test("resolve 'pkga' and 'pkgb' but not 'pkgc' with targeted glob", () => {
    runInCwdSuccess(cwd_root, "./packages/pkg*", [/scripta/, /scriptb/], /scriptc/);
  });

  test("should error with missing script", () => {
    runInCwdFailure(cwd_root, "*", "notpresent", /found/);
  });
});
