import { file, spawn } from "bun";
import { bunExe, bunEnv as env, ignoreMimallocWarning } from "harness";
import { join } from "path";
import { mkdtempSync, realpathSync } from "fs";
import { rm, writeFile, mkdir, exists, cp } from "fs/promises";
import { readdirSorted } from "../dummy.registry";
import { tmpdir } from "os";
import { fork, ChildProcess } from "child_process";
import { beforeAll, afterAll, beforeEach, afterEach, test, expect, describe } from "bun:test";

var verdaccioServer: ChildProcess;
var testCounter: number = 0;
var port: number = 4873;
var packageDir: string;

ignoreMimallocWarning({ beforeAll, afterAll });

// beforeAll(async done => {
//   verdaccioServer = fork(
//     await import.meta.resolve("verdaccio/bin/verdaccio"),
//     ["-c", join(import.meta.dir, "verdaccio.yaml"), "-l", `${port}`],
//     { silent: true, execPath: "bun" },
//   );

//   verdaccioServer.on("message", (msg: { verdaccio_started: boolean }) => {
//     if (msg.verdaccio_started) {
//       done();
//     }
//   });
// });

// afterAll(() => {
//   verdaccioServer.kill();
// });

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
    " + no-deps@1.0.0",
    " + one-range-dep@1.0.0",
    "",
    " 2 packages installed",
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
    " + uses-what-bin@1.5.0",
    " + what-bin@1.0.0",
    "",
    expect.stringContaining("3 packages installed"),
  ]);
  expect(await exited).toBe(0);
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
    if (!err.includes("mimalloc: warning")) {
      expect(err).not.toContain("error:");
    }
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
      if (!err.includes("mimalloc: warning")) {
        expect(err).not.toContain("error:");
      }
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
      if (!err.includes("mimalloc: warning")) {
        expect(err).not.toContain("error:");
      }
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
        if (!err.includes("mimalloc: warning")) {
          expect(err).not.toContain("error:");
        }
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
        if (!err.includes("mimalloc: warning")) {
          expect(err).not.toContain("error:");
        }
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
        if (!err.includes("mimalloc: warning")) {
          expect(err).not.toContain("error:");
        }
        expect(out).not.toContain("package installed");
        expect(await exited).toBe(0);
        expect(await file(join(packageDir, "node_modules", "a-dep", "package.json")).text()).toContain(expected);
      });
    }
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
          " + pkg1@workspace:packages/pkg1",
          " + pkg2@workspace:packages/pkg2",
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
          " + pkg1@workspace:packages/pkg1",
          " + pkg2@workspace:packages/pkg2",
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
          " + pkg1@workspace:packages/pkg1",
          " + pkg2@workspace:packages/pkg2",
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
          " + pkg1@workspace:packages/pkg1",
          " + pkg2@workspace:packages/pkg2",
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
        " + workspace-1@workspace:packages/workspace-1",
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
        " + workspace-1@workspace:packages/workspace-1",
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
        " + workspace-1@workspace:packages/workspace-1",
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
        " + workspace-1@workspace:packages/workspace-1",
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
    " + uses-what-bin@1.5.0",
    " + what-bin@1.0.0",
    "",
    expect.stringContaining("3 packages installed"),
  ]);
  expect(await exited).toBe(0);
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
      " + a@workspace:packages/a",
      " + b@workspace:packages/b",
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
      " + no-deps@2.0.0",
      " + peer-deps-fixed@1.0.0",
      "",
      " 2 packages installed",
    ]);
    expect(await readdirSorted(join(packageDir, "node_modules"))).toEqual([".cache", "no-deps", "peer-deps-fixed"]);
    expect(await exited).toBe(0);
  });

  test.todo(
    "it should install in such a way that two identical packages with different peer dependencies are different instances",
    async () => {
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
      expect(out).toBe("true\ntrue\ntrue");
      expect(err).toBeEmpty();
      expect(await exited).toBe(0);
    },
  );

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
});
