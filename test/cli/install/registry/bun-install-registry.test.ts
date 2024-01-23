// @known-failing-on-windows: 1 failing
import { file, spawn } from "bun";
import { bunExe, bunEnv as env } from "harness";
import { join, sep } from "path";
import { mkdtempSync, realpathSync } from "fs";
import { rm, writeFile, mkdir, exists, cp, readdir } from "fs/promises";
import { readdirSorted } from "../dummy.registry";
import { tmpdir } from "os";
import { fork, ChildProcess } from "child_process";
import { beforeAll, afterAll, beforeEach, afterEach, test, expect, describe } from "bun:test";

var verdaccioServer: ChildProcess;
var testCounter: number = 0;
var port: number = 4873;
var packageDir: string;

beforeAll(async () => {
  verdaccioServer = fork(
    await import.meta.resolve("verdaccio/bin/verdaccio"),
    ["-c", join(import.meta.dir, "verdaccio.yaml"), "-l", `${port}`],
    { silent: true, execPath: "bun" },
  );

  await new Promise<void>(done => {
    verdaccioServer.on("message", (msg: { verdaccio_started: boolean }) => {
      if (msg.verdaccio_started) {
        done();
      }
    });
  });
});

afterAll(() => {
  verdaccioServer.kill();
});

beforeEach(async () => {
  packageDir = mkdtempSync(join(realpathSync(tmpdir()), "bun-install-registry-" + testCounter++ + "-"));
  await writeFile(
    join(packageDir, "bunfig.toml"),
    `
[install]
cache = false
registry = "http://localhost:${port}/"
`,
  );
});

afterEach(async () => {
  await rm(packageDir, { force: true, recursive: true });
});

test("basic 1", async () => {
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "basic-1": "1.0.0",
      },
    }),
  );
  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  var err = await new Response(stderr).text();
  expect(stdout).toBeDefined();
  var out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + basic-1@1.0.0",
    "",
    " 1 package installed",
  ]);
  expect(await file(join(packageDir, "node_modules", "basic-1", "package.json")).json()).toEqual({
    name: "basic-1",
    version: "1.0.0",
  } as any);
  expect(await exited).toBe(0);

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = await new Response(stderr).text();
  out = await new Response(stdout).text();
  expect(err).not.toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + basic-1@1.0.0",
    "",
    " 1 package installed",
  ]);
  expect(await exited).toBe(0);
});

test("dependency from root satisfies range from dependency", async () => {
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "one-range-dep": "1.0.0",
        "no-deps": "1.0.0",
      },
    }),
  );

  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  expect(stderr).toBeDefined();
  var err = await new Response(stderr).text();
  expect(stdout).toBeDefined();
  var out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + no-deps@1.0.0",
    " + one-range-dep@1.0.0",
    "",
    " 2 packages installed",
  ]);
  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "1.0.0",
  } as any);
  expect(await exited).toBe(0);

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = await new Response(stderr).text();
  out = await new Response(stdout).text();
  expect(err).not.toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + no-deps@1.0.0",
    " + one-range-dep@1.0.0",
    "",
    " 2 packages installed",
  ]);
  expect(await exited).toBe(0);
});

test("peerDependency in child npm dependency should not maintain old version when package is upgraded", async () => {
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "peer-deps-fixed": "1.0.0",
        "no-deps": "1.0.0",
      },
    }),
  );

  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  expect(stderr).toBeDefined();
  var err = await new Response(stderr).text();
  expect(stdout).toBeDefined();
  var out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + no-deps@1.0.0",
    " + peer-deps-fixed@1.0.0",
    "",
    " 2 packages installed",
  ]);
  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "1.0.0",
  } as any);
  expect(await exited).toBe(0);

  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "peer-deps-fixed": "1.0.0",
        "no-deps": "1.0.1", // upgrade the package
      },
    }),
  );

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = await new Response(stderr).text();
  out = await new Response(stdout).text();
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "1.0.1",
  } as any);
  expect(await exists(join(packageDir, "node_modules", "peer-deps-fixed", "node_modules"))).toBeFalse();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + no-deps@1.0.1",
    "",
    " 1 package installed",
  ]);
  expect(await exited).toBe(0);
});

test("package added after install", async () => {
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "one-range-dep": "1.0.0",
      },
    }),
  );

  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  expect(stderr).toBeDefined();
  var err = await new Response(stderr).text();
  expect(stdout).toBeDefined();
  var out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + one-range-dep@1.0.0",
    "",
    " 2 packages installed",
  ]);
  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "1.1.0",
  } as any);
  expect(await exited).toBe(0);

  // add `no-deps` to root package.json with a smaller but still compatible
  // version for `one-range-dep`.
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "one-range-dep": "1.0.0",
        "no-deps": "1.0.0",
      },
    }),
  );

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  expect(stderr).toBeDefined();
  err = await new Response(stderr).text();
  expect(stdout).toBeDefined();
  out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + no-deps@1.0.0",
    "",
    " 2 packages installed",
  ]);
  expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
    name: "no-deps",
    version: "1.0.0",
  } as any);
  expect(
    await file(join(packageDir, "node_modules", "one-range-dep", "node_modules", "no-deps", "package.json")).json(),
  ).toEqual({
    name: "no-deps",
    version: "1.1.0",
  } as any);
  expect(await exited).toBe(0);

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  expect(stderr).toBeDefined();
  err = await new Response(stderr).text();
  expect(stdout).toBeDefined();
  out = await new Response(stdout).text();
  expect(err).not.toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + no-deps@1.0.0",
    " + one-range-dep@1.0.0",
    "",
    " 3 packages installed",
  ]);
  expect(await exited).toBe(0);
});

test("it should correctly link binaries after deleting node_modules", async () => {
  const json: any = {
    name: "foo",
    version: "1.0.0",
    dependencies: {
      "what-bin": "1.0.0",
      "uses-what-bin": "1.5.0",
    },
  };
  await writeFile(join(packageDir, "package.json"), JSON.stringify(json));

  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  var err = await new Response(stderr).text();
  var out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + uses-what-bin@1.5.0",
    " + what-bin@1.0.0",
    "",
    expect.stringContaining("3 packages installed"),
  ]);
  expect(await exited).toBe(0);

  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  err = await new Response(stderr).text();
  out = await new Response(stdout).text();
  expect(err).not.toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + uses-what-bin@1.5.0",
    " + what-bin@1.0.0",
    "",
    expect.stringContaining("3 packages installed"),
  ]);
  expect(await exited).toBe(0);
});

test("it should re-symlink binaries that become invalid when updating package versions", async () => {
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "bin-change-dir": "1.0.0",
      },
      scripts: {
        postinstall: "bin-change-dir",
      },
    }),
  );

  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  expect(stderr).toBeDefined();
  var err = await new Response(stderr).text();
  expect(stdout).toBeDefined();
  var out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + bin-change-dir@1.0.0",
    "",
    " 1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(await file(join(packageDir, "bin-1.0.0.txt")).text()).toEqual("success!");
  expect(await exists(join(packageDir, "bin-1.0.1.txt"))).toBeFalse();

  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "bin-change-dir": "1.0.1",
      },
      scripts: {
        postinstall: "bin-change-dir",
      },
    }),
  );

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  expect(stderr).toBeDefined();
  err = await new Response(stderr).text();
  expect(stdout).toBeDefined();
  out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + bin-change-dir@1.0.1",
    "",
    " 1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(await file(join(packageDir, "bin-1.0.0.txt")).text()).toEqual("success!");
  expect(await file(join(packageDir, "bin-1.0.1.txt")).text()).toEqual("success!");
});

test("it should install with missing bun.lockb, node_modules, and/or cache", async () => {
  // first clean install
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: {
        "what-bin": "1.0.0",
        "uses-what-bin": "1.5.0",
        "optional-native": "1.0.0",
        "peer-deps-too": "1.0.0",
        "two-range-deps": "1.0.0",
        "one-fixed-dep": "2.0.0",
        "no-deps-bins": "2.0.0",
        "left-pad": "1.0.0",
        "native": "1.0.0",
        "dep-loop-entry": "1.0.0",
        "dep-with-tags": "3.0.0",
        "dev-deps": "1.0.0",
      },
    }),
  );

  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  var err = await new Response(stderr).text();
  var out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + dep-loop-entry@1.0.0",
    " + dep-with-tags@3.0.0",
    " + dev-deps@1.0.0",
    " + left-pad@1.0.0",
    " + native@1.0.0",
    " + no-deps-bins@2.0.0",
    " + one-fixed-dep@2.0.0",
    " + optional-native@1.0.0",
    " + peer-deps-too@1.0.0",
    " + two-range-deps@1.0.0",
    " + uses-what-bin@1.5.0",
    " + what-bin@1.0.0",
    "",
    expect.stringContaining("19 packages installed"),
  ]);
  expect(await exited).toBe(0);

  // delete node_modules
  await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  [err, out] = await Promise.all([new Response(stderr).text(), new Response(stdout).text()]);

  expect(err).not.toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + dep-loop-entry@1.0.0",
    " + dep-with-tags@3.0.0",
    " + dev-deps@1.0.0",
    " + left-pad@1.0.0",
    " + native@1.0.0",
    " + no-deps-bins@2.0.0",
    " + one-fixed-dep@2.0.0",
    " + optional-native@1.0.0",
    " + peer-deps-too@1.0.0",
    " + two-range-deps@1.0.0",
    " + uses-what-bin@1.5.0",
    " + what-bin@1.0.0",
    "",
    expect.stringContaining("19 packages installed"),
  ]);
  expect(await exited).toBe(0);

  for (var i = 0; i < 100; i++) {
    // Situation:
    //
    // Root package has a dependency on one-fixed-dep, peer-deps-too and two-range-deps.
    // Each of these dependencies depends on no-deps.
    //
    // - one-fixed-dep: no-deps@2.0.0
    // - two-range-deps: no-deps@^1.0.0 (will choose 1.1.0)
    // - peer-deps-too: peer no-deps@*
    //
    // We want peer-deps-too to choose the version of no-deps from one-fixed-dep because
    // it's the highest version. It should hoist to the root.

    // delete bun.lockb
    await rm(join(packageDir, "bun.lockb"), { recursive: true, force: true });

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    [err, out] = await Promise.all([new Response(stderr).text(), new Response(stdout).text()]);

    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      expect.stringContaining("Checked 19 installs across 23 packages (no changes)"),
    ]);

    expect(await exited).toBe(0);
  }

  // delete cache
  await rm(join(packageDir, "node_modules", ".cache"), { recursive: true, force: true });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  [err, out] = await Promise.all([new Response(stderr).text(), new Response(stdout).text()]);

  expect(err).not.toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    expect.stringContaining("Checked 19 installs across 23 packages (no changes)"),
  ]);
  expect(await exited).toBe(0);

  // delete bun.lockb and cache
  await rm(join(packageDir, "bun.lockb"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules", ".cache"), { recursive: true, force: true });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  }));

  expect(await exited).toBe(0);

  [err, out] = await Promise.all([new Response(stderr).text(), new Response(stdout).text()]);

  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    expect.stringContaining("Checked 19 installs across 23 packages (no changes)"),
  ]);
}, 30_000);

