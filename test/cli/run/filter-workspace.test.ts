// @known-failing-on-windows: 1 failing
import { describe, test, expect, beforeAll } from "bun:test";
import { spawnSync } from "bun";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

const cwd_root = tempDirWithFiles("testworkspace", {
"packages": {
    "pkga": {
      "index.js": "console.log('pkga');",
      "package.json": JSON.stringify({
        "name": "pkga",
        "scripts": {
          "present": "echo scripta",
        },
      }),
    },
    "pkgb": {
      "index.js": "console.log('pkgb');",
      "package.json": JSON.stringify({
        "name": "pkgb",
        "scripts": {
          "present": "echo scriptb",
        },
      }),
    },
    "dirname": {
      "index.js": "console.log('pkgc');",
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

const cwd_packages = join(cwd_root, "packages");
const cwd_a = join(cwd_packages, "pkga");
const cwd_b = join(cwd_packages, "pkgb");
const cwd_c = join(cwd_packages, "dirname");

function runInCwdSuccess(
  cwd: string,
  pattern: string | string[],
  target_pattern: RegExp | RegExp[],
  antipattern?: RegExp | RegExp[],
  command: string[] = ["present"],
) {
  const cmd = [bunExe(), "run"];
  if (Array.isArray(pattern)) {
    for (const p of pattern) {
      cmd.push("--filter", p);
    }
  } else {
    cmd.push("--filter", pattern);
  }
  for (const c of command) {
    cmd.push(c);
  }
  const { exitCode, stdout, stderr } = spawnSync({
    cwd: cwd,
    cmd: cmd,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutval = stdout.toString();
  for (const r of Array.isArray(target_pattern) ? target_pattern : [target_pattern]) {
    expect(stdoutval).toMatch(r);
  }
  if (antipattern !== undefined) {
    for (const r of Array.isArray(antipattern) ? antipattern : [antipattern]) {
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
  const dirs = [cwd_root, cwd_packages, cwd_a, cwd_b, cwd_c];
  const packages = [
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

  const names = packages.map(p => p.name);
  for (const d of dirs) {
    for (const { name, output } of packages) {
      test(`resolve ${name} from ${d}`, () => {
        runInCwdSuccess(d, name, output);
      });
    }
  }

  for (const d of dirs) {
    test(`resolve '*' from ${d}`, () => {
      runInCwdSuccess(d, "*", [/scripta/, /scriptb/, /scriptc/]);
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

  test("resolve and run all js scripts", () => {
    runInCwdSuccess(cwd_root, "*", [/pkga/, /pkgb/, /pkgc/], [], ["index.js"]);
  });

  test("run binaries in package directories", () => {
    runInCwdSuccess(cwd_root, "*", [/pkga/, /pkgb/, /dirname/], [], ["pwd"]);
  });

  test("should error with missing script", () => {
    runInCwdFailure(cwd_root, "*", "notpresent", /found/);
  });
});
