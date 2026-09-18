import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("--rerun-each should run tests exactly N times", async () => {
  using dir = tempDir("test-rerun-each", {
    "counter.test.ts": `
      import { test, expect } from "bun:test";

      // Use a global counter that persists across module reloads
      if (!globalThis.testRunCounter) {
        globalThis.testRunCounter = 0;
      }

      test("should increment counter", () => {
        globalThis.testRunCounter++;
        console.log(\`Run #\${globalThis.testRunCounter}\`);
        expect(true).toBe(true);
      });
    `,
  });

  // Test with --rerun-each=3
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "counter.test.ts", "--rerun-each=3"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);

  // Should see "Run #1", "Run #2", "Run #3" in the output
  expect(stdout).toContain("Run #1");
  expect(stdout).toContain("Run #2");
  expect(stdout).toContain("Run #3");

  // Should NOT see "Run #4"
  expect(stdout).not.toContain("Run #4");

  // Should run exactly 3 tests - check stderr for test summary
  const combined = stdout + stderr;
  expect(combined).toMatch(/3 pass/);

  // Test with --rerun-each=1 (should run once)
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "test", "counter.test.ts", "--rerun-each=1"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

  expect(exitCode2).toBe(0);
  const combined2 = stdout2 + stderr2;
  expect(combined2).toMatch(/1 pass/);
});

test("--rerun-each should report correct file count", async () => {
  using dir = tempDir("test-rerun-each-file-count", {
    "test1.test.ts": `
      import { test, expect } from "bun:test";
      test("test in file 1", () => {
        expect(true).toBe(true);
      });
    `,
  });

  // Run with --rerun-each=3
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "test1.test.ts", "--rerun-each=3"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);

  // Should report "Ran 3 tests across 1 file" not "across 3 files"
  const combined = stdout + stderr;
  expect(combined).toContain("Ran 3 tests across 1 file");
  expect(combined).not.toContain("across 3 files");
});