describe("hoisting", async () => {
  var tests: any = [
    {
      situation: "1.0.0 - 1.0.10 is in order",
      dependencies: {
        "uses-a-dep-1": "1.0.0",
        "uses-a-dep-2": "1.0.0",
        "uses-a-dep-3": "1.0.0",
        "uses-a-dep-4": "1.0.0",
        "uses-a-dep-5": "1.0.0",
        "uses-a-dep-6": "1.0.0",
        "uses-a-dep-7": "1.0.0",
        "uses-a-dep-8": "1.0.0",
        "uses-a-dep-9": "1.0.0",
        "uses-a-dep-10": "1.0.0",
      },
      expected: "1.0.1",
    },
    {
      situation: "1.0.1 in the middle",
      dependencies: {
        "uses-a-dep-2": "1.0.0",
        "uses-a-dep-3": "1.0.0",
        "uses-a-dep-4": "1.0.0",
        "uses-a-dep-5": "1.0.0",
        "uses-a-dep-6": "1.0.0",
        "uses-a-dep-7": "1.0.0",
        "uses-a-dep-1": "1.0.0",
        "uses-a-dep-8": "1.0.0",
        "uses-a-dep-9": "1.0.0",
        "uses-a-dep-10": "1.0.0",
      },
      expected: "1.0.1",
    },
    {
      situation: "1.0.1 is missing",
      dependencies: {
        "uses-a-dep-2": "1.0.0",
        "uses-a-dep-3": "1.0.0",
        "uses-a-dep-4": "1.0.0",
        "uses-a-dep-5": "1.0.0",
        "uses-a-dep-6": "1.0.0",
        "uses-a-dep-7": "1.0.0",
        "uses-a-dep-8": "1.0.0",
        "uses-a-dep-9": "1.0.0",
        "uses-a-dep-10": "1.0.0",
      },
      expected: "1.0.10",
    },
    {
      situation: "1.0.10 and 1.0.1 are missing",
      dependencies: {
        "uses-a-dep-2": "1.0.0",
        "uses-a-dep-3": "1.0.0",
        "uses-a-dep-4": "1.0.0",
        "uses-a-dep-5": "1.0.0",
        "uses-a-dep-6": "1.0.0",
        "uses-a-dep-7": "1.0.0",
        "uses-a-dep-8": "1.0.0",
        "uses-a-dep-9": "1.0.0",
      },
      expected: "1.0.2",
    },
    {
      situation: "1.0.10 is missing and 1.0.1 is last",
      dependencies: {
        "uses-a-dep-2": "1.0.0",
        "uses-a-dep-3": "1.0.0",
        "uses-a-dep-4": "1.0.0",
        "uses-a-dep-5": "1.0.0",
        "uses-a-dep-6": "1.0.0",
        "uses-a-dep-7": "1.0.0",
        "uses-a-dep-8": "1.0.0",
        "uses-a-dep-9": "1.0.0",
        "uses-a-dep-1": "1.0.0",
      },
      expected: "1.0.1",
    },
  ];

  for (const { dependencies, expected, situation } of tests) {
    test(`it should hoist ${expected} when ${situation}`, async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          dependencies,
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      var err = await new Response(stderr).text();
      var out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      for (const dep of Object.keys(dependencies)) {
        expect(out).toContain(` + ${dep}@${dependencies[dep]}`);
      }
      expect(await exited).toBe(0);
      expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).text()).toContain(expected);

      await rm(join(packageDir, "bun.lockb"));

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out).not.toContain("package installed");
      expect(out).toContain(`Checked ${Object.keys(dependencies).length * 2} installs across`);
      expect(await exited).toBe(0);
    });
  }

  describe("peers", async () => {
    var peerTests: any = [
      {
        situation: "peer 1.0.2",
        dependencies: {
          "uses-a-dep-1": "1.0.0",
          "uses-a-dep-2": "1.0.0",
          "uses-a-dep-3": "1.0.0",
          "uses-a-dep-4": "1.0.0",
          "uses-a-dep-5": "1.0.0",
          "uses-a-dep-6": "1.0.0",
          "uses-a-dep-7": "1.0.0",
          "uses-a-dep-8": "1.0.0",
          "uses-a-dep-9": "1.0.0",
          "uses-a-dep-10": "1.0.0",
          "peer-a-dep-1-0-2": "1.0.0",
        },
        expected: "1.0.2",
      },
      {
        situation: "peer >= 1.0.2",
        dependencies: {
          "uses-a-dep-1": "1.0.0",
          "uses-a-dep-2": "1.0.0",
          "uses-a-dep-3": "1.0.0",
          "uses-a-dep-4": "1.0.0",
          "uses-a-dep-5": "1.0.0",
          "uses-a-dep-6": "1.0.0",
          "uses-a-dep-7": "1.0.0",
          "uses-a-dep-8": "1.0.0",
          "uses-a-dep-9": "1.0.0",
          "uses-a-dep-10": "1.0.0",
          "peer-a-dep-gte-1-0-2": "1.0.0",
        },
        expected: "1.0.10",
      },
      {
        situation: "peer ^1.0.2",
        dependencies: {
          "uses-a-dep-1": "1.0.0",
          "uses-a-dep-2": "1.0.0",
          "uses-a-dep-3": "1.0.0",
          "uses-a-dep-4": "1.0.0",
          "uses-a-dep-5": "1.0.0",
          "uses-a-dep-6": "1.0.0",
          "uses-a-dep-7": "1.0.0",
          "uses-a-dep-8": "1.0.0",
          "uses-a-dep-9": "1.0.0",
          "uses-a-dep-10": "1.0.0",
          "peer-a-dep-caret-1-0-2": "1.0.0",
        },
        expected: "1.0.10",
      },
      {
        situation: "peer ~1.0.2",
        dependencies: {
          "uses-a-dep-1": "1.0.0",
          "uses-a-dep-2": "1.0.0",
          "uses-a-dep-3": "1.0.0",
          "uses-a-dep-4": "1.0.0",
          "uses-a-dep-5": "1.0.0",
          "uses-a-dep-6": "1.0.0",
          "uses-a-dep-7": "1.0.0",
          "uses-a-dep-8": "1.0.0",
          "uses-a-dep-9": "1.0.0",
          "uses-a-dep-10": "1.0.0",
          "peer-a-dep-tilde-1-0-2": "1.0.0",
        },
        expected: "1.0.10",
      },
      {
        situation: "peer *",
        dependencies: {
          "uses-a-dep-1": "1.0.0",
          "uses-a-dep-2": "1.0.0",
          "uses-a-dep-3": "1.0.0",
          "uses-a-dep-4": "1.0.0",
          "uses-a-dep-5": "1.0.0",
          "uses-a-dep-6": "1.0.0",
          "uses-a-dep-7": "1.0.0",
          "uses-a-dep-8": "1.0.0",
          "uses-a-dep-9": "1.0.0",
          "uses-a-dep-10": "1.0.0",
          "peer-a-dep-star": "1.0.0",
        },
        expected: "1.0.1",
      },
      {
        situation: "peer * and peer 1.0.2",
        dependencies: {
          "uses-a-dep-1": "1.0.0",
          "uses-a-dep-2": "1.0.0",
          "uses-a-dep-3": "1.0.0",
          "uses-a-dep-4": "1.0.0",
          "uses-a-dep-5": "1.0.0",
          "uses-a-dep-6": "1.0.0",
          "uses-a-dep-7": "1.0.0",
          "uses-a-dep-8": "1.0.0",
          "uses-a-dep-9": "1.0.0",
          "uses-a-dep-10": "1.0.0",
          "peer-a-dep-1-0-2": "1.0.0",
          "peer-a-dep-star": "1.0.0",
        },
        expected: "1.0.2",
      },
    ];
    for (const { dependencies, expected, situation } of peerTests) {
      test(`it should hoist ${expected} when ${situation}`, async () => {
        await writeFile(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
            dependencies,
          }),
        );

        var { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        });

        var err = await new Response(stderr).text();
        var out = await new Response(stdout).text();
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        for (const dep of Object.keys(dependencies)) {
          expect(out).toContain(` + ${dep}@${dependencies[dep]}`);
        }
        expect(await exited).toBe(0);
        expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).text()).toContain(expected);

        await rm(join(packageDir, "bun.lockb"));

        ({ stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        }));

        err = await new Response(stderr).text();
        out = await new Response(stdout).text();
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        if (out.includes("installed")) {
          console.log("stdout:", out);
        }
        expect(out).not.toContain("package installed");
        expect(await exited).toBe(0);
        expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).text()).toContain(expected);

        await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

        ({ stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        }));

        err = await new Response(stderr).text();
        out = await new Response(stdout).text();
        expect(err).not.toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(out).not.toContain("package installed");
        expect(await exited).toBe(0);
        expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).text()).toContain(expected);
      });
    }
  });

  test("hoisting/using incorrect peer dep after install", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          "peer-deps-fixed": "1.0.0",
          "no-deps": "1.0.0",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("incorrect peer dependency");

    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + no-deps@1.0.0",
      " + peer-deps-fixed@1.0.0",
      "",
      " 2 packages installed",
    ]);

    expect(await exited).toBe(0);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    } as any);
    expect(await file(join(packageDir, "node_modules", "peer-deps-fixed", "package.json")).json()).toEqual({
      name: "peer-deps-fixed",
      version: "1.0.0",
      peerDependencies: {
        "no-deps": "^1.0.0",
      },
    } as any);
    expect(await exists(join(packageDir, "node_modules", "peer-deps-fixed", "node_modules"))).toBeFalse();

    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          "peer-deps-fixed": "1.0.0",
          "no-deps": "2.0.0",
        },
      }),
    );

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");

    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + no-deps@2.0.0",
      "",
      " 1 package installed",
    ]);

    expect(await exited).toBe(0);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "2.0.0",
    } as any);
    expect(await file(join(packageDir, "node_modules", "peer-deps-fixed", "package.json")).json()).toEqual({
      name: "peer-deps-fixed",
      version: "1.0.0",
      peerDependencies: {
        "no-deps": "^1.0.0",
      },
    } as any);
    expect(await exists(join(packageDir, "node_modules", "peer-deps-fixed", "node_modules"))).toBeFalse();
  });

  test("hoisting/using incorrect peer dep on initial install", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          "peer-deps-fixed": "1.0.0",
          "no-deps": "2.0.0",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(err).toContain("incorrect peer dependency");

    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + no-deps@2.0.0",
      " + peer-deps-fixed@1.0.0",
      "",
      " 2 packages installed",
    ]);

    expect(await exited).toBe(0);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "2.0.0",
    } as any);
    expect(await file(join(packageDir, "node_modules", "peer-deps-fixed", "package.json")).json()).toEqual({
      name: "peer-deps-fixed",
      version: "1.0.0",
      peerDependencies: {
        "no-deps": "^1.0.0",
      },
    } as any);
    expect(await exists(join(packageDir, "node_modules", "peer-deps-fixed", "node_modules"))).toBeFalse();

    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        dependencies: {
          "peer-deps-fixed": "1.0.0",
          "no-deps": "1.0.0",
        },
      }),
    );

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");

    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + no-deps@1.0.0",
      "",
      " 1 package installed",
    ]);

    expect(await exited).toBe(0);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    } as any);
    expect(await file(join(packageDir, "node_modules", "peer-deps-fixed", "package.json")).json()).toEqual({
      name: "peer-deps-fixed",
      version: "1.0.0",
      peerDependencies: {
        "no-deps": "^1.0.0",
      },
    } as any);
    expect(await exists(join(packageDir, "node_modules", "peer-deps-fixed", "node_modules"))).toBeFalse();
  });
});

