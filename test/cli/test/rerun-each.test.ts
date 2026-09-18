import { expect, test } from "bun:test";
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

// --parallel isolates too. Two files, so that --parallel=2 runs them in worker processes.
test.concurrent.each(["--isolate", "--parallel=2"])(
  "--rerun-each %s isolates each rerun of a file from the run before it",
  async flag => {
    const leaker = (file: string) => `
      import { test, expect, mock } from "bun:test";
      import * as dep from "./dep.ts";

      test("reports what it starts with, then leaks", async () => {
        console.log(JSON.stringify({
          file: "${file}",
          mocked: dep.v,
          moduleState: dep.bump(),
          global: globalThis.leaked ?? null,
          preloadBeforeAll: globalThis.preloadBeforeAll,
        }));
        globalThis.leaked = "${file}";
        mock.module("./dep.ts", () => ({ v: "mocked" }));
        expect((await import("./dep.ts")).v).toBe("mocked");
      });
    `;
    using dir = tempDir("test-rerun-each-isolate", {
      "dep.ts": `
        export const v = "real";
        let n = 0;
        export function bump() { return ++n; }
      `,
      "preload.ts": `
        import { beforeAll } from "bun:test";
        beforeAll(() => { globalThis.preloadBeforeAll = (globalThis.preloadBeforeAll ?? 0) + 1; });
      `,
      "a.test.ts": leaker("a"),
      "b.test.ts": leaker("b"),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--rerun-each=3", flag, "--preload", "./preload.ts", "./a.test.ts", "./b.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // A --parallel worker's console.log arrives on the coordinator's stderr.
    const runs = (stdout + stderr)
      .split("\n")
      .filter(line => line.startsWith('{"file"'))
      .map(line => JSON.parse(line))
      .sort((a, b) => a.file.localeCompare(b.file));
    const clean = (file: string) => ({ file, mocked: "real", moduleState: 1, global: null, preloadBeforeAll: 1 });
    expect(runs).toEqual([clean("a"), clean("a"), clean("a"), clean("b"), clean("b"), clean("b")]);
    expect(stderr).toMatch(/6 pass/);
    expect(stderr).toMatch(/0 fail/);
    expect(exitCode).toBe(0);
  },
);

test.concurrent("--rerun-each --isolate undoes the file's setDefaultTimeout() between reruns", async () => {
  using dir = tempDir("test-rerun-each-default-timeout", {
    "timeout.test.ts": `
      import { test, setDefaultTimeout } from "bun:test";

      test("outlasts the timeout that the next test sets", async () => {
        await Bun.sleep(50);
      });
      // The global swap closes the socket, so the close handler sets the timeout once more during the swap.
      test("sets a default timeout", async () => {
        setDefaultTimeout(1);
        const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
        const { promise: opened, resolve } = Promise.withResolvers();
        await Bun.connect({
          hostname: "127.0.0.1",
          port: server.port,
          socket: { open: resolve, data() {}, close() { setDefaultTimeout(1); } },
        });
        await opened;
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--rerun-each=3", "--isolate", "timeout.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const results = stderr
    .split("\n")
    .filter(line => /^\((pass|fail)\) /.test(line))
    .map(line => line.replace(/ \[[\d.]+ms\]$/, ""));
  const run = ["(pass) outlasts the timeout that the next test sets", "(pass) sets a default timeout"];
  expect(results).toEqual([...run, ...run, ...run]);
  expect(exitCode).toBe(0);
});

// The preloads run once per global: once per process by default, once per rerun under --isolate.
// The test never settles, so "timed out after Nms" reports the default timeout of that run.
test.concurrent.each([
  ["without --isolate", []],
  ["with --isolate", ["--isolate"]],
])("--rerun-each keeps a preload's setDefaultTimeout() for every rerun %s", async (_, flags) => {
  using dir = tempDir("test-rerun-each-preload-timeout", {
    "preload.ts": `
      import { setDefaultTimeout } from "bun:test";
      setDefaultTimeout(10);
    `,
    "hangs.test.ts": `
      import { test } from "bun:test";
      test("hangs", () => new Promise(() => {}));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--timeout=1000", "--rerun-each=3", ...flags, "--preload=./preload.ts", "hangs.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const timeouts = Array.from(stderr.matchAll(/this test timed out after (\d+)ms/g), match => Number(match[1]));
  expect({ timeouts, exitCode }).toEqual({ timeouts: [10, 10, 10], exitCode: 1 });
});

test.concurrent("--rerun-each --isolate evaluates a CommonJS test file again for every rerun", async () => {
  using dir = tempDir("test-rerun-each-isolate-cjs", {
    "counter.test.cjs": `
      const { test, expect } = require("bun:test");
      console.log("evaluated");
      test("starts in a fresh global", () => {
        expect(globalThis.leaked).toBeUndefined();
        globalThis.leaked = true;
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--rerun-each=3", "--isolate", "counter.test.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.match(/^evaluated$/gm)).toEqual(["evaluated", "evaluated", "evaluated"]);
  expect(stderr).toMatch(/3 pass/);
  expect(stderr).toMatch(/0 fail/);
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
