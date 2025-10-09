import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

describe("bun run --filter --parallel", () => {
  test("runs scripts in parallel without respecting dependency order", () => {
    const dir = tempDirWithFiles("parallel-workspace", {
      dep0: {
        "write.js": "await Bun.write('dep0.txt', 'dep0-done'); await Bun.sleep(100);",
        "package.json": JSON.stringify({
          name: "dep0",
          scripts: {
            script: `${bunExe()} run write.js`,
          },
        }),
      },
      dep1: {
        // This depends on dep0, but with --parallel it should run immediately
        // and potentially fail or run without waiting
        "read.js": "await Bun.sleep(50); console.log('dep1-started')",
        "package.json": JSON.stringify({
          name: "dep1",
          dependencies: {
            dep0: "*",
          },
          scripts: {
            script: `${bunExe()} run read.js`,
          },
        }),
      },
    });

    const { exitCode, stdout } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--filter", "*", "--parallel", "script"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain("dep1-started");
  });

  test("runs multiple packages in parallel with --parallel flag", () => {
    const dir = tempDirWithFiles("parallel-workspace", {
      pkg1: {
        "index.js": "console.log('pkg1'); await Bun.sleep(100);",
        "package.json": JSON.stringify({
          name: "pkg1",
          scripts: {
            test: `${bunExe()} run index.js`,
          },
        }),
      },
      pkg2: {
        "index.js": "console.log('pkg2'); await Bun.sleep(100);",
        "package.json": JSON.stringify({
          name: "pkg2",
          scripts: {
            test: `${bunExe()} run index.js`,
          },
        }),
      },
      pkg3: {
        "index.js": "console.log('pkg3'); await Bun.sleep(100);",
        "package.json": JSON.stringify({
          name: "pkg3",
          scripts: {
            test: `${bunExe()} run index.js`,
          },
        }),
      },
    });

    const { exitCode, stdout } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--filter", "*", "--parallel", "test"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    const output = stdout.toString();
    expect(output).toContain("pkg1");
    expect(output).toContain("pkg2");
    expect(output).toContain("pkg3");
  });

  test("--parallel ignores dependency chains", () => {
    const dir = tempDirWithFiles("parallel-workspace", {
      dep0: {
        "index.js": "await Bun.write('dep0.txt', 'done'); console.log('dep0');",
        "package.json": JSON.stringify({
          name: "dep0",
          scripts: {
            script: `${bunExe()} run index.js`,
          },
        }),
      },
      dep1: {
        "index.js": "console.log('dep1');",
        "package.json": JSON.stringify({
          name: "dep1",
          dependencies: {
            dep0: "*",
          },
          scripts: {
            script: `${bunExe()} run index.js`,
          },
        }),
      },
      dep2: {
        "index.js": "console.log('dep2');",
        "package.json": JSON.stringify({
          name: "dep2",
          dependencies: {
            dep1: "*",
          },
          scripts: {
            script: `${bunExe()} run index.js`,
          },
        }),
      },
    });

    const { exitCode, stdout } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--filter", "*", "--parallel", "script"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    const output = stdout.toString();
    expect(output).toContain("dep0");
    expect(output).toContain("dep1");
    expect(output).toContain("dep2");
  });

  test("--parallel with circular dependencies runs all scripts", () => {
    const dir = tempDirWithFiles("parallel-workspace", {
      dep0: {
        "package.json": JSON.stringify({
          name: "dep0",
          scripts: {
            script: "echo dep0",
          },
          dependencies: {
            dep1: "*",
          },
        }),
      },
      dep1: {
        "package.json": JSON.stringify({
          name: "dep1",
          dependencies: {
            dep0: "*",
          },
          scripts: {
            script: "echo dep1",
          },
        }),
      },
    });

    const { exitCode, stdout } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--filter", "*", "--parallel", "script"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    const output = stdout.toString();
    expect(output).toContain("dep0");
    expect(output).toContain("dep1");
  });

  test("--parallel still runs pre and post scripts in order within same package", () => {
    const dir = tempDirWithFiles("parallel-workspace", {
      pkg1: {
        "package.json": JSON.stringify({
          name: "pkg1",
          scripts: {
            prescript: "echo pre",
            script: "echo main",
            postscript: "echo post",
          },
        }),
      },
    });

    const { exitCode, stdout } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--filter", "*", "--parallel", "script"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    const output = stdout.toString();
    // Verify that pre/main/post scripts all ran
    expect(output).toContain("pre");
    expect(output).toContain("main");
    expect(output).toContain("post");
  });

  test("--parallel propagates exit codes correctly", () => {
    const dir = tempDirWithFiles("parallel-workspace", {
      pkg1: {
        "package.json": JSON.stringify({
          name: "pkg1",
          scripts: {
            script: "exit 0",
          },
        }),
      },
      pkg2: {
        "package.json": JSON.stringify({
          name: "pkg2",
          scripts: {
            script: "exit 42",
          },
        }),
      },
    });

    const { exitCode, stdout } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--filter", "*", "--parallel", "script"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = stdout.toString();
    expect(output).toMatch(/code 0/);
    expect(output).toMatch(/code 42/);
    expect(exitCode).toBe(42);
  });

  test("--parallel works with --filter pattern matching", () => {
    const dir = tempDirWithFiles("parallel-workspace", {
      packages: {
        "pkg-a": {
          "package.json": JSON.stringify({
            name: "pkg-a",
            scripts: {
              test: "echo pkg-a",
            },
          }),
        },
        "pkg-b": {
          "package.json": JSON.stringify({
            name: "pkg-b",
            scripts: {
              test: "echo pkg-b",
            },
          }),
        },
        "other": {
          "package.json": JSON.stringify({
            name: "other",
            scripts: {
              test: "echo other",
            },
          }),
        },
      },
      "package.json": JSON.stringify({
        name: "ws",
        workspaces: ["packages/*"],
      }),
    });

    const { exitCode, stdout } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--filter", "pkg-*", "--parallel", "test"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    const output = stdout.toString();
    expect(output).toContain("pkg-a");
    expect(output).toContain("pkg-b");
    expect(output).not.toContain("other");
  });

  test("--parallel works with workspaces", () => {
    const dir = tempDirWithFiles("parallel-workspace", {
      packages: {
        pkg1: {
          "package.json": JSON.stringify({
            name: "pkg1",
            scripts: {
              build: "echo pkg1-build",
            },
          }),
        },
        pkg2: {
          "package.json": JSON.stringify({
            name: "pkg2",
            scripts: {
              build: "echo pkg2-build",
            },
          }),
        },
      },
      "package.json": JSON.stringify({
        name: "ws",
        workspaces: ["packages/*"],
      }),
    });

    const { exitCode, stdout } = spawnSync({
      cwd: dir,
      cmd: [bunExe(), "run", "--filter", "*", "--parallel", "build"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(exitCode).toBe(0);
    const output = stdout.toString();
    expect(output).toContain("pkg1-build");
    expect(output).toContain("pkg2-build");
  });
});