describe("workspaces", async () => {
  test("it should detect duplicate workspace dependencies", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        workspaces: ["packages/*"],
      }),
    );

    await mkdir(join(packageDir, "packages", "pkg1"), { recursive: true });
    await writeFile(join(packageDir, "packages", "pkg1", "package.json"), JSON.stringify({ name: "pkg1" }));
    await mkdir(join(packageDir, "packages", "pkg2"), { recursive: true });
    await writeFile(join(packageDir, "packages", "pkg2", "package.json"), JSON.stringify({ name: "pkg1" }));

    var { stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    expect(err).toContain('Workspace name "pkg1" already exists');
    expect(await exited).toBe(1);

    await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
    await rm(join(packageDir, "bun.lockb"), { force: true });

    ({ stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: join(packageDir, "packages", "pkg1"),
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    expect(err).toContain('Workspace name "pkg1" already exists');
    expect(await exited).toBe(1);
  });
  const versions = ["workspace:1.0.0", "workspace:*", "workspace:^1.0.0", "1.0.0", "*"];

  for (const rootVersion of versions) {
    for (const packageVersion of versions) {
      test(`it should allow duplicates, root@${rootVersion}, package@${packageVersion}`, async () => {
        await writeFile(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
            version: "1.0.0",
            workspaces: ["packages/*"],
            dependencies: {
              pkg2: rootVersion,
            },
          }),
        );

        await mkdir(join(packageDir, "packages", "pkg1"), { recursive: true });
        await writeFile(
          join(packageDir, "packages", "pkg1", "package.json"),
          JSON.stringify({
            name: "pkg1",
            version: "1.0.0",
            dependencies: {
              pkg2: packageVersion,
            },
          }),
        );

        await mkdir(join(packageDir, "packages", "pkg2"), { recursive: true });
        await writeFile(
          join(packageDir, "packages", "pkg2", "package.json"),
          JSON.stringify({ name: "pkg2", version: "1.0.0" }),
        );

        var { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        });

        var err = await new Response(stderr).text();
        var out = await new Response(stdout).text();
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          "",
          ` + pkg1@workspace:packages${sep}pkg1`,
          ` + pkg2@workspace:packages${sep}pkg2`,
          "",
          " 2 packages installed",
        ]);
        expect(await exited).toBe(0);

        ({ stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: join(packageDir, "packages", "pkg1"),
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        }));

        err = await new Response(stderr).text();
        out = await new Response(stdout).text();
        expect(err).not.toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          "",
          ` + pkg1@workspace:packages${sep}pkg1`,
          ` + pkg2@workspace:packages${sep}pkg2`,
          "",
          " 2 packages installed",
        ]);
        expect(await exited).toBe(0);

        await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
        await rm(join(packageDir, "bun.lockb"), { recursive: true, force: true });

        ({ stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: join(packageDir, "packages", "pkg1"),
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        }));

        err = await new Response(stderr).text();
        out = await new Response(stdout).text();
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          "",
          ` + pkg1@workspace:packages${sep}pkg1`,
          ` + pkg2@workspace:packages${sep}pkg2`,
          "",
          " 2 packages installed",
        ]);
        expect(await exited).toBe(0);

        ({ stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env,
        }));

        err = await new Response(stderr).text();
        out = await new Response(stdout).text();
        expect(err).not.toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          "",
          ` + pkg1@workspace:packages${sep}pkg1`,
          ` + pkg2@workspace:packages${sep}pkg2`,
          "",
          " 2 packages installed",
        ]);
        expect(await exited).toBe(0);
      });
    }
  }
  for (const version of versions) {
    test(`it should allow listing workspace as dependency of the root package version ${version}`, async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          workspaces: ["packages/*"],
          dependencies: {
            "workspace-1": version,
          },
        }),
      );

      await mkdir(join(packageDir, "packages", "workspace-1"), { recursive: true });
      await writeFile(
        join(packageDir, "packages", "workspace-1", "package.json"),
        JSON.stringify({
          name: "workspace-1",
          version: "1.0.0",
        }),
      );
      // install first from the root, the the workspace package
      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      var err = await new Response(stderr).text();
      var out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("already exists");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("Duplicate dependency");
      expect(err).not.toContain('workspace dependency "workspace-1" not found');
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        ` + workspace-1@workspace:packages${sep}workspace-1`,
        "",
        " 1 package installed",
      ]);
      expect(await exited).toBe(0);

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: join(packageDir, "packages", "workspace-1"),
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("already exists");
      expect(err).not.toContain("Duplicate dependency");
      expect(err).not.toContain('workspace dependency "workspace-1" not found');
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        ` + workspace-1@workspace:packages${sep}workspace-1`,
        "",
        " 1 package installed",
      ]);
      expect(await exited).toBe(0);

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lockb"), { recursive: true, force: true });

      // install from workspace package then from root
      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: join(packageDir, "packages", "workspace-1"),
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("already exists");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("Duplicate dependency");
      expect(err).not.toContain('workspace dependency "workspace-1" not found');
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        ` + workspace-1@workspace:packages${sep}workspace-1`,
        "",
        " 1 package installed",
      ]);
      expect(await exited).toBe(0);

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("already exists");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("Duplicate dependency");
      expect(err).not.toContain('workspace dependency "workspace-1" not found');
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        ` + workspace-1@workspace:packages${sep}workspace-1`,
        "",
        " 1 package installed",
      ]);
      expect(await exited).toBe(0);
    });
  }
});

test("it should re-populate .bin folder if package is reinstalled", async () => {
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "foo",
      dependencies: {
        "what-bin": "1.5.0",
      },
    }),
  );

  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stderr: "pipe",
    stdout: "pipe",
    stdin: "pipe",
    env,
  });

  var err = await new Response(stderr).text();
  var out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + what-bin@1.5.0",
    "",
    " 1 package installed",
  ]);
  expect(await exited).toBe(0);
  expect(Bun.which("what-bin", { PATH: join(packageDir, "node_modules", ".bin") })).toBe(
    join(packageDir, "node_modules", ".bin", "what-bin"),
  );
  expect(await file(join(packageDir, "node_modules", ".bin", "what-bin")).text()).toContain("what-bin@1.5.0");

  await rm(join(packageDir, "node_modules", ".bin"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules", "what-bin", "package.json"), { recursive: true, force: true });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stderr: "pipe",
    stdout: "pipe",
    stdin: "pipe",
    env,
  }));

  err = await new Response(stderr).text();
  out = await new Response(stdout).text();
  expect(err).not.toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + what-bin@1.5.0",
    "",
    expect.stringContaining("1 package installed"),
  ]);
  expect(await exited).toBe(0);
  expect(Bun.which("what-bin", { PATH: join(packageDir, "node_modules", ".bin") })).toBe(
    join(packageDir, "node_modules", ".bin", "what-bin"),
  );
  expect(await file(join(packageDir, "node_modules", ".bin", "what-bin")).text()).toContain("what-bin@1.5.0");
});

test("missing package on reinstall, some with binaries", async () => {
  await writeFile(
    join(packageDir, "package.json"),
    JSON.stringify({
      name: "fooooo",
      dependencies: {
        "what-bin": "1.0.0",
        "uses-what-bin": "1.5.0",
        "optional-native": "1.0.0",
        "peer-deps-too": "1.0.0",
        "two-range-deps": "1.0.0",
        "one-fixed-dep": "2.0.0",
        "no-deps-bins": "2.0.0",
        "left-pad": "1.0.0",
        "native": "1.0.0",
        "dep-loop-entry": "1.0.0",
        "dep-with-tags": "3.0.0",
        "dev-deps": "1.0.0",
      },
    }),
  );

  var { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stderr: "pipe",
    stdout: "pipe",
    stdin: "pipe",
    env,
  });

  var err = await new Response(stderr).text();
  var out = await new Response(stdout).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + dep-loop-entry@1.0.0",
    " + dep-with-tags@3.0.0",
    " + dev-deps@1.0.0",
    " + left-pad@1.0.0",
    " + native@1.0.0",
    " + no-deps-bins@2.0.0",
    " + one-fixed-dep@2.0.0",
    " + optional-native@1.0.0",
    " + peer-deps-too@1.0.0",
    " + two-range-deps@1.0.0",
    " + uses-what-bin@1.5.0",
    " + what-bin@1.0.0",
    "",
    expect.stringContaining("19 packages installed"),
  ]);
  expect(await exited).toBe(0);

  await rm(join(packageDir, "node_modules", "native"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules", "left-pad"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules", "dep-loop-entry"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules", "one-fixed-dep"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules", "peer-deps-too"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules", "two-range-deps", "node_modules", "no-deps"), {
    recursive: true,
    force: true,
  });
  await rm(join(packageDir, "node_modules", "one-fixed-dep"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules", "uses-what-bin", "node_modules", ".bin"), { recursive: true, force: true });
  await rm(join(packageDir, "node_modules", "uses-what-bin", "node_modules", "what-bin"), {
    recursive: true,
    force: true,
  });

  ({ stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: packageDir,
    stderr: "pipe",
    stdout: "pipe",
    stdin: "pipe",
    env,
  }));

  err = await new Response(stderr).text();
  out = await new Response(stdout).text();
  expect(err).not.toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + dep-loop-entry@1.0.0",
    " + left-pad@1.0.0",
    " + native@1.0.0",
    " + one-fixed-dep@2.0.0",
    " + peer-deps-too@1.0.0",
    "",
    expect.stringContaining("7 packages installed"),
  ]);
  expect(await exited).toBe(0);

  expect(await exists(join(packageDir, "node_modules", "native", "package.json"))).toBe(true);
  expect(await exists(join(packageDir, "node_modules", "left-pad", "package.json"))).toBe(true);
  expect(await exists(join(packageDir, "node_modules", "dep-loop-entry", "package.json"))).toBe(true);
  expect(await exists(join(packageDir, "node_modules", "one-fixed-dep", "package.json"))).toBe(true);
  expect(await exists(join(packageDir, "node_modules", "peer-deps-too", "package.json"))).toBe(true);
  expect(await exists(join(packageDir, "node_modules", "two-range-deps", "node_modules", "no-deps"))).toBe(true);
  expect(await exists(join(packageDir, "node_modules", "one-fixed-dep", "package.json"))).toBe(true);
  expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "node_modules", ".bin"))).toBe(true);
  expect(await exists(join(packageDir, "node_modules", "uses-what-bin", "node_modules", "what-bin"))).toBe(true);
  expect(Bun.which("what-bin", { PATH: join(packageDir, "node_modules", ".bin") })).toBe(
    join(packageDir, "node_modules", ".bin", "what-bin"),
  );
  expect(
    Bun.which("what-bin", { PATH: join(packageDir, "node_modules", "uses-what-bin", "node_modules", ".bin") }),
  ).toBe(join(packageDir, "node_modules", "uses-what-bin", "node_modules", ".bin", "what-bin"));
});

