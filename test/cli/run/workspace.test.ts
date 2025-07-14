import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

const cwd_root = tempDirWithFiles("testworkspace", {
  packages: {
    pkga: {
      "index.js": "console.log('pkga');",
      "package.json": JSON.stringify({
        name: "pkga",
        scripts: {
          present: "echo scripta",
          test: "echo testa",
        },
      }),
    },
    pkgb: {
      "index.js": "console.log('pkgb');",
      "package.json": JSON.stringify({
        name: "pkgb",
        scripts: {
          present: "echo scriptb",
          test: "echo testb",
        },
      }),
    },
    pkgc: {
      "index.js": "console.log('pkgc');",
      "package.json": JSON.stringify({
        name: "pkgc",
        scripts: {
          present: "echo scriptc",
          test: "echo testc",
        },
      }),
    },
    scoped: {
      "index.js": "console.log('scoped');",
      "package.json": JSON.stringify({
        name: "@scoped/scoped",
        scripts: {
          present: "echo scriptd",
          test: "echo testd",
        },
      }),
    },
  },
  "package.json": JSON.stringify({
    name: "ws",
    scripts: {
      present: "echo rootscript",
    },
    workspaces: ["packages/pkga", "packages/pkgb", "packages/pkgc", "packages/scoped"],
  }),
});

const cwd_packages = join(cwd_root, "packages");
const cwd_a = join(cwd_packages, "pkga");
const cwd_b = join(cwd_packages, "pkgb");
const cwd_c = join(cwd_packages, "pkgc");
const cwd_d = join(cwd_packages, "scoped");

