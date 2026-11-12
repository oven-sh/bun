import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

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

test("a retry rolls back only its own attempt's toMatchSnapshot() counters", async () => {
  using dir = tempDir("test-retry-snapshot-own", {
    "snap.test.ts": `
      import { test, expect } from "bun:test";
      import { test as vitestTest } from "vitest";
      test("same name", () => {
        expect("first 1").toMatchSnapshot();
        expect("first 2").toMatchSnapshot();
      });
      let attempts = 0;
      test("same name", () => {
        expect("second 1").toMatchSnapshot();
        expect("hinted").toMatchSnapshot("hint");
        if (++attempts < 3) throw new Error("retry me");
        expect("second 2").toMatchSnapshot();
      }, { retry: 3 });

      const retried = Promise.withResolvers();
      let isRetry = false;
      vitestTest.concurrent("retries", { retry: 1 }, async ({ expect }) => {
        expect("retries 1").toMatchSnapshot();
        if (isRetry) return retried.resolve();
        isRetry = true;
        throw new Error("retry me");
      });
      vitestTest.concurrent("beside it", async ({ expect }) => {
        expect("beside 1").toMatchSnapshot();
        await retried.promise;
        expect("beside 2").toMatchSnapshot();
      });
    `,
    "__snapshots__/snap.test.ts.snap":
      "// Bun Snapshot v1, https://bun.sh/docs/test/snapshots\n" +
      '\nexports[`same name 1`] = `"first 1"`;\n' +
      '\nexports[`same name 2`] = `"first 2"`;\n' +
      '\nexports[`same name 3`] = `"second 1"`;\n' +
      '\nexports[`same name: hint 1`] = `"hinted"`;\n' +
      '\nexports[`same name 4`] = `"second 2"`;\n' +
      '\nexports[`retries 1`] = `"retries 1"`;\n' +
      '\nexports[`beside it 1`] = `"beside 1"`;\n' +
      '\nexports[`beside it 2`] = `"beside 2"`;\n',
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "snap.test.ts"],
    env: { ...bunEnv, CI: "true" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const results = (stdout + stderr).match(/^\((pass|fail)\) [\w ]+/gm)?.map(line => line.trimEnd());
  expect(results?.toSorted()).toEqual(["(pass) beside it", "(pass) retries", "(pass) same name", "(pass) same name"]);
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

// The lines of the summary, without the times.
function summaryOf(stderr: string) {
  return stderr
    .split("\n")
    .map(line => line.trim().replace(/ \[[\d.]+m?s\]$/, ""))
    .filter(line => /^\d+ (pass|skip|fail|error)$|^Ran /.test(line));
}

// Two files, so that --parallel=2 runs them in worker processes. A .js file that uses require() and module is CommonJS too.
async function rerunCommonJSTestFiles(flags: string[]) {
  const source = (file: string) => `
    const { test, expect } = require("bun:test");
    console.log(JSON.stringify({ file: "${file}", evaluation: require("./dep.cjs").countEvaluation("${file}") }));
    test("is the main module", () => {
      expect(require.main).toBe(module);
    });
  `;
  using dir = tempDir("test-rerun-each-cjs", {
    "dep.cjs": `
      const evaluations = {};
      exports.countEvaluation = file => (evaluations[file] = (evaluations[file] ?? 0) + 1);
    `,
    "a.test.cjs": source("a"),
    "b.test.js": source("b"),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--rerun-each=3", ...flags, "./a.test.cjs", "./b.test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // A --parallel worker's console.log arrives on the coordinator's stderr.
  const evaluations: { file: string; evaluation: number }[] = (stdout + stderr)
    .split("\n")
    .filter(line => line.startsWith('{"file"'))
    .map(line => JSON.parse(line))
    .sort((a, b) => a.file.localeCompare(b.file));
  return { evaluations, summary: summaryOf(stderr), exitCode };
}

// dep.cjs stays cached over the reruns of a file and counts every evaluation.
const everyEvaluationCounted = {
  evaluations: [
    { file: "a", evaluation: 1 },
    { file: "a", evaluation: 2 },
    { file: "a", evaluation: 3 },
    { file: "b", evaluation: 1 },
    { file: "b", evaluation: 2 },
    { file: "b", evaluation: 3 },
  ],
  summary: ["6 pass", "0 fail", "Ran 6 tests across 2 files."],
  exitCode: 0,
};
const sharedGlobalModes: [string, string[]][] = [
  ["by default", []],
  ["with --parallel --no-isolate", ["--parallel=2", "--no-isolate"]],
];
const isolatedModes: [string, string[]][] = [
  ["with --isolate", ["--isolate"]],
  ["with --parallel", ["--parallel=2"]],
];

// In these modes the reruns of a file share one module cache.
test.concurrent.each(sharedGlobalModes)(
  "--rerun-each evaluates a CommonJS test file again for every rerun %s",
  async (_, flags) => {
    expect(await rerunCommonJSTestFiles(flags)).toEqual(everyEvaluationCounted);
  },
);

// --isolate and --parallel decide what a rerun shares with the run before it, so this pins only the number of evaluations.
test.concurrent.each(isolatedModes)(
  "--rerun-each evaluates a CommonJS test file again for every rerun %s",
  async (_, flags) => {
    const { evaluations, summary, exitCode } = await rerunCommonJSTestFiles(flags);
    expect({ files: evaluations.map(({ file }) => file), summary, exitCode }).toEqual({
      files: ["a", "a", "a", "b", "b", "b"],
      summary: ["6 pass", "0 fail", "Ran 6 tests across 2 files."],
      exitCode: 0,
    });
  },
);

// The reruns of a file share the module graph of the file, whose require map holds the CommonJS module.
// The timeout is for a debug build that was just linked: its first --isolate=modules run reads much of the binary from disk
// and takes 5.5 s. Every later run takes 1.6 s. Not concurrent, so that this read takes no time from the tests beside it.
test("--rerun-each evaluates a CommonJS test file again for every rerun with --isolate=modules", async () => {
  expect(await rerunCommonJSTestFiles(["--isolate=modules"])).toEqual(everyEvaluationCounted);
}, 30_000);

async function rerunFiles(prefix: string, files: Record<string, string>, ...args: string[]) {
  using dir = tempDir(prefix, files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const snapshots = Object.keys(files).filter(path => path.endsWith(".snap"));
  const written = await Promise.all(snapshots.map(path => Bun.file(join(String(dir), path)).text()));
  return { summary: summaryOf(stderr), exitCode, snapshots: written };
}

// The directory name is not ASCII: the require map key has to match the loader's key for such a path too.
test.concurrent("--rerun-each fails when a CommonJS test file fails or throws in a later run", async () => {
  const ran = await rerunFiles(
    "test-rerun-each-cjs-dír-ñ",
    {
      "fails.test.cjs": `
        const { test, expect } = require("bun:test");
        globalThis.failsRuns = (globalThis.failsRuns ?? 0) + 1;
        test("passes in run 1 only", () => {
          expect(globalThis.failsRuns).toBe(1);
        });
      `,
      "throws.test.cjs": `
        const { test } = require("bun:test");
        globalThis.throwsRuns = (globalThis.throwsRuns ?? 0) + 1;
        if (globalThis.throwsRuns === 2) throw new RangeError("thrown in run 2");
        test("is registered in run 1 only", () => {});
      `,
    },
    "--rerun-each=3",
    "./fails.test.cjs",
    "./throws.test.cjs",
  );
  expect(ran).toEqual({
    summary: ["2 pass", "3 fail", "1 error", "Ran 5 tests across 2 files."],
    exitCode: 1,
    snapshots: [],
  });
});

// The require map also holds the wrapper that require() makes of an ES module. A rerun has to drop the one of run 1.
test.concurrent("--rerun-each gives require() of an ES module test file the exports of the current run", async () => {
  const ran = await rerunFiles(
    "test-rerun-each-esm-required",
    {
      "load.cjs": `module.exports = path => require(path);`,
      "a.test.mjs": `
        import { test, expect } from "bun:test";
        import { createRequire } from "node:module";
        const load = createRequire(import.meta.url)("./load.cjs");
        export const token = {};
        test("require() of this file gives the exports of this run", () => {
          expect(load(import.meta.path).token).toBe(token);
        });
      `,
    },
    "--rerun-each=3",
    "./a.test.mjs",
  );
  expect(ran).toEqual({
    summary: ["3 pass", "0 fail", "Ran 3 tests across 1 file."],
    exitCode: 0,
    snapshots: [],
  });
});

// With --update-snapshots, a run that registers no tests takes the entries of the tests that did not run out of a Jest-format file.
test.concurrent(
  "--rerun-each with --update-snapshots keeps the snapshot of a skipped test of a CommonJS test file",
  async () => {
    const snapshot =
      "// Jest Snapshot v1, https://jestjs.io/docs/snapshot-testing\n" +
      '\nexports[`kept 1`] = `"value"`;\n' +
      '\nexports[`skipped 1`] = `"other"`;\n';
    const ran = await rerunFiles(
      "test-rerun-each-cjs-snapshot",
      {
        "s.test.cjs": `
          const { test, expect } = require("bun:test");
          test("kept", () => {
            expect("value").toMatchSnapshot();
          });
          test.skip("skipped", () => {
            expect("other").toMatchSnapshot();
          });
        `,
        "__snapshots__/s.test.cjs.snap": snapshot,
      },
      "--update-snapshots",
      "--rerun-each=2",
      "./s.test.cjs",
    );
    expect(ran).toEqual({
      summary: ["2 pass", "2 skip", "0 fail", "Ran 4 tests across 1 file."],
      exitCode: 0,
      snapshots: [snapshot],
    });
  },
);