for (const forceWaiterThread of [false, true]) {
  const testEnv = forceWaiterThread ? { ...env, BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1" } : env;
  describe("lifecycle scripts" + (forceWaiterThread ? " (waiter thread)" : ""), async () => {
    test("root package with all lifecycle scripts", async () => {
      const writeScript = async (name: string) => {
        const contents = `
      import { writeFileSync, existsSync, rmSync } from "fs";
      import { join } from "path";

      const file = join(import.meta.dir, "${name}.txt");

      if (existsSync(file)) {
        rmSync(file);
        writeFileSync(file, "${name} exists!");
      } else {
        writeFileSync(file, "${name}!");
      }
      `;
        await writeFile(join(packageDir, `${name}.js`), contents);
      };

      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            preinstall: `${bunExe()} preinstall.js`,
            install: `${bunExe()} install.js`,
            postinstall: `${bunExe()} postinstall.js`,
            preprepare: `${bunExe()} preprepare.js`,
            prepare: `${bunExe()} prepare.js`,
            postprepare: `${bunExe()} postprepare.js`,
          },
        }),
      );

      await writeScript("preinstall");
      await writeScript("install");
      await writeScript("postinstall");
      await writeScript("preprepare");
      await writeScript("prepare");
      await writeScript("postprepare");

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });
      expect(await exited).toBe(0);
      expect(stderr).toBeDefined();
      var err = await new Response(stderr).text();
      expect(stdout).toBeDefined();
      var out = await new Response(stdout).text();
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(await exists(join(packageDir, "preinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "install.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "postinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "preprepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "prepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "postprepare.txt"))).toBeTrue();
      expect(await file(join(packageDir, "preinstall.txt")).text()).toBe("preinstall!");
      expect(await file(join(packageDir, "install.txt")).text()).toBe("install!");
      expect(await file(join(packageDir, "postinstall.txt")).text()).toBe("postinstall!");
      expect(await file(join(packageDir, "preprepare.txt")).text()).toBe("preprepare!");
      expect(await file(join(packageDir, "prepare.txt")).text()).toBe("prepare!");
      expect(await file(join(packageDir, "postprepare.txt")).text()).toBe("postprepare!");

      // add a dependency with all lifecycle scripts
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            preinstall: `${bunExe()} preinstall.js`,
            install: `${bunExe()} install.js`,
            postinstall: `${bunExe()} postinstall.js`,
            preprepare: `${bunExe()} preprepare.js`,
            prepare: `${bunExe()} prepare.js`,
            postprepare: `${bunExe()} postprepare.js`,
          },
          dependencies: {
            "all-lifecycle-scripts": "1.0.0",
          },
          trustedDependencies: ["all-lifecycle-scripts"],
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      expect(await exited).toBe(0);
      expect(stderr).toBeDefined();
      err = await new Response(stderr).text();
      expect(stdout).toBeDefined();
      out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        " + all-lifecycle-scripts@1.0.0",
        "",
        expect.stringContaining("1 package installed"),
      ]);
      expect(await file(join(packageDir, "preinstall.txt")).text()).toBe("preinstall exists!");
      expect(await file(join(packageDir, "install.txt")).text()).toBe("install exists!");
      expect(await file(join(packageDir, "postinstall.txt")).text()).toBe("postinstall exists!");
      expect(await file(join(packageDir, "preprepare.txt")).text()).toBe("preprepare exists!");
      expect(await file(join(packageDir, "prepare.txt")).text()).toBe("prepare exists!");
      expect(await file(join(packageDir, "postprepare.txt")).text()).toBe("postprepare exists!");

      const depDir = join(packageDir, "node_modules", "all-lifecycle-scripts");

      expect(await exists(join(depDir, "preinstall.txt"))).toBeTrue();
      expect(await exists(join(depDir, "install.txt"))).toBeTrue();
      expect(await exists(join(depDir, "postinstall.txt"))).toBeTrue();
      expect(await exists(join(depDir, "preprepare.txt"))).toBeFalse();
      expect(await exists(join(depDir, "prepare.txt"))).toBeTrue();
      expect(await exists(join(depDir, "postprepare.txt"))).toBeFalse();

      expect(await file(join(depDir, "preinstall.txt")).text()).toBe("preinstall!");
      expect(await file(join(depDir, "install.txt")).text()).toBe("install!");
      expect(await file(join(depDir, "postinstall.txt")).text()).toBe("postinstall!");
      expect(await file(join(depDir, "prepare.txt")).text()).toBe("prepare!");

      await rm(join(packageDir, "preinstall.txt"));
      await rm(join(packageDir, "install.txt"));
      await rm(join(packageDir, "postinstall.txt"));
      await rm(join(packageDir, "preprepare.txt"));
      await rm(join(packageDir, "prepare.txt"));
      await rm(join(packageDir, "postprepare.txt"));
      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lockb"));

      // all at once
      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));
      expect(await exited).toBe(0);
      expect(stderr).toBeDefined();
      err = await new Response(stderr).text();
      expect(stdout).toBeDefined();
      out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        " + all-lifecycle-scripts@1.0.0",
        "",
        expect.stringContaining("1 package installed"),
      ]);

      expect(await file(join(packageDir, "preinstall.txt")).text()).toBe("preinstall!");
      expect(await file(join(packageDir, "install.txt")).text()).toBe("install!");
      expect(await file(join(packageDir, "postinstall.txt")).text()).toBe("postinstall!");
      expect(await file(join(packageDir, "preprepare.txt")).text()).toBe("preprepare!");
      expect(await file(join(packageDir, "prepare.txt")).text()).toBe("prepare!");
      expect(await file(join(packageDir, "postprepare.txt")).text()).toBe("postprepare!");

      expect(await file(join(depDir, "preinstall.txt")).text()).toBe("preinstall!");
      expect(await file(join(depDir, "install.txt")).text()).toBe("install!");
      expect(await file(join(depDir, "postinstall.txt")).text()).toBe("postinstall!");
      expect(await file(join(depDir, "prepare.txt")).text()).toBe("prepare!");
    }, 10_000);

    test("workspace lifecycle scripts", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          workspaces: ["packages/*"],
          scripts: {
            preinstall: `touch preinstall.txt`,
            install: `touch install.txt`,
            postinstall: `touch postinstall.txt`,
            preprepare: `touch preprepare.txt`,
            prepare: `touch prepare.txt`,
            postprepare: `touch postprepare.txt`,
          },
        }),
      );

      await mkdir(join(packageDir, "packages", "pkg1"), { recursive: true });
      await writeFile(
        join(packageDir, "packages", "pkg1", "package.json"),
        JSON.stringify({
          name: "pkg1",
          version: "1.0.0",
          scripts: {
            preinstall: `touch preinstall.txt`,
            install: `touch install.txt`,
            postinstall: `touch postinstall.txt`,
            preprepare: `touch preprepare.txt`,
            prepare: `touch prepare.txt`,
            postprepare: `touch postprepare.txt`,
          },
        }),
      );

      await mkdir(join(packageDir, "packages", "pkg2"), { recursive: true });
      await writeFile(
        join(packageDir, "packages", "pkg2", "package.json"),
        JSON.stringify({
          name: "pkg2",
          version: "1.0.0",
          scripts: {
            preinstall: `touch preinstall.txt`,
            install: `touch install.txt`,
            postinstall: `touch postinstall.txt`,
            preprepare: `touch preprepare.txt`,
            prepare: `touch prepare.txt`,
            postprepare: `touch postprepare.txt`,
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      expect(stderr).toBeDefined();
      var err = await new Response(stderr).text();
      expect(stdout).toBeDefined();
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(err).toContain("Saved lockfile");
      var out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        ` + pkg1@workspace:packages${sep}pkg1`,
        ` + pkg2@workspace:packages${sep}pkg2`,
        "",
        " 2 packages installed",
      ]);
      expect(await exited).toBe(0);

      expect(await exists(join(packageDir, "preinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "install.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "postinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "preprepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "prepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "postprepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg1", "preinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg1", "install.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg1", "postinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg1", "preprepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "packages", "pkg1", "prepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg1", "postprepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "packages", "pkg2", "preinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg2", "install.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg2", "postinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg2", "preprepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "packages", "pkg2", "prepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "packages", "pkg2", "postprepare.txt"))).toBeFalse();
    });

    test("dependency lifecycle scripts run before root lifecycle scripts", async () => {
      const script = '[[ -f "./node_modules/uses-what-bin-slow/what-bin.txt" ]]';
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "uses-what-bin-slow": "1.0.0",
          },
          trustedDependencies: ["uses-what-bin-slow"],
          scripts: {
            install: script,
            postinstall: script,
            preinstall: script,
            prepare: script,
            postprepare: script,
            preprepare: script,
          },
        }),
      );

      // uses-what-bin-slow will wait one second then write a file to disk. The root package should wait for
      // for this to happen before running its lifecycle scripts.

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      expect(stderr).toBeDefined();
      var err = await new Response(stderr).text();
      expect(stdout).toBeDefined();
      var out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(await exited).toBe(0);
    });

    test("install a dependency with lifecycle scripts, then add to trusted dependencies and install again", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "all-lifecycle-scripts": "1.0.0",
          },
          trustedDependencies: [],
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      expect(stderr).toBeDefined();
      var err = await new Response(stderr).text();
      expect(stdout).toBeDefined();
      var out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        " + all-lifecycle-scripts@1.0.0",
        "",
        " 1 package installed",
      ]);

      const depDir = join(packageDir, "node_modules", "all-lifecycle-scripts");
      expect(await exists(join(depDir, "preinstall.txt"))).toBeFalse();
      expect(await exists(join(depDir, "install.txt"))).toBeFalse();
      expect(await exists(join(depDir, "postinstall.txt"))).toBeFalse();
      expect(await exists(join(depDir, "preprepare.txt"))).toBeFalse();
      expect(await exists(join(depDir, "prepare.txt"))).toBeTrue();
      expect(await exists(join(depDir, "postprepare.txt"))).toBeFalse();
      expect(await file(join(depDir, "prepare.txt")).text()).toBe("prepare!");
      expect(await exited).toBe(0);

      // add to trusted dependencies
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "all-lifecycle-scripts": "1.0.0",
          },
          trustedDependencies: ["all-lifecycle-scripts"],
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      expect(stderr).toBeDefined();
      err = await new Response(stderr).text();
      expect(stdout).toBeDefined();
      out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        expect.stringContaining("Checked 1 install across 2 packages (no changes)"),
      ]);

      expect(await file(join(depDir, "preinstall.txt")).text()).toBe("preinstall!");
      expect(await file(join(depDir, "install.txt")).text()).toBe("install!");
      expect(await file(join(depDir, "postinstall.txt")).text()).toBe("postinstall!");
      expect(await file(join(depDir, "prepare.txt")).text()).toBe("prepare!");
      expect(await exists(join(depDir, "preprepare.txt"))).toBeFalse();
      expect(await exists(join(depDir, "postprepare.txt"))).toBeFalse();
    });

    test("adding a package without scripts to trustedDependencies", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "what-bin": "1.0.0",
          },
          trustedDependencies: ["what-bin"],
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      expect(stderr).toBeDefined();
      var err = await new Response(stderr).text();
      expect(stdout).toBeDefined();
      var out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        " + what-bin@1.0.0",
        "",
        " 1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bin", ".cache", "what-bin"]);
      expect(await readdirSorted(join(packageDir, "node_modules", ".bin"))).toEqual(["what-bin"]);

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await exited).toBe(0);

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lockb"));

      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: { "what-bin": "1.0.0" },
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        " + what-bin@1.0.0",
        "",
        " 1 package installed",
      ]);
      expect(await exited).toBe(0);
      expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bin", ".cache", "what-bin"]);
      expect(await readdirSorted(join(packageDir, "node_modules", ".bin"))).toEqual(["what-bin"]);

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await exited).toBe(0);
      expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bin", ".cache", "what-bin"]);
      expect(await readdirSorted(join(packageDir, "node_modules", ".bin"))).toEqual(["what-bin"]);

      // add it to trusted dependencies
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "what-bin": "1.0.0",
          },
          trustedDependencies: ["what-bin"],
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      err = await new Response(stderr).text();
      out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        "Checked 1 install across 2 packages (no changes)",
      ]);
      expect(await exited).toBe(0);
      expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".bin", ".cache", "what-bin"]);
      expect(await readdirSorted(join(packageDir, "node_modules", ".bin"))).toEqual(["what-bin"]);
    });

    test("lifecycle scripts run if node_modules is deleted", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "lifecycle-postinstall": "1.0.0",
          },
          trustedDependencies: ["lifecycle-postinstall"],
        }),
      );
      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });
      expect(stderr).toBeDefined();
      var err = await new Response(stderr).text();
      expect(stdout).toBeDefined();
      var out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        " + lifecycle-postinstall@1.0.0",
        "",
        // @ts-ignore
        expect.stringContaining("1 package installed"),
      ]);
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(await exists(join(packageDir, "node_modules", "lifecycle-postinstall", "postinstall.txt"))).toBeTrue();
      expect(await exited).toBe(0);
      await rm(join(packageDir, "node_modules"), { force: true, recursive: true });
      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));
      expect(stderr).toBeDefined();
      err = await new Response(stderr).text();
      expect(stdout).toBeDefined();
      out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        " + lifecycle-postinstall@1.0.0",
        "",
        expect.stringContaining("1 package installed"),
      ]);
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(await exists(join(packageDir, "node_modules", "lifecycle-postinstall", "postinstall.txt"))).toBeTrue();
      expect(await exited).toBe(0);
    });

    test("INIT_CWD is set to the correct directory", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            install: "bun install.js",
          },
          dependencies: {
            "lifecycle-init-cwd": "1.0.0",
            "another-init-cwd": "npm:lifecycle-init-cwd@1.0.0",
          },
          trustedDependencies: ["lifecycle-init-cwd", "another-init-cwd"],
        }),
      );

      await writeFile(
        join(packageDir, "install.js"),
        `
      const fs = require("fs");
      const path = require("path");

      fs.writeFileSync(
      path.join(__dirname, "test.txt"),
      process.env.INIT_CWD || "does not exist"
      );
      `,
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      const out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        " + another-init-cwd@1.0.0",
        " + lifecycle-init-cwd@1.0.0",
        "",
        expect.stringContaining("1 package installed"),
      ]);
      expect(await exited).toBe(0);
      expect(await file(join(packageDir, "test.txt")).text()).toBe(packageDir + "/");
      expect(await file(join(packageDir, "node_modules/lifecycle-init-cwd/test.txt")).text()).toBe(packageDir + "/");
      expect(await file(join(packageDir, "node_modules/another-init-cwd/test.txt")).text()).toBe(packageDir + "/");
    });

    test("failing lifecycle script should print output", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "lifecycle-failing-postinstall": "1.0.0",
          },
          trustedDependencies: ["lifecycle-failing-postinstall"],
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      expect(await exited).toBe(1);

      const err = await new Response(stderr).text();
      expect(err).toContain("hello");
      expect(await exited).toBe(1);
      const out = await new Response(stdout).text();
      expect(out).toBeEmpty();
    });

    test("--ignore-scripts should skip lifecycle scripts", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          dependencies: {
            "lifecycle-failing-postinstall": "1.0.0",
          },
          trustedDependencies: ["lifecycle-failing-postinstall"],
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install", "--ignore-scripts"],
        cwd: packageDir,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("error:");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("hello");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        " + lifecycle-failing-postinstall@1.0.0",
        "",
        " 1 package installed",
      ]);
      expect(await exited).toBe(0);
    });

    test("it should add `node-gyp rebuild` as the `install` script when `install` and `postinstall` don't exist and `binding.gyp` exists in the root of the package", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "binding-gyp-scripts": "1.5.0",
          },
          trustedDependencies: ["binding-gyp-scripts"],
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        " + binding-gyp-scripts@1.5.0",
        "",
        expect.stringContaining("2 packages installed"),
      ]);
      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "node_modules/binding-gyp-scripts/build.node"))).toBeTrue();
    });

    test("automatic node-gyp scripts should not run for untrusted dependencies, and should run after adding to `trustedDependencies`", async () => {
      const packageJSON: any = {
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "binding-gyp-scripts": "1.5.0",
        },
      };
      await writeFile(join(packageDir, "package.json"), JSON.stringify(packageJSON));

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        " + binding-gyp-scripts@1.5.0",
        "",
        expect.stringContaining("2 packages installed"),
      ]);
      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "node_modules", "binding-gyp-scripts", "build.node"))).toBeFalse();

      packageJSON.trustedDependencies = ["binding-gyp-scripts"];
      await writeFile(join(packageDir, "package.json"), JSON.stringify(packageJSON));

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "node_modules", "binding-gyp-scripts", "build.node"))).toBeTrue();
    });

    test("automatic node-gyp scripts work in package root", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "node-gyp": "1.5.0",
          },
        }),
      );

      await writeFile(join(packageDir, "binding.gyp"), "");

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        " + node-gyp@1.5.0",
        "",
        expect.stringContaining("1 package installed"),
      ]);
      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "build.node"))).toBeTrue();

      await rm(join(packageDir, "build.node"));

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "build.node"))).toBeTrue();
    });

    test("auto node-gyp scripts work when scripts exists other than `install` and `postinstall`", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "node-gyp": "1.5.0",
          },
          scripts: {
            preinstall: "exit 0",
            prepare: "exit 0",
            postprepare: "exit 0",
          },
        }),
      );

      await writeFile(join(packageDir, "binding.gyp"), "");

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        " + node-gyp@1.5.0",
        "",
        expect.stringContaining("1 package installed"),
      ]);
      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "build.node"))).toBeTrue();
    });

    for (const script of ["install", "postinstall"]) {
      test(`does not add auto node-gyp script when ${script} script exists`, async () => {
        const packageJSON: any = {
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "node-gyp": "1.5.0",
          },
          scripts: {
            [script]: "exit 0",
          },
        };
        await writeFile(join(packageDir, "package.json"), JSON.stringify(packageJSON));
        await writeFile(join(packageDir, "binding.gyp"), "");

        const { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: "pipe",
          stdin: "pipe",
          stderr: "pipe",
          env: testEnv,
        });

        const err = await new Response(stderr).text();
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        const out = await new Response(stdout).text();
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          "",
          " + node-gyp@1.5.0",
          "",
          expect.stringContaining("1 package installed"),
        ]);
        expect(await exited).toBe(0);
        expect(await exists(join(packageDir, "build.node"))).toBeFalse();
      });
    }

    test("git dependencies also run `preprepare`, `prepare`, and `postprepare` scripts", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "lifecycle-install-test": "dylan-conway/lifecycle-install-test#3ba6af5b64f2d27456e08df21d750072dffd3eee",
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        " + lifecycle-install-test@github:dylan-conway/lifecycle-install-test#3ba6af5",
        "",
        expect.stringContaining("1 package installed"),
      ]);
      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "preprepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "prepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "postprepare.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "preinstall.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "install.txt"))).toBeFalse();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "postinstall.txt"))).toBeFalse();

      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "lifecycle-install-test": "dylan-conway/lifecycle-install-test#3ba6af5b64f2d27456e08df21d750072dffd3eee",
          },
          trustedDependencies: ["lifecycle-install-test"],
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      }));

      expect(await exited).toBe(0);
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "preprepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "prepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "postprepare.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "preinstall.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "install.txt"))).toBeTrue();
      expect(await exists(join(packageDir, "node_modules", "lifecycle-install-test", "postinstall.txt"))).toBeTrue();
    });

    test("root lifecycle scripts should wait for dependency lifecycle scripts", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "uses-what-bin-slow": "1.0.0",
          },
          trustedDependencies: ["uses-what-bin-slow"],
          scripts: {
            install: '[[ -f "./node_modules/uses-what-bin-slow/what-bin.txt" ]]',
          },
        }),
      );

      // Package `uses-what-bin-slow` has an install script that will sleep for 1 second
      // before writing `what-bin.txt` to disk. The root package has an install script that
      // checks if this file exists. If the root package install script does not wait for
      // the other to finish, it will fail.

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env: testEnv,
      });

      const err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        " + uses-what-bin-slow@1.0.0",
        "",
        " 2 packages installed",
      ]);
      expect(await exited).toBe(0);
    });

    // test("stress test", async () => {
    //   // 1000 versions of the same package, and 1000 different packages each depending on one
    //   // of the versions. This creates a node_modules folder for 999 of the package
    //   // versions (minus 1 because one is hoisted) with none depending on another. This allows
    //   // lifecycle scripts for each package to run in parallel if --lifecycle-script-jobs is set
    //   // high enough.
    //   const totalPackageVersions = 1000;
    //   const maxJobs = 400;
    //   var dependencies: any = {};
    //   for (var i = 0; i < totalPackageVersions; i++) {
    //     dependencies[`uses-postinstall-stress-test-1-0-${i}`] = `1.0.${i}`;
    //   }

    //   await writeFile(
    //     join(packageDir, "package.json"),
    //     JSON.stringify({
    //       name: "foo",
    //       version: "1.0.0",
    //       dependencies,
    //       trustedDependencies: ["postinstall-stress-test"],
    //     }),
    //   );

    //   var { stdout, stderr, exited } = spawn({
    //     cmd: [bunExe(), "install", `--lifecycle-script-jobs=${maxJobs}`],
    //     cwd: packageDir,
    //     stdout: "pipe",
    //     stdin: "pipe",
    //     stderr: "pipe",
    //     env: testEnv,
    //   });

    //   const err = await new Response(stderr).text();
    //   expect(await exited).toBe(0);
    //   expect(err).toContain("Saved lockfile");
    //   expect(err).not.toContain("not found");
    //   expect(err).not.toContain("error:");

    //   await rm(join(packageDir, "node_modules", ".cache"), { recursive: true, force: true });
    //   expect((await readdir(join(packageDir, "node_modules"), { recursive: true })).sort()).toMatchSnapshot();
    // }, 10_000);

    test("it should install and use correct binary version", async () => {
      // this should install `what-bin` in two places:
      //
      // - node_modules/.bin/what-bin@1.5.0
      // - node_modules/uses-what-bin/node_modules/.bin/what-bin@1.0.0

      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "uses-what-bin": "1.0.0",
            "what-bin": "1.5.0",
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      var err = await new Response(stderr).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      var out = await new Response(stdout).text();
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        " + uses-what-bin@1.0.0",
        " + what-bin@1.5.0",
        "",
        expect.stringContaining("3 packages installed"),
      ]);
      expect(await exited).toBe(0);
      expect(await file(join(packageDir, "node_modules", ".bin", "what-bin")).text()).toContain("what-bin@1.5.0");
      expect(
        await file(join(packageDir, "node_modules", "uses-what-bin", "node_modules", ".bin", "what-bin")).text(),
      ).toContain("what-bin@1.0.0");

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });
      await rm(join(packageDir, "bun.lockb"));

      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "uses-what-bin": "1.5.0",
            "what-bin": "1.0.0",
          },
          scripts: {
            install: "what-bin",
          },
          trustedDependencies: ["uses-what-bin"],
        }),
      );

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));

      expect(await exited).toBe(0);
      expect(await file(join(packageDir, "node_modules", ".bin", "what-bin")).text()).toContain("what-bin@1.0.0");
      expect(
        await file(join(packageDir, "node_modules", "uses-what-bin", "node_modules", ".bin", "what-bin")).text(),
      ).toContain("what-bin@1.5.0");

      await rm(join(packageDir, "node_modules"), { recursive: true, force: true });

      ({ stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      }));

      out = await new Response(stdout).text();
      err = await new Response(stderr).text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        " + uses-what-bin@1.5.0",
        " + what-bin@1.0.0",
        "",
        expect.stringContaining("3 packages installed"),
      ]);
      expect(await exited).toBe(0);
    });
    test("node-gyp should always be available for lifecycle scripts", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          scripts: {
            install: "node-gyp --version",
          },
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      const err = await new Response(stderr).text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      const out = await new Response(stdout).text();

      // if node-gyp isn't available, it would return a non-zero exit code
      expect(await exited).toBe(0);
    });

    test("npm_config_node_gyp should be set and usable in lifecycle scripts", async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          scripts: {
            install: "node $npm_config_node_gyp --version",
          },
        }),
      );

      const { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: "pipe",
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      expect(await exited).toBe(0);
      const err = await new Response(stderr).text();
      expect(err).not.toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(err).toContain("v");
    });
  });
}