function runWithWorkspaceSuccess({
  cwd,
  workspace,
  target_pattern,
  antipattern,
  command = ["present"],
  env = {},
}: {
  cwd: string;
  workspace: string | string[];
  target_pattern: RegExp | RegExp[];
  antipattern?: RegExp | RegExp[];
  command?: string[];
  env?: Record<string, string | undefined>;
}) {
  const cmd = [bunExe(), "run"];

  if (Array.isArray(workspace)) {
    for (const w of workspace) {
      cmd.push("--workspace", w);
    }
  } else {
    cmd.push("-w", workspace);
  }

  for (const c of command) {
    cmd.push(c);
  }

  const { exitCode, stdout, stderr } = spawnSync({
    cwd,
    cmd,
    env: { ...bunEnv, ...env },
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
  expect(stderr.toString()).toBeEmpty();
  expect(exitCode).toBe(0);
}

function runWithWorkspaceFailure(cwd: string, workspace: string, scriptname: string, result: RegExp) {
  const { exitCode, stdout, stderr } = spawnSync({
    cwd: cwd,
    cmd: [bunExe(), "run", "--workspace", workspace, scriptname],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(stdout.toString()).toBeEmpty();
  expect(stderr.toString()).toMatch(result);
  expect(exitCode).not.toBe(0);
}

describe("bun run --workspace", () => {
  const dirs = [cwd_root, cwd_packages, cwd_a, cwd_b, cwd_c, cwd_d];
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
    {
      name: "@scoped/scoped",
      output: /scriptd/,
    },
  ];

  const names = packages.map(p => p.name);
  for (const d of dirs) {
    for (const { name, output } of packages) {
      test(`resolve ${name} from ${d}`, () => {
        runWithWorkspaceSuccess({ cwd: d, workspace: name, target_pattern: output });
      });
    }
  }

  for (const d of dirs) {
    test(`resolve all workspaces from ${d}`, () => {
      runWithWorkspaceSuccess({
        cwd: d,
        workspace: names,
        target_pattern: [/scripta/, /scriptb/, /scriptc/, /scriptd/],
      });
    });
  }

  test("workspace ordering follows package.json order", () => {
    // Test that workspaces are executed in the order they appear in package.json
    const { exitCode, stdout, stderr } = spawnSync({
      cwd: cwd_root,
      cmd: [bunExe(), "run", "--workspace", "pkga", "--workspace", "pkgb", "--workspace", "pkgc", "present"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    expect(stderr.toString()).toBeEmpty();
    const output = stdout.toString();

    // Check that the order matches workspace definition order
    const indexA = output.indexOf("scripta");
    const indexB = output.indexOf("scriptb");
    const indexC = output.indexOf("scriptc");

    expect(indexA).toBeLessThan(indexB);
    expect(indexB).toBeLessThan(indexC);
  });

  test("workspace filtering is exact match", () => {
    runWithWorkspaceSuccess({
      cwd: cwd_root,
      workspace: "pkga",
      target_pattern: /scripta/,
      antipattern: [/scriptb/, /scriptc/, /scriptd/],
    });
  });

  test("non-existent workspace fails", () => {
    runWithWorkspaceFailure(cwd_root, "nonexistent", "present", /No packages matched the filter/);
  });

  test("multiple workspaces", () => {
    runWithWorkspaceSuccess({
      cwd: cwd_root,
      workspace: ["pkga", "pkgc"],
      target_pattern: [/scripta/, /scriptc/],
      antipattern: [/scriptb/, /scriptd/],
    });
  });

  test("scoped packages work", () => {
    runWithWorkspaceSuccess({
      cwd: cwd_root,
      workspace: "@scoped/scoped",
      target_pattern: /scriptd/,
      antipattern: [/scripta/, /scriptb/, /scriptc/],
    });
  });

  test("different script names work", () => {
    runWithWorkspaceSuccess({
      cwd: cwd_root,
      workspace: "pkga",
      target_pattern: /testa/,
      command: ["test"],
    });
  });

  test("workspace with missing script fails gracefully", () => {
    runWithWorkspaceFailure(cwd_root, "pkga", "nonexistent", /No packages matched the filter/);
  });

  test("combine --workspace with --filter", () => {
    // Both --workspace and --filter should work together
    const { exitCode, stdout, stderr } = spawnSync({
      cwd: cwd_root,
      cmd: [bunExe(), "run", "--workspace", "pkga", "--filter", "pkgb", "present"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    expect(stderr.toString()).toBeEmpty();
    const output = stdout.toString();

    // Should run both pkga (via --workspace) and pkgb (via --filter)
    expect(output).toMatch(/scripta/);
    expect(output).toMatch(/scriptb/);
  });

  test("short flag -w works", () => {
    runWithWorkspaceSuccess({
      cwd: cwd_root,
      workspace: "pkga",
      target_pattern: /scripta/,
      antipattern: [/scriptb/, /scriptc/, /scriptd/],
    });
  });

  test("multiple -w flags work", () => {
    const { exitCode, stdout, stderr } = spawnSync({
      cwd: cwd_root,
      cmd: [bunExe(), "run", "-w", "pkga", "-w", "pkgb", "present"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    expect(stderr.toString()).toBeEmpty();
    const output = stdout.toString();

    expect(output).toMatch(/scripta/);
    expect(output).toMatch(/scriptb/);
  });
});

describe("workspace ordering test", () => {
  // Test with a different workspace order to ensure it's preserved
  const cwd_reordered = tempDirWithFiles("testworkspace-reordered", {
    packages: {
      pkga: {
        "package.json": JSON.stringify({
          name: "pkga",
          scripts: {
            present: "echo scripta",
          },
        }),
      },
      pkgb: {
        "package.json": JSON.stringify({
          name: "pkgb",
          scripts: {
            present: "echo scriptb",
          },
        }),
      },
      pkgc: {
        "package.json": JSON.stringify({
          name: "pkgc",
          scripts: {
            present: "echo scriptc",
          },
        }),
      },
    },
    "package.json": JSON.stringify({
      name: "ws",
      workspaces: ["packages/pkgc", "packages/pkga", "packages/pkgb"], // Different order
    }),
  });

  test("workspace ordering follows package.json order (reordered)", () => {
    const { exitCode, stdout, stderr } = spawnSync({
      cwd: cwd_reordered,
      cmd: [bunExe(), "run", "--workspace", "pkga", "--workspace", "pkgb", "--workspace", "pkgc", "present"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    expect(stderr.toString()).toBeEmpty();
    const output = stdout.toString();

    // Check that the order matches workspace definition order (c, a, b)
    const indexA = output.indexOf("scripta");
    const indexB = output.indexOf("scriptb");
    const indexC = output.indexOf("scriptc");

    // In this test, the workspace order is pkgc, pkga, pkgb
    // So we should see c before a, and a before b
    expect(indexC).toBeLessThan(indexA);
    expect(indexA).toBeLessThan(indexB);
  });
});