test("--rerun-each should handle test failures correctly", async () => {
  using dir = tempDir("test-rerun-each-fail", {
    "fail.test.ts": `
      import { test, expect } from "bun:test";

      if (!globalThis.failCounter) {
        globalThis.failCounter = 0;
      }

      test("fails on second run", () => {
        globalThis.failCounter++;
        console.log(\`Attempt #\${globalThis.failCounter}\`);
        // Fail on the second run
        expect(globalThis.failCounter).not.toBe(2);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "fail.test.ts", "--rerun-each=3"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should have non-zero exit code due to failure
  expect(exitCode).not.toBe(0);

  // Should see all three attempts
  expect(stdout).toContain("Attempt #1");
  expect(stdout).toContain("Attempt #2");
  expect(stdout).toContain("Attempt #3");

  // Should report 2 passes and 1 failure - check both stdout and stderr
  const combined = stdout + stderr;
  expect(combined).toMatch(/2 pass/);
  expect(combined).toMatch(/1 fail/);
});

// https://github.com/oven-sh/bun/issues/23705
test("--rerun-each resets the toMatchSnapshot() counter between reruns", async () => {
  using dir = tempDir("test-rerun-each-snapshot", {
    "snap.test.ts": `
      import { test, expect } from "bun:test";
      test("snap", () => {
        expect("hello").toMatchSnapshot();
      });
    `,
    "__snapshots__/snap.test.ts.snap":
      "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n" + '\nexports[`snap 1`] = `"hello"`;\n',
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "snap.test.ts", "--rerun-each=3"],
    env: { ...bunEnv, CI: "true" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const combined = stdout + stderr;

  expect(combined).not.toContain("Snapshot creation is disabled");
  expect(combined).toMatch(/3 pass/);
  expect(combined).toMatch(/0 fail/);
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/23705 — same counter bug via { retry } / { repeats }
test("toMatchSnapshot() counter is reset between per-test retry / repeats", async () => {
  using dir = tempDir("test-retry-snapshot", {
    "snap.test.ts": `
      import { test, expect } from "bun:test";
      let n = 0;
      test("retried", () => {
        expect("a").toMatchSnapshot();
        if (++n < 3) throw new Error("retry me");
      }, { retry: 3 });
      test("repeated", () => {
        expect("b").toMatchSnapshot();
      }, { repeats: 2 });
      test("after", () => {
        expect("c").toMatchSnapshot();
        expect("d").toMatchSnapshot();
      });
    `,
    "__snapshots__/snap.test.ts.snap":
      "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n" +
      '\nexports[`retried 1`] = `"a"`;\n' +
      '\nexports[`repeated 1`] = `"b"`;\n' +
      '\nexports[`after 1`] = `"c"`;\n' +
      '\nexports[`after 2`] = `"d"`;\n',
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "snap.test.ts"],
    env: { ...bunEnv, CI: "true" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const combined = stdout + stderr;

  expect(combined).not.toContain("Snapshot creation is disabled");
  expect(combined).toMatch(/3 pass/);
  expect(combined).toMatch(/0 fail/);
  expect(exitCode).toBe(0);
});

test("--rerun-each re-evaluates a file whose path is not ASCII", async () => {
  using dir = tempDir("test-rerun-each-dír-ñ", {
    "counter.test.ts": `
      import { test, expect } from "bun:test";
      globalThis.testRunCounter = (globalThis.testRunCounter ?? 0) + 1;
      test("evaluated", () => {
        console.log(\`Run #\${globalThis.testRunCounter}\`);
        expect(true).toBe(true);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "counter.test.ts", "--rerun-each=3"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.match(/Run #\d/g)).toEqual(["Run #1", "Run #2", "Run #3"]);
  expect(stdout + stderr).toMatch(/3 pass/);
  expect(exitCode).toBe(0);
});

// Preload-level beforeAll/afterAll are the setup and teardown of the whole run. Without --isolate
// the reruns share one global, so a rerun of the first file must not set up again and a rerun of
// the last file must not run after the teardown.
describe("--rerun-each and preload-level beforeAll/afterAll", () => {
  const files = {
    "preload.ts": `
      import { beforeAll, afterAll } from "bun:test";
      beforeAll(() => console.log("preload beforeAll"));
      afterAll(() => console.log("preload afterAll"));
    `,
    "preload-async.ts": `
      import { beforeAll, afterAll } from "bun:test";
      beforeAll(() => console.log("preload beforeAll"));
      afterAll(async () => {
        await new Promise(resolve => setImmediate(resolve));
        console.log("preload afterAll");
      });
    `,
    "preload-fails.ts": `
      import { beforeAll } from "bun:test";
      beforeAll(async () => {
        await new Promise(resolve => setImmediate(resolve));
        console.log("preload beforeAll");
        throw new Error("the setup fails");
      });
    `,
    // The helper exits when its stdin closes, so it cannot outlive the run.
    "preload-helper.ts": `
      import { beforeAll, afterAll } from "bun:test";
      let helper;
      beforeAll(() => {
        helper = Bun.spawn([process.execPath, "-e", "process.stdin.resume()"], { stdin: "pipe" });
        console.log("preload beforeAll");
      });
      afterAll(async () => {
        helper.stdin.end();
        await helper.exited;
        console.log("preload afterAll");
      });
    `,
    "a.test.ts": `
      import { test } from "bun:test";
      test("a", () => console.log("test a"));
    `,
    "b.test.ts": `
      import { test } from "bun:test";
      test("b", () => console.log("test b"));
    `,
    "throws.test.ts": `
      import { test } from "bun:test";
      test("c", () => console.log("test c"));
      throw new Error("this file fails to load");
    `,
    // The rejection is reported while the module waits, so the file stops collecting before it fails to load.
    "stray.test.ts": `
      Promise.reject(new Error("stray rejection"));
      await new Promise(resolve => setImmediate(resolve));
      throw new Error("this file fails to load");
    `,
    "timeout.test.ts": `
      import { test } from "bun:test";
      test("times out", () => new Promise(() => {}), 1);
    `,
  };

  async function run(args: string[], preload = "./preload.ts", env = bunEnv) {
    using dir = tempDir("test-rerun-each-preload-hooks", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--preload", preload, ...args],
      env,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // A --parallel worker's console.log arrives on the coordinator's stderr.
    return { events: (stdout + stderr).match(/^(preload|test|killed) .+$/gm), exitCode };
  }

  const before = "preload beforeAll";
  const after = "preload afterAll";

  test.concurrent.each([
    {
      name: "once around two files",
      args: ["--rerun-each=2", "./a.test.ts", "./b.test.ts"],
      events: [before, "test a", "test a", "test b", "test b", after],
      exitCode: 0,
    },
    {
      name: "once around one file",
      args: ["--rerun-each=3", "./a.test.ts"],
      events: [before, "test a", "test a", "test a", after],
      exitCode: 0,
    },
    {
      // A file that fails to load runs none of its tests and is not run again, so its first run is also its last.
      name: "once when the last file fails to load",
      args: ["--rerun-each=2", "./a.test.ts", "./throws.test.ts"],
      events: [before, "test a", "test a", after],
      exitCode: 1,
    },
    {
      name: "once when the first file fails to load",
      args: ["--rerun-each=2", "./throws.test.ts", "./a.test.ts"],
      events: [before, "test a", "test a", after],
      exitCode: 1,
    },
    {
      name: "once when the last file fails to load after a stray rejection",
      args: ["--rerun-each=2", "./a.test.ts", "./stray.test.ts"],
      events: [before, "test a", "test a", after],
      exitCode: 1,
    },
    {
      // The stray rejection makes the file run the beforeAll before it fails to load.
      name: "once when the first file fails to load after a stray rejection",
      args: ["--rerun-each=2", "./stray.test.ts", "./a.test.ts"],
      events: [before, "test a", "test a", after],
      exitCode: 1,
    },
    {
      // The stray rejection makes the file run the afterAll before it fails to load.
      name: "once without --rerun-each when the last file fails to load after a stray rejection",
      args: ["./a.test.ts", "./stray.test.ts"],
      events: [before, "test a", after],
      exitCode: 1,
    },
    {
      name: "to the end of an async afterAll when the last file fails to load",
      preload: "./preload-async.ts",
      args: ["--rerun-each=2", "./a.test.ts", "./throws.test.ts"],
      events: [before, "test a", "test a", after],
      exitCode: 1,
    },
    {
      // The failed beforeAll is the one failure that --bail=1 allows, so no other file runs.
      name: "and --bail counts a hook that fails after the first file fails to load",
      preload: "./preload-fails.ts",
      args: ["--rerun-each=2", "--bail=1", "./throws.test.ts", "./a.test.ts"],
      // A test or hook that reaches --bail exits without the VM teardown, which LeakSanitizer reports (#32183).
      env: { ...bunEnv, ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":") },
      events: [before],
      exitCode: 1,
    },
    {
      // A test that times out kills the processes that tests left behind, not what a preload hook spawned.
      name: "and the helper process of a beforeAll survives a later timeout when the first file fails to load",
      preload: "./preload-helper.ts",
      args: ["--rerun-each=2", "./throws.test.ts", "./timeout.test.ts"],
      events: [before, after],
      exitCode: 1,
    },
    {
      // With --isolate the hooks wrap every run of every file.
      name: "around every run with --isolate",
      args: ["--rerun-each=2", "--isolate", "./a.test.ts", "./b.test.ts"],
      events: [before, "test a", after, before, "test a", after, before, "test b", after, before, "test b", after],
      exitCode: 0,
    },
  ])("$name", async ({ args, preload, env, events, exitCode }) => {
    const result = await run(args, preload, env);
    expect(result.events).toEqual(events);
    expect(result.exitCode).toBe(exitCode);
  });

  // A worker does not know which file is its last, so the hooks wrap every file it runs.
  test.concurrent("once around every file in a --parallel --no-isolate worker", async () => {
    // The huge scale-up delay keeps both files on one worker, so the events arrive in order.
    const result = await run([
      "--rerun-each=2",
      "--parallel=2",
      "--parallel-delay=1000000",
      "--no-isolate",
      "./a.test.ts",
      "./b.test.ts",
    ]);
    // The worker can get the files in either order, so compare what each "preload beforeAll" starts.
    const perFile = result.events?.join(",").split(new RegExp(`,(?=${before})`));
    expect(perFile?.sort()).toEqual([
      [before, "test a", "test a", after].join(","),
      [before, "test b", "test b", after].join(","),
    ]);
    expect(result.exitCode).toBe(0);
  });
});