test("it should be able to find binary in node_modules/.bin from parent directory of root package", async () => {
  await mkdir(join(packageDir, "node_modules", ".bin"), { recursive: true });
  await mkdir(join(packageDir, "morePackageDir"));
  await writeFile(
    join(packageDir, "morePackageDir", "package.json"),
    JSON.stringify({
      name: "foo",
      version: "1.0.0",
      scripts: {
        install: "missing-bin",
      },
      dependencies: {
        "what-bin": "1.0.0",
      },
    }),
  );

  await cp(join(packageDir, "bunfig.toml"), join(packageDir, "morePackageDir", "bunfig.toml"));

  await await writeFile(
    join(packageDir, "node_modules", ".bin", "missing-bin"),
    `#!/usr/bin/env node
require("fs").writeFileSync("missing-bin.txt", "missing-bin@WHAT");
`,
    { mode: 0o777 },
  );

  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "install"],
    cwd: join(packageDir, "morePackageDir"),
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });

  const err = await new Response(stderr).text();
  expect(err).toContain("Saved lockfile");
  expect(err).not.toContain("not found");
  expect(err).not.toContain("error:");
  const out = await new Response(stdout).text();
  expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
    "",
    " + what-bin@1.0.0",
    "",
    expect.stringContaining("1 package installed"),
  ]);
  expect(await exited).toBe(0);
  expect(await file(join(packageDir, "morePackageDir", "missing-bin.txt")).text()).toBe("missing-bin@WHAT");
});

