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

// What a test file imports is loaded once, and the end of each run drops what was registered for the file.
// So a module whose top level registers something is evaluated again for the next run.
describe("what a module registers when it is imported exists in every run of the file", () => {
  async function runTests(files: Record<string, string>, args: string[]) {
    using dir = tempDir("test-rerun-each-registrant", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args],
      env: { ...bunEnv, CI: "false" },
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      log: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")),
      results: stderr
        .split("\n")
        .filter(line => /^\((pass|fail)\)/.test(line))
        .map(line => line.replace(/ \[[\d.]+ms\]$/, "")),
      exitCode,
    };
  }

  // The second test fails unless the module's `afterEach` ran after the first.
  const counts = `
    test("one", () => { expect(++state.mounted).toBe(1); });
    test("two", () => { expect(++state.mounted).toBe(1); });
  `;
  const hooks = {
    "helper.js": `
      import { afterAll, afterEach, beforeAll, beforeEach } from "bun:test";
      export const state = { mounted: 0 };
      beforeAll(() => console.log("beforeAll"));
      beforeEach(() => console.log("beforeEach"));
      afterEach(() => { state.mounted = 0; });
      afterAll(() => console.log("afterAll"));
    `,
    "a.test.js": `
      import { expect, test } from "bun:test";
      import { state } from "./helper.js";
      ${counts}
    `,
  };
  const everyRun = { results: ["(pass) one", "(pass) two", "(pass) one", "(pass) two"], exitCode: 0 };

  test.each([[[]], [["--isolate"]], [["--isolate=modules"]]])("hooks %j", async flags => {
    expect(await runTests(hooks, ["a.test.js", "--rerun-each=2", ...flags])).toEqual({
      log: Array(2).fill(["beforeAll", "beforeEach", "beforeEach", "afterAll"]).flat(),
      ...everyRun,
    });
  });

  test("hooks, --parallel", async () => {
    const files = { ...hooks, "b.test.js": hooks["a.test.js"] };
    const { results, exitCode } = await runTests(files, ["--parallel=2", "--rerun-each=2"]);
    expect({ results: results.sort(), exitCode }).toEqual({
      results: [...Array(4).fill("(pass) one"), ...Array(4).fill("(pass) two")],
      exitCode: 0,
    });
  });

  test("tests and describe blocks", async () => {
    const { results, exitCode } = await runTests(
      {
        "shared.js": `
          import { describe, test } from "bun:test";
          describe("shared", () => { test("in the module", () => {}); });
        `,
        "a.test.js": `
          import { test } from "bun:test";
          import "./shared.js";
          test("in the file", () => {});
        `,
      },
      ["a.test.js", "--rerun-each=2"],
    );
    expect({ results, exitCode }).toEqual({
      results: Array(2).fill(["(pass) shared > in the module", "(pass) in the file"]).flat(),
      exitCode: 0,
    });
  });

  test(`a CommonJS package that calls globalThis.afterEach() under globals = "vitest"`, async () => {
    const { results, exitCode } = await runTests(
      {
        "bunfig.toml": `[test]\nglobals = "vitest"\n`,
        "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js" }`,
        "node_modules/pkg/index.js": `
          const state = { mounted: 0 };
          if (typeof globalThis.afterEach === "function") globalThis.afterEach(() => { state.mounted = 0; });
          module.exports = { state };
        `,
        "a.test.js": `
          import { state } from "pkg";
          ${counts}
        `,
      },
      ["a.test.js", "--rerun-each=2"],
    );
    expect({ results, exitCode }).toEqual(everyRun);
  });

  test("stubs and spies", async () => {
    const { log, exitCode } = await runTests(
      {
        "helper.js": `
          import { vi } from "vitest";
          vi.stubGlobal("STUBBED", 1);
          vi.stubEnv("STUBBED_ENV", "1");
          export const object = { method() { return "real"; } };
          vi.spyOn(object, "method").mockReturnValue("spied");
        `,
        "a.test.js": `
          import { test } from "vitest";
          import { object } from "./helper.js";
          test("one", () => console.log(globalThis.STUBBED, process.env.STUBBED_ENV, object.method()));
        `,
      },
      ["a.test.js", "--rerun-each=2"],
    );
    expect({ log, exitCode }).toEqual({ log: ["1 1 spied", "1 1 spied"], exitCode: 0 });
  });

  test("vi.setConfig(), fake timers and the system time", async () => {
    const { log, exitCode } = await runTests(
      {
        "helper.js": `
          import { vi } from "vitest";
          vi.setConfig({ testTimeout: 1234 });
          vi.useFakeTimers();
          vi.setSystemTime(new Date("2020-01-02T03:04:05Z"));
        `,
        "a.test.js": `
          import { test, vi } from "vitest";
          import "./helper.js";
          test("one", ({ task }) => console.log(task.timeout, vi.isFakeTimers(), new Date().toISOString()));
        `,
      },
      ["a.test.js", "--rerun-each=2"],
    );
    expect({ log, exitCode }).toEqual({ log: Array(2).fill("1234 true 2020-01-02T03:04:05.000Z"), exitCode: 0 });
  });

  test.each([[[]], [["--isolate"]]])("test.override() %j", async flags => {
    const { results, exitCode } = await runTests(
      {
        "fixtures.ts": `
          import { test } from "bun:test";
          export const base = test.extend({ url: "http://localhost" });
        `,
        "setup.ts": `
          import { base } from "./fixtures";
          export const test = base.override({ url: "http://staging" });
        `,
        "a.test.ts": `
          import { expect } from "bun:test";
          import { test } from "./setup";
          test("one", ({ url }) => { expect(url).toBe("http://staging"); });
        `,
      },
      ["a.test.ts", "--rerun-each=2", ...flags],
    );
    expect({ results, exitCode }).toEqual({ results: ["(pass) one", "(pass) one"], exitCode: 0 });
  });

  test("node:test hooks", async () => {
    const { results, exitCode } = await runTests(
      {
        "helper.js": `
          import { afterEach } from "node:test";
          export const state = { mounted: 0 };
          afterEach(() => { state.mounted = 0; });
        `,
        "a.test.js": `
          import assert from "node:assert";
          import { test } from "node:test";
          import { state } from "./helper.js";
          test("one", () => { assert.strictEqual(++state.mounted, 1); });
          test("two", () => { assert.strictEqual(++state.mounted, 1); });
        `,
      },
      ["a.test.js", "--rerun-each=2"],
    );
    expect({ results, exitCode }).toEqual(everyRun);
  });

  test("a hook registered after a top-level await", async () => {
    const { results, exitCode } = await runTests(
      {
        "helper.js": `
          import { afterEach } from "bun:test";
          export const state = { mounted: 0 };
          await Promise.resolve();
          afterEach(() => { state.mounted = 0; });
        `,
        "a.test.js": hooks["a.test.js"],
      },
      ["a.test.js", "--rerun-each=2"],
    );
    expect({ results, exitCode }).toEqual(everyRun);
  });

  test("a module that a describe() callback requires", async () => {
    const { results, exitCode } = await runTests(
      {
        "helper.cjs": `
          const { afterEach } = require("bun:test");
          exports.state = { mounted: 0 };
          afterEach(() => { exports.state.mounted = 0; });
        `,
        "a.test.js": `
          import { describe, expect, test } from "bun:test";
          describe("block", () => {
            const { state } = require("./helper.cjs");
            ${counts}
          });
        `,
      },
      ["a.test.js", "--rerun-each=2"],
    );
    expect({ results, exitCode }).toEqual({
      results: Array(2).fill(["(pass) block > one", "(pass) block > two"]).flat(),
      exitCode: 0,
    });
  });

  test.each([[[]], [["--isolate"]]])(
    "only that module and its importers are evaluated again, not what it imports %j",
    async flags => {
      const { log, results, exitCode } = await runTests(
        {
          "dependency.js": `
            globalThis.loads ??= { dependency: 0, registrant: 0, wrapper: 0 };
            loads.dependency++;
            export const state = { mounted: 0 };
          `,
          "registrant.js": `
            import { afterEach } from "bun:test";
            import { state } from "./dependency.js";
            loads.registrant++;
            afterEach(() => { state.mounted = 0; });
            export { state };
          `,
          "wrapper.js": `
            export { state } from "./registrant.js";
            loads.wrapper++;
          `,
          "a.test.js": `
            import { afterAll, expect, test } from "bun:test";
            import { state } from "./wrapper.js";
            ${counts}
            afterAll(() => console.log(JSON.stringify(loads)));
          `,
        },
        ["a.test.js", "--rerun-each=3", ...flags],
      );
      expect({ log, results, exitCode }).toEqual({
        log: [1, 2, 3].map(run => JSON.stringify({ dependency: 1, registrant: run, wrapper: run })),
        results: Array(3).fill(["(pass) one", "(pass) two"]).flat(),
        exitCode: 0,
      });
    },
  );

  test("a module whose function the test file calls is evaluated once", async () => {
    const { log, results, exitCode } = await runTests(
      {
        "helper.js": `
          import { afterEach } from "bun:test";
          globalThis.helperLoads = (globalThis.helperLoads ?? 0) + 1;
          export const state = { mounted: 0 };
          export function useCleanup() { afterEach(() => { state.mounted = 0; }); }
        `,
        "a.test.js": `
          import { afterAll, expect, test } from "bun:test";
          import { state, useCleanup } from "./helper.js";
          useCleanup();
          ${counts}
          afterAll(() => console.log("helper loads:", helperLoads));
        `,
      },
      ["a.test.js", "--rerun-each=3"],
    );
    expect({ log, results, exitCode }).toEqual({
      log: Array(3).fill("helper loads: 1"),
      results: Array(3).fill(["(pass) one", "(pass) two"]).flat(),
      exitCode: 0,
    });
  });

  test("a module that is evaluated again adds its equality testers and snapshot serializers once", async () => {
    const registers = `
      expect.addEqualityTesters([() => undefined]);
      expect.addSnapshotSerializer({ test: () => false, serialize: () => "" });
    `;
    const { log, exitCode } = await runTests(
      {
        "registrant.js": `
          import { afterEach, expect } from "bun:test";
          ${registers}
          afterEach(() => {});
        `,
        "mocks.js": `
          import { expect, mock } from "bun:test";
          ${registers}
          mock.module("./mocked.js", () => ({ value: "mocked" }));
        `,
        "mocked.js": `export const value = "real";`,
        "stays.js": `
          import { expect } from "bun:test";
          globalThis.staysLoads = (globalThis.staysLoads ?? 0) + 1;
          ${registers}
        `,
        "a.test.js": `
          import { expect, test } from "bun:test";
          import "./registrant.js";
          import "./mocks.js";
          import "./stays.js";
          test("one", () => {
            let testers = -1;
            expect.extend({ toCountTesters() { testers = this.customTesters.length; return { pass: true, message: () => "" }; } });
            expect(1).toCountTesters();
            let serializers = -1;
            expect.addSnapshotSerializer({
              test: value => value === "counts",
              serialize: (value, config) => ((serializers = config.plugins.length - 1), "counted"),
            });
            expect("counts").toMatchInlineSnapshot("counted");
            console.log(JSON.stringify({ testers, serializers, staysLoads }));
          });
        `,
      },
      ["a.test.js", "--rerun-each=3"],
    );
    expect({ log, exitCode }).toEqual({
      log: Array(3).fill(JSON.stringify({ testers: 3, serializers: 3, staysLoads: 1 })),
      exitCode: 0,
    });
  });

  test("a module that a preload loaded is evaluated once, and its hook runs once per test", async () => {
    const { log, exitCode } = await runTests(
      {
        "helper.js": `
          import { afterEach } from "bun:test";
          globalThis.helperLoads = (globalThis.helperLoads ?? 0) + 1;
          afterEach(() => console.log("afterEach, helper loads:", helperLoads));
        `,
        "setup.js": `import "./helper.js";`,
        "a.test.js": `
          import { test } from "bun:test";
          import "./helper.js";
          test("one", () => {});
        `,
      },
      ["--preload=./setup.js", "a.test.js", "--rerun-each=2"],
    );
    expect({ log, exitCode }).toEqual({ log: Array(2).fill("afterEach, helper loads: 1"), exitCode: 0 });
  });

  test("the next test file still shares the module, and does not get its hook", async () => {
    const file = (name: string) => `
      import { test } from "bun:test";
      import "./helper.js";
      test("${name}", () => console.log("${name}"));
    `;
    const { log, exitCode } = await runTests(
      {
        "helper.js": `
          import { afterEach } from "bun:test";
          globalThis.helperLoads = (globalThis.helperLoads ?? 0) + 1;
          afterEach(() => console.log("afterEach, helper loads:", helperLoads));
        `,
        "a.test.js": file("a"),
        "b.test.js": file("b"),
      },
      ["a.test.js", "b.test.js", "--rerun-each=2"],
    );
    expect({ log, exitCode }).toEqual({
      log: ["a", "afterEach, helper loads: 1", "a", "afterEach, helper loads: 2", "b", "b"],
      exitCode: 0,
    });
  });
});
