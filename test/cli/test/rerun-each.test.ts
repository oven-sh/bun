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

// Preload-level beforeAll/afterAll are the setup and teardown of the whole run. A rerun of the first
// file must not set up again, and a rerun of the last file must not run after the teardown.
// --isolate keeps the pair around every run of every file.
describe("--rerun-each and preload-level beforeAll/afterAll", () => {
  const files = {
    "preload.ts": `
      import { beforeAll, afterAll } from "bun:test";
      beforeAll(() => console.log("preload beforeAll"));
      afterAll(() => console.log("preload afterAll"));
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
    "throws-on-second-run.test.ts": `
      import { test } from "bun:test";
      if (globalThis.loadedOnce) throw new Error("this file fails to load on its second run");
      globalThis.loadedOnce = true;
      test("d", () => console.log("test d"));
    `,
    // The rejection is reported while the module waits.
    "stray.test.ts": `
      Promise.reject(new Error("stray rejection"));
      await new Promise(resolve => setImmediate(resolve));
      throw new Error("this file fails to load");
    `,
    // The rejection is reported during the first load only, and the file loads.
    "stray-on-first-run.test.ts": `
      import { test } from "bun:test";
      if (!globalThis.strayedOnce) {
        globalThis.strayedOnce = true;
        Promise.reject(new Error("stray rejection"));
      }
      test("e", () => console.log("test e"));
    `,
  };

  async function run(args: string[], extraFiles: Record<string, string> = {}) {
    using dir = tempDir("test-rerun-each-preload-hooks", { ...files, ...extraFiles });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // A --parallel worker's console.log arrives on the coordinator's stderr.
    return { events: (stdout + stderr).match(/^(preload|test) .+$/gm), exitCode };
  }

  const preload = ["--preload", "./preload.ts"];
  const before = "preload beforeAll";
  const after = "preload afterAll";

  test.concurrent.each([
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
      name: "once when the last file fails to load on its second run",
      args: ["--rerun-each=3", "./a.test.ts", "./throws-on-second-run.test.ts"],
      events: [before, "test a", "test a", "test a", "test d", after],
      exitCode: 1,
    },
    {
      name: "once when the first file fails to load",
      args: ["--rerun-each=2", "./throws.test.ts", "./a.test.ts"],
      events: [before, "test a", "test a", after],
      exitCode: 1,
    },
    {
      name: "once when the first file fails to load after a stray rejection",
      args: ["--rerun-each=2", "./stray.test.ts", "./a.test.ts"],
      events: [before, "test a", "test a", after],
      exitCode: 1,
    },
  ])("$name", async ({ args, events, exitCode }) => {
    expect(await run([...preload, ...args])).toEqual({ events, exitCode });
  });

  test.concurrent("once around two files, and around every run with --isolate", async () => {
    const [shared, isolated] = await Promise.all([
      run([...preload, "--rerun-each=2", "./a.test.ts", "./b.test.ts"]),
      run([...preload, "--rerun-each=2", "--isolate", "./a.test.ts", "./b.test.ts"]),
    ]);
    expect(shared).toEqual({ events: [before, "test a", "test a", "test b", "test b", after], exitCode: 0 });
    expect(isolated).toEqual({
      events: [before, "test a", after, before, "test a", after, before, "test b", after, before, "test b", after],
      exitCode: 0,
    });
  });

  test.concurrent("once when the last file fails to load after a stray rejection", async () => {
    const [twice, once] = await Promise.all([
      run([...preload, "--rerun-each=2", "./a.test.ts", "./stray.test.ts"]),
      run([...preload, "./a.test.ts", "./stray.test.ts"]),
    ]);
    expect(twice).toEqual({ events: [before, "test a", "test a", after], exitCode: 1 });
    expect(once).toEqual({ events: [before, "test a", after], exitCode: 1 });
  });

  test.concurrent("once when a rejection is reported during the first load of the last file", async () => {
    const { events, exitCode } = await run([
      ...preload,
      "--rerun-each=2",
      "./a.test.ts",
      "./stray-on-first-run.test.ts",
    ]);
    // Only the hooks: the rejection decides how many of the file's own tests run.
    expect({ hooks: events?.filter(event => event.startsWith("preload")), last: events?.at(-1), exitCode }).toEqual({
      hooks: [before, after],
      last: after,
      exitCode: 1,
    });
  });

  // A worker does not know which file is its last, so the hooks wrap every file it runs.
  test.concurrent("once around every file in a --parallel --no-isolate worker", async () => {
    // The huge scale-up delay keeps both files on one worker, so the events arrive in order.
    const { events, exitCode } = await run([
      ...preload,
      "--rerun-each=2",
      "--parallel=2",
      "--parallel-delay=1000000",
      "--no-isolate",
      "./throws.test.ts",
      "./a.test.ts",
    ]);
    // The worker can get the files in either order, so compare what each "preload beforeAll" starts.
    const perFile = events?.join(",").split(new RegExp(`,(?=${before})`));
    expect(perFile?.sort()).toEqual([[before, after].join(","), [before, "test a", "test a", after].join(",")]);
    expect(exitCode).toBe(1);
  });

  test.concurrent("once with rerunEach and preload in bunfig.toml", async () => {
    const result = await run(["./a.test.ts", "./b.test.ts"], {
      "bunfig.toml": `[test]\nrerunEach = 2\npreload = ["./preload.ts"]\n`,
    });
    expect(result).toEqual({ events: [before, "test a", "test a", "test b", "test b", after], exitCode: 0 });
  });
});