describe("semver", () => {
  const taggedVersionTests = [
    {
      title: "tagged version last in range",
      depVersion: "1 || 2 || pre-3",
      expected: "2.0.1",
    },
    {
      title: "tagged version in middle of range",
      depVersion: "1 || pre-3 || 2",
      expected: "2.0.1",
    },
    {
      title: "tagged version first in range",
      depVersion: "pre-3 || 2 || 1",
      expected: "2.0.1",
    },
    {
      title: "multiple tagged versions in range",
      depVersion: "pre-3 || 2 || pre-1 || 1 || 3 || pre-3",
      expected: "3.0.0",
    },
    {
      title: "start with ||",
      depVersion: "|| 1",
      expected: "1.0.1",
    },
    {
      title: "start with || no space",
      depVersion: "||2",
      expected: "2.0.1",
    },
    {
      title: "|| with no space on both sides",
      depVersion: "1||2",
      expected: "2.0.1",
    },
    {
      title: "no version is latest",
      depVersion: "",
      expected: "3.0.0",
    },
    {
      title: "tagged version works",
      depVersion: "pre-2",
      expected: "2.0.1",
    },
    {
      title: "tagged above latest",
      depVersion: "pre-3",
      expected: "3.0.1",
    },
    {
      title: "'||'",
      depVersion: "||",
      expected: "3.0.0",
    },
    {
      title: "'|'",
      depVersion: "|",
      expected: "3.0.0",
    },
    {
      title: "'|||'",
      depVersion: "|||",
      expected: "3.0.0",
    },
    {
      title: "'|| ||'",
      depVersion: "|| ||",
      expected: "3.0.0",
    },
    {
      title: "'|| 1 ||'",
      depVersion: "|| 1 ||",
      expected: "1.0.1",
    },
    {
      title: "'| | |'",
      depVersion: "| | |",
      expected: "3.0.0",
    },
    {
      title: "'|||||||||||||||||||||||||'",
      depVersion: "|||||||||||||||||||||||||",
      expected: "3.0.0",
    },
    {
      title: "'2 ||| 1'",
      depVersion: "2 ||| 1",
      expected: "2.0.1",
    },
    {
      title: "'2 |||| 1'",
      depVersion: "2 |||| 1",
      expected: "2.0.1",
    },
  ];

  for (const { title, depVersion, expected } of taggedVersionTests) {
    test(title, async () => {
      await writeFile(
        join(packageDir, "package.json"),
        JSON.stringify({
          name: "foo",
          version: "1.0.0",
          dependencies: {
            "dep-with-tags": depVersion,
          },
        }),
      );

      var { stdout, stderr, exited } = spawn({
        cmd: [bunExe(), "install"],
        cwd: packageDir,
        stdout: null,
        stdin: "pipe",
        stderr: "pipe",
        env,
      });

      expect(stderr).toBeDefined();
      var err = await new Response(stderr).text();
      expect(stdout).toBeDefined();
      var out = await new Response(stdout).text();
      expect(err).toContain("Saved lockfile");
      expect(err).not.toContain("not found");
      expect(err).not.toContain("error:");
      expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
        "",
        ` + dep-with-tags@${expected}`,
        "",
        " 1 package installed",
      ]);
      expect(await exited).toBe(0);
    });
  }

  test.todo("only tagged versions in range errors", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "dep-with-tags": "pre-1 || pre-2",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stderr).toBeDefined();
    var err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    var out = await new Response(stdout).text();
    expect(err).toContain('InvalidDependencyVersion parsing version "pre-1 || pre-2"');
    expect(await exited).toBe(1);
    expect(out).toBeEmpty();
  });
});

const prereleaseTests = [
  [
    { title: "specific", depVersion: "1.0.0-future.1", expected: "1.0.0-future.1" },
    { title: "latest", depVersion: "latest", expected: "1.0.0-future.4" },
    { title: "range starting with latest", depVersion: "^1.0.0-future.4", expected: "1.0.0-future.4" },
    { title: "range above latest", depVersion: "^1.0.0-future.5", expected: "1.0.0-future.7" },
  ],
  [
    { title: "#6683", depVersion: "^1.0.0-next.23", expected: "1.0.0-next.23" },
    {
      title: "greater than or equal to",
      depVersion: ">=1.0.0-next.23",
      expected: "1.0.0-next.23",
    },
    { title: "latest", depVersion: "latest", expected: "0.5.0" },
    { title: "greater than or equal to latest", depVersion: ">=0.5.0", expected: "0.5.0" },
  ],

  // package "prereleases-3" has four versions, all with prerelease tags:
  // - 5.0.0-alpha.150
  // - 5.0.0-alpha.151
  // - 5.0.0-alpha.152
  // - 5.0.0-alpha.153
  [
    { title: "#6956", depVersion: "^5.0.0-alpha.153", expected: "5.0.0-alpha.153" },
    { title: "range matches highest possible", depVersion: "^5.0.0-alpha.152", expected: "5.0.0-alpha.153" },
    { title: "exact", depVersion: "5.0.0-alpha.152", expected: "5.0.0-alpha.152" },
    { title: "exact latest", depVersion: "5.0.0-alpha.153", expected: "5.0.0-alpha.153" },
    { title: "latest", depVersion: "latest", expected: "5.0.0-alpha.153" },
    { title: "~ lower than latest", depVersion: "~5.0.0-alpha.151", expected: "5.0.0-alpha.153" },
    {
      title: "~ equal semver and lower non-existant prerelease",
      depVersion: "~5.0.0-alpha.100",
      expected: "5.0.0-alpha.153",
    },
    {
      title: "^ equal semver and lower non-existant prerelease",
      depVersion: "^5.0.0-alpha.100",
      expected: "5.0.0-alpha.153",
    },
    {
      title: "~ and ^ latest prerelease",
      depVersion: "~5.0.0-alpha.153 || ^5.0.0-alpha.153",
      expected: "5.0.0-alpha.153",
    },
    {
      title: "< latest prerelease",
      depVersion: "<5.0.0-alpha.153",
      expected: "5.0.0-alpha.152",
    },
    {
      title: "< lower than latest prerelease",
      depVersion: "<5.0.0-alpha.152",
      expected: "5.0.0-alpha.151",
    },
    {
      title: "< higher than latest prerelease",
      depVersion: "<5.0.0-alpha.22343423",
      expected: "5.0.0-alpha.153",
    },
    {
      title: "< at lowest possible version",
      depVersion: "<5.0.0-alpha.151",
      expected: "5.0.0-alpha.150",
    },
    {
      title: "<= latest prerelease",
      depVersion: "<=5.0.0-alpha.153",
      expected: "5.0.0-alpha.153",
    },
    {
      title: "<= lower than latest prerelease",
      depVersion: "<=5.0.0-alpha.152",
      expected: "5.0.0-alpha.152",
    },
    {
      title: "<= lowest possible version",
      depVersion: "<=5.0.0-alpha.150",
      expected: "5.0.0-alpha.150",
    },
    {
      title: "<= higher than latest prerelease",
      depVersion: "<=5.0.0-alpha.153261345",
      expected: "5.0.0-alpha.153",
    },
    {
      title: "> latest prerelease",
      depVersion: ">=5.0.0-alpha.153",
      expected: "5.0.0-alpha.153",
    },
  ],
];
for (let i = 0; i < prereleaseTests.length; i++) {
  const tests = prereleaseTests[i];
  const depName = `prereleases-${i + 1}`;
  describe(`${depName} should pass`, () => {
    for (const { title, depVersion, expected } of tests) {
      test(title, async () => {
        await writeFile(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
            version: "1.0.0",
            dependencies: {
              [`${depName}`]: depVersion,
            },
          }),
        );

        const { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: null,
          stdin: "pipe",
          stderr: "pipe",
          env,
        });

        expect(stderr).toBeDefined();
        const err = await new Response(stderr).text();
        expect(stdout).toBeDefined();
        const out = await new Response(stdout).text();
        expect(err).toContain("Saved lockfile");
        expect(err).not.toContain("not found");
        expect(err).not.toContain("error:");
        expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
          "",
          ` + ${depName}@${expected}`,
          "",
          " 1 package installed",
        ]);
        expect(await file(join(packageDir, "node_modules", depName, "package.json")).json()).toEqual({
          name: depName,
          version: expected,
        } as any);
        expect(await exited).toBe(0);
      });
    }
  });
}
const prereleaseFailTests = [
  [
    // { title: "specific", depVersion: "1.0.0-future.1", expected: "1.0.0-future.1" },
    // { title: "latest", depVersion: "latest", expected: "1.0.0-future.4" },
    // { title: "range starting with latest", depVersion: "^1.0.0-future.4", expected: "1.0.0-future.4" },
    // { title: "range above latest", depVersion: "^1.0.0-future.5", expected: "1.0.0-future.7" },
  ],
  [
    // { title: "#6683", depVersion: "^1.0.0-next.23", expected: "1.0.0-next.23" },
    // {
    //   title: "greater than or equal to",
    //   depVersion: ">=1.0.0-next.23",
    //   expected: "1.0.0-next.23",
    // },
    // { title: "latest", depVersion: "latest", expected: "0.5.0" },
    // { title: "greater than or equal to latest", depVersion: ">=0.5.0", expected: "0.5.0" },
  ],

  // package "prereleases-3" has four versions, all with prerelease tags:
  // - 5.0.0-alpha.150
  // - 5.0.0-alpha.151
  // - 5.0.0-alpha.152
  // - 5.0.0-alpha.153
  [
    {
      title: "^ with higher non-existant prerelease",
      depVersion: "^5.0.0-alpha.1000",
    },
    {
      title: "~ with higher non-existant prerelease",
      depVersion: "~5.0.0-alpha.1000",
    },
    {
      title: "> with higher non-existant prerelease",
      depVersion: ">5.0.0-alpha.1000",
    },
    {
      title: ">= with higher non-existant prerelease",
      depVersion: ">=5.0.0-alpha.1000",
    },
    {
      title: "^4.3.0",
      depVersion: "^4.3.0",
    },
    {
      title: "~4.3.0",
      depVersion: "~4.3.0",
    },
    {
      title: ">4.3.0",
      depVersion: ">4.3.0",
    },
    {
      title: ">=4.3.0",
      depVersion: ">=4.3.0",
    },
    {
      title: "<5.0.0-alpha.150",
      depVersion: "<5.0.0-alpha.150",
    },
    {
      title: "<=5.0.0-alpha.149",
      depVersion: "<=5.0.0-alpha.149",
    },
    {
      title: "greater than highest prerelease",
      depVersion: ">5.0.0-alpha.153",
    },
    {
      title: "greater than or equal to highest prerelease + 1",
      depVersion: ">=5.0.0-alpha.154",
    },
  ],
  // prereleases-4 has one version
  // - 2.0.0-pre.0
  [
    {
      title: "wildcard should not match prerelease",
      depVersion: "x",
    },
    {
      title: "major wildcard should not match prerelease",
      depVersion: "x.0.0",
    },
    {
      title: "minor wildcard should not match prerelease",
      depVersion: "2.x",
    },
    {
      title: "patch wildcard should not match prerelease",
      depVersion: "2.0.x",
    },
  ],
];
for (let i = 0; i < prereleaseFailTests.length; i++) {
  const tests = prereleaseFailTests[i];
  const depName = `prereleases-${i + 1}`;
  describe(`${depName} should fail`, () => {
    for (const { title, depVersion } of tests) {
      test(title, async () => {
        await writeFile(
          join(packageDir, "package.json"),
          JSON.stringify({
            name: "foo",
            version: "1.0.0",
            dependencies: {
              [`${depName}`]: depVersion,
            },
          }),
        );

        const { stdout, stderr, exited } = spawn({
          cmd: [bunExe(), "install"],
          cwd: packageDir,
          stdout: null,
          stdin: "pipe",
          stderr: "pipe",
          env,
        });

        expect(stderr).toBeDefined();
        const err = await new Response(stderr).text();
        expect(stdout).toBeDefined();
        const out = await new Response(stdout).text();
        expect(out).toBeEmpty();
        expect(err).toContain(`No version matching "${depVersion}" found for specifier "${depName}"`);
        expect(await exited).toBe(1);
      });
    }
  });
}

describe("yarn tests", () => {
  test("dragon test 1", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "dragon-test-1",
        version: "1.0.0",
        dependencies: {
          "dragon-test-1-d": "1.0.0",
          "dragon-test-1-e": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + dragon-test-1-d@1.0.0",
      " + dragon-test-1-e@1.0.0",
      "",
      " 6 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "dragon-test-1-a",
      "dragon-test-1-b",
      "dragon-test-1-c",
      "dragon-test-1-d",
      "dragon-test-1-e",
    ]);
    expect(await file(join(packageDir, "node_modules", "dragon-test-1-b", "package.json")).json()).toEqual({
      name: "dragon-test-1-b",
      version: "2.0.0",
    } as any);
    expect(await readdirSorted(join(packageDir, "node_modules", "dragon-test-1-c", "node_modules"))).toEqual([
      "dragon-test-1-b",
    ]);
    expect(
      await file(
        join(packageDir, "node_modules", "dragon-test-1-c", "node_modules", "dragon-test-1-b", "package.json"),
      ).json(),
    ).toEqual({
      name: "dragon-test-1-b",
      version: "1.0.0",
      dependencies: {
        "dragon-test-1-a": "1.0.0",
      },
    } as any);
    expect(await exited).toBe(0);
  });

  test("dragon test 2", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "dragon-test-2",
        version: "1.0.0",
        workspaces: ["dragon-test-2-a", "dragon-test-2-b"],
        dependencies: {
          "dragon-test-2-a": "1.0.0",
        },
      }),
    );

    await mkdir(join(packageDir, "dragon-test-2-a"));
    await mkdir(join(packageDir, "dragon-test-2-b"));

    await writeFile(
      join(packageDir, "dragon-test-2-a", "package.json"),
      JSON.stringify({
        name: "dragon-test-2-a",
        version: "1.0.0",
        dependencies: {
          "dragon-test-2-b": "1.0.0",
          "no-deps": "1.0.0",
        },
      }),
    );

    await writeFile(
      join(packageDir, "dragon-test-2-b", "package.json"),
      JSON.stringify({
        name: "dragon-test-2-b",
        version: "1.0.0",
        dependencies: {
          "no-deps": "*",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + dragon-test-2-b@workspace:dragon-test-2-b",
      " + dragon-test-2-a@workspace:dragon-test-2-a",
      "",
      " 4 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "dragon-test-2-a",
      "dragon-test-2-b",
      "no-deps",
    ]);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "2.0.0",
    } as any);
    expect(await readdirSorted(join(packageDir, "dragon-test-2-a", "node_modules"))).toEqual(["no-deps"]);
    expect(await file(join(packageDir, "dragon-test-2-a", "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    } as any);
    expect(await exited).toBe(0);
  });

  test("dragon test 3", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "dragon-test-3",
        version: "1.0.0",
        dependencies: {
          "dragon-test-3-a": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + dragon-test-3-a@1.0.0",
      "",
      " 3 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "dragon-test-3-a",
      "dragon-test-3-b",
      "no-deps",
    ]);
    expect(await file(join(packageDir, "node_modules", "dragon-test-3-a", "package.json")).json()).toEqual({
      name: "dragon-test-3-a",
      version: "1.0.0",
      dependencies: {
        "dragon-test-3-b": "1.0.0",
      },
      peerDependencies: {
        "no-deps": "*",
      },
    } as any);
    expect(await exited).toBe(0);
  });

  test("dragon test 4", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        "name": "dragon-test-4",
        "version": "1.0.0",
        "workspaces": ["my-workspace"],
      }),
    );

    await mkdir(join(packageDir, "my-workspace"));
    await writeFile(
      join(packageDir, "my-workspace", "package.json"),
      JSON.stringify({
        "name": "my-workspace",
        "version": "1.0.0",
        "peerDependencies": {
          "no-deps": "*",
          "peer-deps": "*",
        },
        "devDependencies": {
          "no-deps": "1.0.0",
          "peer-deps": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + my-workspace@workspace:my-workspace",
      "",
      " 3 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "my-workspace",
      "no-deps",
      "peer-deps",
    ]);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    } as any);
    expect(await file(join(packageDir, "node_modules", "peer-deps", "package.json")).json()).toEqual({
      name: "peer-deps",
      version: "1.0.0",
      peerDependencies: {
        "no-deps": "*",
      },
    } as any);
    expect(await exited).toBe(0);
  });

  test("dragon test 5", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        "name": "dragon-test-5",
        "version": "1.0.0",
        "workspaces": ["packages/*"],
      }),
    );

    await mkdir(join(packageDir, "packages", "a"), { recursive: true });
    await mkdir(join(packageDir, "packages", "b"), { recursive: true });

    await writeFile(
      join(packageDir, "packages", "a", "package.json"),
      JSON.stringify({
        "name": "a",
        "peerDependencies": {
          "various-requires": "*",
        },
        "devDependencies": {
          "no-deps": "1.0.0",
          "peer-deps": "1.0.0",
        },
      }),
    );

    await writeFile(
      join(packageDir, "packages", "b", "package.json"),
      JSON.stringify({
        "name": "b",
        "devDependencies": {
          "a": "workspace:*",
          "various-requires": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      ` + a@workspace:packages${sep}a`,
      ` + b@workspace:packages${sep}b`,
      "",
      " 5 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "a",
      "b",
      "no-deps",
      "peer-deps",
      "various-requires",
    ]);
    expect(await file(join(packageDir, "node_modules", "no-deps", "package.json")).json()).toEqual({
      name: "no-deps",
      version: "1.0.0",
    } as any);
    expect(await file(join(packageDir, "node_modules", "peer-deps", "package.json")).json()).toEqual({
      name: "peer-deps",
      version: "1.0.0",
      peerDependencies: {
        "no-deps": "*",
      },
    } as any);
    expect(await file(join(packageDir, "node_modules", "various-requires", "package.json")).json()).toEqual({
      name: "various-requires",
      version: "1.0.0",
    } as any);
    expect(await exited).toBe(0);
  });

  test.todo("dragon test 6", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        "name": "dragon-test-6",
        "version": "1.0.0",
        "workspaces": ["packages/*"],
      }),
    );

    await mkdir(join(packageDir, "packages", "a"), { recursive: true });
    await mkdir(join(packageDir, "packages", "b"), { recursive: true });
    await mkdir(join(packageDir, "packages", "c"), { recursive: true });
    await mkdir(join(packageDir, "packages", "u"), { recursive: true });
    await mkdir(join(packageDir, "packages", "v"), { recursive: true });
    await mkdir(join(packageDir, "packages", "y"), { recursive: true });
    await mkdir(join(packageDir, "packages", "z"), { recursive: true });

    await writeFile(
      join(packageDir, "packages", "a", "package.json"),
      JSON.stringify({
        name: `a`,
        dependencies: {
          [`z`]: `workspace:*`,
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "b", "package.json"),
      JSON.stringify({
        name: `b`,
        dependencies: {
          [`u`]: `workspace:*`,
          [`v`]: `workspace:*`,
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "c", "package.json"),
      JSON.stringify({
        name: `c`,
        dependencies: {
          [`u`]: `workspace:*`,
          [`v`]: `workspace:*`,
          [`y`]: `workspace:*`,
          [`z`]: `workspace:*`,
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "u", "package.json"),
      JSON.stringify({
        name: `u`,
      }),
    );
    await writeFile(
      join(packageDir, "packages", "v", "package.json"),
      JSON.stringify({
        name: `v`,
        peerDependencies: {
          [`u`]: `*`,
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "y", "package.json"),
      JSON.stringify({
        name: `y`,
        peerDependencies: {
          [`v`]: `*`,
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "z", "package.json"),
      JSON.stringify({
        name: `z`,
        dependencies: {
          [`y`]: `workspace:*`,
        },
        peerDependencies: {
          [`v`]: `*`,
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + a@workspace:packages/a",
      " + b@workspace:packages/b",
      " + c@workspace:packages/c",
      " + u@workspace:packages/u",
      " + v@workspace:packages/v",
      " + y@workspace:packages/y",
      " + z@workspace:packages/z",
      "",
      " 7 packages installed",
    ]);
    expect(await exited).toBe(0);
  });

  test.todo("dragon test 7", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        "name": "dragon-test-7",
        "version": "1.0.0",
        "dependencies": {
          "dragon-test-7-a": "1.0.0",
          "dragon-test-7-d": "1.0.0",
          "dragon-test-7-b": "2.0.0",
          "dragon-test-7-c": "3.0.0",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stderr).toBeDefined();
    var err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + dragon-test-7-a@1.0.0",
      " + dragon-test-7-b@2.0.0",
      " + dragon-test-7-c@3.0.0",
      " + dragon-test-7-d@1.0.0",
      "",
      " 7 packages installed",
    ]);
    expect(await exited).toBe(0);

    await writeFile(
      join(packageDir, "test.js"),
      `console.log(require("dragon-test-7-a"), require("dragon-test-7-d"));`,
    );

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    expect(stderr).toBeDefined();
    err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    out = await new Response(stdout).text();
    expect(err).toBeEmpty();
    expect(out).toBe("1.0.0 1.0.0\n");

    expect(
      await exists(
        join(
          packageDir,
          "node_modules",
          "dragon-test-7-a",
          "node_modules",
          "dragon-test-7-b",
          "node_modules",
          "dragon-test-7-c",
        ),
      ),
    ).toBeTrue();
    expect(
      await exists(
        join(packageDir, "node_modules", "dragon-test-7-d", "node_modules", "dragon-test-7-b", "node_modules"),
      ),
    ).toBeFalse();
    expect(await exited).toBe(0);
  });

  test("dragon test 8", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        "name": "dragon-test-8",
        version: "1.0.0",
        dependencies: {
          "dragon-test-8-a": "1.0.0",
          "dragon-test-8-b": "1.0.0",
          "dragon-test-8-c": "1.0.0",
          "dragon-test-8-d": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + dragon-test-8-a@1.0.0",
      " + dragon-test-8-b@1.0.0",
      " + dragon-test-8-c@1.0.0",
      " + dragon-test-8-d@1.0.0",
      "",
      " 4 packages installed",
    ]);
    expect(await exited).toBe(0);
  });

  test("dragon test 9", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "dragon-test-9",
        version: "1.0.0",
        dependencies: {
          [`first`]: `npm:peer-deps@1.0.0`,
          [`second`]: `npm:peer-deps@1.0.0`,
          [`no-deps`]: `1.0.0`,
        },
      }),
    );
    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stderr).toBeDefined();
    var err = await new Response(stderr).text();
    expect(stdout).toBeDefined();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("error:");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + first@1.0.0",
      " + no-deps@1.0.0",
      " + second@1.0.0",
      "",
      " 2 packages installed",
    ]);
    expect(await file(join(packageDir, "node_modules", "first", "package.json")).json()).toEqual(
      await file(join(packageDir, "node_modules", "second", "package.json")).json(),
    );
    expect(await exited).toBe(0);
  });

  test.todo("dragon test 10", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "dragon-test-10",
        version: "1.0.0",
        workspaces: ["packages/*"],
      }),
    );

    await mkdir(join(packageDir, "packages", "a"), { recursive: true });
    await mkdir(join(packageDir, "packages", "b"), { recursive: true });
    await mkdir(join(packageDir, "packages", "c"), { recursive: true });

    await writeFile(
      join(packageDir, "packages", "a", "package.json"),
      JSON.stringify({
        name: "a",
        devDependencies: {
          b: "workspace:*",
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "b", "package.json"),
      JSON.stringify({
        name: "b",
        peerDependencies: {
          c: "*",
        },
        devDependencies: {
          c: "workspace:*",
        },
      }),
    );
    await writeFile(
      join(packageDir, "packages", "c", "package.json"),
      JSON.stringify({
        name: "c",
        peerDependencies: {
          "no-deps": "*",
        },
        depedencies: {
          b: "workspace:*",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--dev"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + a@workspace:packages/a",
      " + b@workspace:packages/b",
      " + c@workspace:packages/c",
      "",
      " 3 packages installed",
    ]);
    expect(await exited).toBe(0);
  });

  test("dragon test 12", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "dragon-test-12",
        version: "1.0.0",
        workspaces: ["pkg-a", "pkg-b"],
      }),
    );

    await mkdir(join(packageDir, "pkg-a"), { recursive: true });
    await mkdir(join(packageDir, "pkg-b"), { recursive: true });

    await writeFile(
      join(packageDir, "pkg-a", "package.json"),
      JSON.stringify({
        name: "pkg-a",
        dependencies: {
          "pkg-b": "workspace:*",
        },
      }),
    );
    await writeFile(
      join(packageDir, "pkg-b", "package.json"),
      JSON.stringify({
        name: "pkg-b",
        dependencies: {
          "peer-deps": "1.0.0",
          "fake-peer-deps": "npm:peer-deps@1.0.0",
        },
        peerDependencies: {
          "no-deps": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + pkg-a@workspace:pkg-a",
      " + pkg-b@workspace:pkg-b",
      "",
      " 4 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([
      ".cache",
      "no-deps",
      "peer-deps",
      "pkg-a",
      "pkg-b",
    ]);
    expect(await file(join(packageDir, "pkg-b", "node_modules", "fake-peer-deps", "package.json")).json()).toEqual({
      name: "peer-deps",
      version: "1.0.0",
      peerDependencies: {
        "no-deps": "*",
      },
    } as any);
    expect(await exited).toBe(0);
  });

  test("it should not warn when the peer dependency resolution is compatible", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "compatible-peer-deps",
        version: "1.0.0",
        dependencies: {
          "peer-deps-fixed": "1.0.0",
          "no-deps": "1.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--dev"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("incorrect peer dependency");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + no-deps@1.0.0",
      " + peer-deps-fixed@1.0.0",
      "",
      " 2 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".cache", "no-deps", "peer-deps-fixed"]);
    expect(await exited).toBe(0);
  });

  test("it should warn when the peer dependency resolution is incompatible", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "incompatible-peer-deps",
        version: "1.0.0",
        dependencies: {
          "peer-deps-fixed": "1.0.0",
          "no-deps": "2.0.0",
        },
      }),
    );

    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--dev"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    expect(stdout).toBeDefined();
    const out = await new Response(stdout).text();
    expect(stderr).toBeDefined();
    const err = await new Response(stderr).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(err).toContain("incorrect peer dependency");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + no-deps@2.0.0",
      " + peer-deps-fixed@1.0.0",
      "",
      " 2 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".cache", "no-deps", "peer-deps-fixed"]);
    expect(await exited).toBe(0);
  });

  test("it should install in such a way that two identical packages with different peer dependencies are different instances", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "provides-peer-deps-1-0-0": "1.0.0",
          "provides-peer-deps-2-0-0": "1.0.0",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("incorrect peer dependency");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + provides-peer-deps-1-0-0@1.0.0",
      " + provides-peer-deps-2-0-0@1.0.0",
      "",
      " 5 packages installed",
    ]);
    expect(await exited).toBe(0);

    await writeFile(
      join(packageDir, "test.js"),
      `console.log(
        require("provides-peer-deps-1-0-0").dependencies["peer-deps"] ===
          require("provides-peer-deps-2-0-0").dependencies["peer-deps"]
      );
      console.log(
        Bun.deepEquals(require("provides-peer-deps-1-0-0"), {
          name: "provides-peer-deps-1-0-0",
          version: "1.0.0",
          dependencies: {
            "peer-deps": {
              name: "peer-deps",
              version: "1.0.0",
              peerDependencies: {
                "no-deps": {
                  name: "no-deps",
                  version: "1.0.0",
                },
              },
            },
            "no-deps": {
              name: "no-deps",
              version: "1.0.0",
            },
          },
        })
      );
      console.log(
        Bun.deepEquals(require("provides-peer-deps-2-0-0"), {
          name: "provides-peer-deps-2-0-0",
          version: "1.0.0",
          dependencies: {
            "peer-deps": {
              name: "peer-deps",
              version: "1.0.0",
              peerDependencies: {
                "no-deps": {
                  name: "no-deps",
                  version: "2.0.0",
                },
              },
            },
            "no-deps": {
              name: "no-deps",
              version: "2.0.0",
            },
          },
        })
      );`,
    );

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(out).toBe("true\ntrue\nfalse\n");
    expect(err).toBeEmpty();
    expect(await exited).toBe(0);
  });

  test("it should install in such a way that two identical packages with the same peer dependencies are the same instances (simple)", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "provides-peer-deps-1-0-0": "1.0.0",
          "provides-peer-deps-1-0-0-too": "1.0.0",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("incorrect peer dependency");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + provides-peer-deps-1-0-0@1.0.0",
      " + provides-peer-deps-1-0-0-too@1.0.0",
      "",
      " 4 packages installed",
    ]);
    expect(await exited).toBe(0);

    await writeFile(
      join(packageDir, "test.js"),
      `console.log(
        require("provides-peer-deps-1-0-0").dependencies["peer-deps"] ===
          require("provides-peer-deps-1-0-0-too").dependencies["peer-deps"]
      );`,
    );

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(out).toBe("true\n");
    expect(err).toBeEmpty();
    expect(await exited).toBe(0);
  });
  test("it should install in such a way that two identical packages with the same peer dependencies are the same instances (complex)", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "forward-peer-deps": "1.0.0",
          "forward-peer-deps-too": "1.0.0",
          "no-deps": "1.0.0",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("incorrect peer dependency");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + forward-peer-deps@1.0.0",
      " + forward-peer-deps-too@1.0.0",
      " + no-deps@1.0.0",
      "",
      " 4 packages installed",
    ]);
    expect(await exited).toBe(0);

    await writeFile(
      join(packageDir, "test.js"),
      `console.log(
        require("forward-peer-deps").dependencies["peer-deps"] ===
          require("forward-peer-deps-too").dependencies["peer-deps"]
      );`,
    );

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(out).toBe("true\n");
    expect(err).toBeEmpty();
    expect(await exited).toBe(0);
  });

  test("it shouldn't deduplicate two packages with similar peer dependencies but different names", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "peer-deps": "1.0.0",
          "peer-deps-too": "1.0.0",
          "no-deps": "1.0.0",
        },
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(err).not.toContain("incorrect peer dependency");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + no-deps@1.0.0",
      " + peer-deps@1.0.0",
      " + peer-deps-too@1.0.0",
      "",
      " 3 packages installed",
    ]);
    expect(await exited).toBe(0);

    await writeFile(join(packageDir, "test.js"), `console.log(require('peer-deps') === require('peer-deps-too'));`);

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "test.js"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(out).toBe("false\n");
    expect(err).toBeEmpty();
    expect(await exited).toBe(0);
  });

  test("it should reinstall and rebuild dependencies deleted by the user on the next install", async () => {
    await writeFile(
      join(packageDir, "package.json"),
      JSON.stringify({
        name: "foo",
        version: "1.0.0",
        dependencies: {
          "no-deps-scripted": "1.0.0",
          "one-dep-scripted": "1.5.0",
        },
        trustedDependencies: ["no-deps-scripted", "one-dep-scripted"],
      }),
    );

    var { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--dev"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    });

    var err = await new Response(stderr).text();
    var out = await new Response(stdout).text();
    expect(err).toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(out.replace(/\s*\[[0-9\.]+m?s\]\s*$/, "").split(/\r?\n/)).toEqual([
      "",
      " + no-deps-scripted@1.0.0",
      " + one-dep-scripted@1.5.0",
      "",
      expect.stringContaining("4 packages installed"),
    ]);
    expect(await exists(join(packageDir, "node_modules/one-dep-scripted/success.txt"))).toBeTrue();
    expect(await exited).toBe(0);

    await rm(join(packageDir, "node_modules/one-dep-scripted"), { recursive: true, force: true });

    ({ stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "install", "--dev"],
      cwd: packageDir,
      stdout: null,
      stdin: "pipe",
      stderr: "pipe",
      env,
    }));

    err = await new Response(stderr).text();
    out = await new Response(stdout).text();
    expect(err).not.toContain("Saved lockfile");
    expect(err).not.toContain("error:");
    expect(err).not.toContain("not found");
    expect(await exists(join(packageDir, "node_modules/one-dep-scripted/success.txt"))).toBeTrue();
    expect(await exited).toBe(0);
  });
});
