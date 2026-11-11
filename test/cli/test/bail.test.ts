import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// What a run does once --bail has stopped it. It starts no other test or file. The tests whose setup or body still
// runs end there with no result and go to their teardown, the blocks that were entered are torn down, and the run ends
// the way every run ends: with the summary and the reports.
// bun-test.test.ts has the tests of the flag's values, coverage.test.ts of --coverage.

async function run(files: Record<string, string>, flags: string[], env: Record<string, string> = {}) {
  using dir = tempDir("bail", files);
  const out = join(String(dir), "out");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...flags.map(flag => flag.replace("<out>", out))],
    env: { ...bunEnv, ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = stderr
    .trimEnd()
    .split(/\r?\n/)
    .map(line => line.replace(/ \[[\d.]+m?s\]$/, ""));
  return {
    stderr,
    // The fixtures print "ran: <name>" from each test and hook that runs.
    ran: stdout
      .split(/\r?\n/)
      .filter(line => line.startsWith("ran: "))
      .map(line => line.slice("ran: ".length)),
    results: lines.filter(line => /^\((pass|fail|skip)\)/.test(line)),
    // --dots doesn't indent the summary.
    seeds: [...stderr.matchAll(/^ ?--seed=(\d+)$/gm)].map(match => match[1]),
    // The lines after the last empty one, which is the summary when the run ended like any other.
    summary: lines.slice(lines.lastIndexOf("") + 1),
    // The file that a flag names with "<out>", if the run wrote it.
    out: existsSync(out) ? readFileSync(out, "utf8") : null,
    exitCode,
  };
}

const around = (failing: string) => `
  import { beforeAll, describe, expect, test } from "bun:test";
  test("passes", () => { console.log("ran: passes"); });
  ${failing}
  test("behind the failure", () => { console.log("ran: behind the failure"); });
`;
const fails = `test("fails", () => { expect(1).toBe(2); });`;
const otherFile = `import { test } from "bun:test"; test("other file", () => { console.log("ran: other file"); });`;

describe.concurrent("a run that --bail stops", () => {
  const failures: [name: string, failing: string, calls: string[]][] = [
    ["a failed assertion", fails, [" 1 expect() calls"]],
    ["a rejected promise", `test("fails", async () => { await 1; throw new Error("rejected"); });`, []],
    ["an error passed to done()", `test("fails", done => { setTimeout(() => done(new Error("done")), 1); });`, []],
    ["a timeout", `test("fails", async () => { await new Promise(() => {}); }, 20);`, []],
    [
      "a missing assertion",
      `test("fails", () => { expect.assertions(2); expect(1).toBe(1); });`,
      [" 1 expect() calls"],
    ],
    [
      "a hook that throws",
      `describe("block", () => {
        beforeAll(() => { throw new Error("hook"); });
        test("in the block", () => { console.log("ran: in the block"); });
      });`,
      [],
    ],
  ];
  test.each(failures)("prints the counts before it says that it bailed out: %s", async (_, failing, calls) => {
    const { ran, summary, exitCode } = await run({ "a.test.ts": around(failing) }, ["--bail"]);
    expect({ ran, summary, exitCode }).toEqual({
      ran: ["passes"],
      summary: [" 1 pass", " 1 fail", ...calls, "Ran 2 tests across 1 file.", "Bailed out after 1 failure"],
      exitCode: 1,
    });
  });

  test("counts every failure up to --bail=2", async () => {
    const failing = `${fails} test("fails again", () => { expect(3).toBe(4); });`;
    const { results, summary, exitCode } = await run({ "a.test.ts": around(failing) }, ["--bail=2"]);
    expect({ results, summary, exitCode }).toEqual({
      results: ["(pass) passes", "(fail) fails", "(fail) fails again"],
      summary: [" 1 pass", " 2 fail", " 2 expect() calls", "Ran 3 tests across 1 file.", "Bailed out after 2 failures"],
      exitCode: 1,
    });
  });

  test("does not say that it bailed out when the count isn't reached", async () => {
    const { summary, exitCode } = await run({ "a.test.ts": around(fails) }, ["--bail=2"]);
    expect({ summary, exitCode }).toEqual({
      summary: [" 2 pass", " 1 fail", " 1 expect() calls", "Ran 3 tests across 1 file."],
      exitCode: 1,
    });
  });

  test("starts no other file", async () => {
    const files = { "a.test.ts": around(fails), "b.test.ts": otherFile };
    const { ran, summary, exitCode } = await run(files, ["--bail"]);
    expect({ ran, summary, exitCode }).toEqual({
      ran: ["passes"],
      summary: [" 1 pass", " 1 fail", " 1 expect() calls", "Ran 2 tests across 1 file.", "Bailed out after 1 failure"],
      exitCode: 1,
    });
  });

  test("does not run the file again under --rerun-each", async () => {
    const file = `
      import { expect, test } from "bun:test";
      const run = (globalThis.runs = (globalThis.runs ?? 0) + 1);
      test("fails in the second run", () => { console.log("ran: first test, run " + run); expect(run).toBe(1); });
      test("behind the failure", () => { console.log("ran: second test, run " + run); });
    `;
    const { ran, summary, exitCode } = await run({ "a.test.ts": file }, ["--bail", "--rerun-each=3"]);
    expect({ ran, summary, exitCode }).toEqual({
      ran: ["first test, run 1", "second test, run 1", "first test, run 2"],
      summary: [" 2 pass", " 1 fail", " 2 expect() calls", "Ran 3 tests across 1 file.", "Bailed out after 1 failure"],
      exitCode: 1,
    });
  });

  test("records no time for the file it stopped", async () => {
    const files = { "a.test.ts": otherFile, "b.test.ts": around(fails), "c.test.ts": otherFile };
    const { out, exitCode } = await run(files, ["--bail", "--timings=<out>", "--update-timings"]);
    expect({ timed: Object.keys(JSON.parse(out ?? "{}").files ?? {}), exitCode }).toEqual({
      timed: ["a.test.ts"],
      exitCode: 1,
    });
  });

  // A file that does not load is a failure and an error between tests.
  const doesNotLoad = `throw new Error("does not load");`;

  test("counts a file that does not load", async () => {
    const files = { "a.test.ts": doesNotLoad, "b.test.ts": otherFile };
    const { ran, summary, exitCode } = await run(files, ["--bail"]);
    expect({ ran, summary, exitCode }).toEqual({
      ran: [],
      summary: [" 0 pass", " 1 fail", " 1 error", "Ran 1 test across 1 file.", "Bailed out after 1 failure"],
      exitCode: 1,
    });
  });

  test("counts the failures that come after the one that stopped it", async () => {
    // The hook of the preload still runs for the file that does not load, and it reaches the count first.
    const files = {
      "preload.ts": `import { beforeAll } from "bun:test"; beforeAll(() => { throw new Error("hook"); });`,
      "a.test.ts": doesNotLoad,
    };
    const { results, summary, exitCode } = await run(files, ["--bail", "--preload=./preload.ts"]);
    expect({ results, summary, exitCode }).toEqual({
      results: ["(fail) (unnamed)"],
      summary: [" 0 pass", " 2 fail", " 1 error", "Ran 2 tests across 1 file.", "Bailed out after 1 failure"],
      exitCode: 1,
    });
  });

  describe("tears down what it entered", () => {
    const hooks = `
      import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
      afterAll(() => console.log("ran: afterAll of the file"));
      afterEach(() => console.log("ran: afterEach"));
      describe("outer", () => {
        beforeAll(() => console.log("ran: beforeAll of outer"));
        afterAll(() => console.log("ran: afterAll of outer"));
        describe("inner", () => {
          afterAll(() => console.log("ran: afterAll of inner"));
          test("fails", () => { console.log("ran: fails"); expect(1).toBe(2); });
          test("behind the failure", () => console.log("ran: behind the failure"));
        });
        describe("later", () => {
          beforeAll(() => console.log("ran: beforeAll of later"));
          afterAll(() => console.log("ran: afterAll of later"));
          test("in a later block", () => console.log("ran: in a later block"));
        });
      });
    `;
    const entered = ["beforeAll of outer", "fails", "afterEach", "afterAll of inner", "afterAll of outer"];

    test("runs each after-hook of the blocks around the failure once, and no hook of a later block", async () => {
      const { ran, results, exitCode } = await run({ "a.test.ts": hooks }, ["--bail"]);
      expect({ ran, results, exitCode }).toEqual({
        ran: [...entered, "afterAll of the file"],
        results: ["(fail) outer > inner > fails"],
        exitCode: 1,
      });
    });

    // A preload tears down after the last file, and the file that --bail stops in is the last one that runs.
    const preload = `
      import { afterAll, aroundAll, beforeAll } from "bun:test";
      aroundAll(async runSuite => {
        console.log("ran: aroundAll of the preload, before the files");
        await runSuite();
        console.log("ran: aroundAll of the preload, after the files");
      });
      beforeAll(() => console.log("ran: beforeAll of the preload"));
      afterAll(() => console.log("ran: afterAll of the preload"));
    `;
    const stopsIn: [where: string, flags: string[], others: Record<string, string>][] = [
      ["the last file", [], {}],
      ["a file before the last one", [], { "b.test.ts": otherFile }],
      ["a file that was to run again", ["--rerun-each=3"], { "b.test.ts": otherFile }],
      ["a file with a global of its own", ["--isolate"], { "b.test.ts": otherFile }],
    ];
    test.each(stopsIn)("runs what a preload tears down, once, when it stops in %s", async (_, flags, others) => {
      const files = { "preload.ts": preload, "a.test.ts": hooks, ...others };
      const { ran, exitCode } = await run(files, ["--bail", "--preload=./preload.ts", ...flags]);
      expect({ ran, exitCode }).toEqual({
        ran: [
          "aroundAll of the preload, before the files",
          "beforeAll of the preload",
          ...entered,
          "afterAll of the file",
          "afterAll of the preload",
          "aroundAll of the preload, after the files",
        ],
        exitCode: 1,
      });
    });

    test("gives that teardown real timers and modules, not the ones of the file it stopped in", async () => {
      const files = {
        "db.ts": `export const close = () => console.log("ran: close of db.ts");`,
        "preload.ts": `
          import { afterAll } from "bun:test";
          import * as db from "./db.ts";
          afterAll(async () => {
            db.close();
            await new Promise(resolve => setTimeout(resolve, 1));
            console.log("ran: timer of the preload");
            setImmediate(() => console.log("ran: immediate of the preload"));
          });
        `,
        "a.test.ts": `
          import { expect, jest, mock, test } from "bun:test";
          mock.module("./db.ts", () => ({ close: () => console.log("ran: mock of a.test.ts") }));
          test("fails", () => { jest.useFakeTimers(); expect(1).toBe(2); });
        `,
        "b.test.ts": otherFile,
      };
      const { ran, results, exitCode } = await run(files, ["--bail", "--preload=./preload.ts"]);
      expect({ ran, results, exitCode }).toEqual({
        ran: ["close of db.ts", "timer of the preload", "immediate of the preload"],
        results: ["(fail) fails"],
        exitCode: 1,
      });
    });

    test("tears down a file-scoped fixture", async () => {
      const file = `
        import { expect, test as base } from "bun:test";
        const test = base.extend({
          db: [
            async ({}, use) => {
              console.log("ran: set up db");
              await use("db");
              console.log("ran: tear down db");
            },
            { scope: "file" },
          ],
        });
        test("fails", ({ db }) => { console.log("ran: fails"); expect(1).toBe(2); });
        test("behind the failure", ({ db }) => { console.log("ran: behind the failure"); });
      `;
      const { ran, exitCode } = await run({ "a.test.ts": file }, ["--bail"]);
      expect({ ran, exitCode }).toEqual({ ran: ["set up db", "fails", "tear down db"], exitCode: 1 });
    });

    test("runs the afterAll of a block whose beforeAll is the failure", async () => {
      const file = `
        import { afterAll, beforeAll, describe, test } from "bun:test";
        describe("block", () => {
          beforeAll(() => { console.log("ran: beforeAll"); throw new Error("hook"); });
          afterAll(() => console.log("ran: afterAll"));
          test("in the block", () => console.log("ran: in the block"));
        });
        describe("later", () => {
          beforeAll(() => console.log("ran: beforeAll of later"));
          test("in a later block", () => console.log("ran: in a later block"));
        });
      `;
      const { ran, exitCode } = await run({ "a.test.ts": file }, ["--bail"]);
      expect({ ran, exitCode }).toEqual({ ran: ["beforeAll", "afterAll"], exitCode: 1 });
    });

    test("counts an after-hook that fails", async () => {
      const file = `
        import { afterAll, expect, test } from "bun:test";
        afterAll(() => { throw new Error("afterAll"); });
        ${fails}
      `;
      const { results, summary, exitCode } = await run({ "a.test.ts": file }, ["--bail"]);
      expect({ results, summary, exitCode }).toEqual({
        results: ["(fail) fails", "(fail) (unnamed)"],
        summary: [
          " 0 pass",
          " 2 fail",
          " 1 expect() calls",
          "Ran 2 tests across 1 file.",
          "Bailed out after 1 failure",
        ],
        exitCode: 1,
      });
    });
  });

  describe("with tests that run at once", () => {
    // No test has a time limit, so a test that the run does not end at once shows as one that never settled.
    const flags = ["--bail", "--timeout=0"];

    // The tests in flight wait for what never comes, or for the afterAll that the stopped run still owes.
    const siblings = (options = "") => `
      import { afterAll, afterEach, expect, test } from "vitest";
      const never = new Promise(() => {});
      const stopped = Promise.withResolvers();
      afterAll(async () => {
        console.log("ran: afterAll");
        stopped.resolve();
        await 1;
        await 1;
      });
      afterEach(({ task }) => console.log("ran: afterEach of " + task.name));
      test.concurrent("in flight", ${options} async ({ signal }) => {
        console.log("ran: in flight");
        signal.addEventListener("abort", () => console.log("ran: abort with " + signal.reason.name));
        await never;
      });
      test.concurrent("reads its signal late", async context => {
        await stopped.promise;
        console.log("ran: late reader sees " + context.signal.reason?.name);
      });
      test.concurrent("fails", async () => { await 1; expect(1).toBe(2); });
      test.concurrent("not started", () => { console.log("ran: not started"); });
      test("behind the group", () => { console.log("ran: behind the group"); });
    `;

    // With retries or repeats the test in flight would have more attempts. It gets none of them.
    test.each(["", "{ retry: 2 },", "{ repeats: 2 },"])(
      "ends the tests that are in flight with their afterEach and no result, and starts no other: %s",
      async options => {
        const files = { "a.test.ts": siblings(options) };
        const { ran, results, summary, exitCode } = await run(files, [...flags, "--max-concurrency=3"]);
        expect({ ran, results, summary, exitCode }).toEqual({
          ran: [
            "in flight",
            "afterEach of fails",
            "abort with AbortError",
            "afterEach of in flight",
            "afterEach of reads its signal late",
            "afterAll",
            "late reader sees AbortError",
          ],
          results: ["(fail) fails", "(skip) in flight", "(skip) reads its signal late"],
          summary: [
            " 0 pass",
            " 2 skip",
            " 1 fail",
            " 1 expect() calls",
            "Ran 3 tests across 1 file.",
            "Bailed out after 1 failure",
          ],
          exitCode: 1,
        });
      },
    );

    test("sends a test that is in a hook before its body or in its body to its teardown", async () => {
      const file = `
        import { afterEach, aroundEach, beforeEach, describe, expect, test } from "bun:test";
        const never = new Promise(() => {});
        afterEach(() => console.log("ran: afterEach"));
        describe("in its beforeEach", () => {
          beforeEach(async () => { await never; });
          test.concurrent("test", () => console.log("ran: body of in its beforeEach"));
        });
        describe("in its aroundEach", () => {
          aroundEach(async runTest => { await never; await runTest(); });
          test.concurrent("test", () => console.log("ran: body of in its aroundEach"));
        });
        describe("in its body", () => {
          aroundEach(async runTest => { await runTest(); console.log("ran: rest of the aroundEach"); });
          test.concurrent("test", async () => { await never; });
        });
        test.concurrent("fails", async () => { await 1; expect(1).toBe(2); });
      `;
      const { ran, results, summary, exitCode } = await run({ "a.test.ts": file }, flags);
      expect({ ran, results, summary, exitCode }).toEqual({
        // The afterEach of the test that fails, of the first test and of the third. Nothing inside the aroundEach of the second has started.
        ran: ["afterEach", "afterEach", "afterEach", "rest of the aroundEach"],
        results: [
          "(fail) fails",
          "(skip) in its beforeEach > test",
          "(skip) in its aroundEach > test",
          "(skip) in its body > test",
        ],
        summary: [
          " 0 pass",
          " 3 skip",
          " 1 fail",
          " 1 expect() calls",
          "Ran 4 tests across 1 file.",
          "Bailed out after 1 failure",
        ],
        exitCode: 1,
      });
    });

    test("tears down the fixture of a test that it ends, and calls back what the test registered", async () => {
      const file = `
        import { afterAll, expect, test as base } from "vitest";
        const never = new Promise(() => {});
        const test = base.extend({
          server: async ({}, use) => {
            console.log("ran: set up the fixture");
            await use("server");
            console.log("ran: tear down the fixture");
          },
        });
        const inBody = Promise.withResolvers();
        afterAll(() => console.log("ran: afterAll"));
        test.concurrent("in flight", async ({ server, onTestFinished, onTestFailed }) => {
          onTestFinished(() => console.log("ran: onTestFinished"));
          onTestFailed(() => console.log("ran: onTestFailed"));
          inBody.resolve();
          await never;
        });
        test.concurrent("fails", async ({}) => { await inBody.promise; expect(1).toBe(2); });
      `;
      const { ran, results, exitCode } = await run({ "a.test.ts": file }, flags);
      expect({ ran, results, exitCode }).toEqual({
        ran: ["set up the fixture", "tear down the fixture", "onTestFinished", "afterAll"],
        results: ["(fail) fails", "(skip) in flight"],
        exitCode: 1,
      });
    });

    test("starts no other hook before the body and no body of a test whose setup ends when the run stops", async () => {
      // The three tests wait in their first beforeEach for the same promise, so all three go on in the same turn.
      const file = `
        import { afterEach, beforeEach, describe, test } from "bun:test";
        const ready = Promise.withResolvers();
        describe("waits", () => {
          beforeEach(async () => { await ready.promise; });
          beforeEach(() => console.log("ran: second beforeEach"));
          afterEach(() => console.log("ran: afterEach"));
          test.concurrent("first", () => { throw new Error("first fails"); });
          test.concurrent("second", () => console.log("ran: body of second"));
          test.concurrent("third", () => console.log("ran: body of third"));
        });
        test.concurrent("lets them go on", () => { ready.resolve(); });
      `;
      const { ran, results, summary, exitCode } = await run({ "a.test.ts": file }, flags);
      expect({ ran, results, summary, exitCode }).toEqual({
        ran: ["second beforeEach", "afterEach", "afterEach", "afterEach"],
        results: ["(pass) lets them go on", "(fail) waits > first", "(skip) waits > second", "(skip) waits > third"],
        summary: [" 1 pass", " 2 skip", " 1 fail", "Ran 4 tests across 1 file.", "Bailed out after 1 failure"],
        exitCode: 1,
      });
    });

    // The callback of the test has settled, and a step of the whole group comes before the step of that result.
    const settled: [how: string, file: string, ran: string[], results: string[]][] = [
      [
        "a matcher that its group held was released",
        `import { afterEach, expect, test } from "bun:test";
        const ready = Promise.withResolvers();
        afterEach(() => console.log("ran: afterEach"));
        test.concurrent("passes", async () => {
          await 1;
          await expect(ready.promise).resolves.toBe("ok");
          console.log("ran: body of passes ends");
        });
        test.concurrent("fails", async () => { ready.resolve("ok"); await 1; throw new Error("fails"); });`,
        ["body of passes ends", "afterEach", "afterEach"],
        ["(fail) fails", "(pass) passes"],
      ],
      [
        "the failure is a test before it that ran out of time",
        `import { afterEach, test } from "bun:test";
        const never = new Promise(() => {});
        const timedOut = Promise.withResolvers();
        afterEach(() => { console.log("ran: afterEach"); timedOut.resolve(); });
        test.concurrent("fails", async () => { await never; }, 20);
        test.concurrent("passes", async () => { await timedOut.promise; console.log("ran: body of passes ends"); });`,
        ["afterEach", "body of passes ends", "afterEach"],
        ["(fail) fails", "(pass) passes"],
      ],
      [
        "its time limit has run out too, and the runner has not looked at it yet",
        `import { afterEach, test } from "bun:test";
        const never = new Promise(() => {});
        const timedOut = Promise.withResolvers();
        let ended = 0;
        // The second afterEach is the one of the test that fails.
        afterEach(() => { console.log("ran: afterEach"); if (++ended === 2) timedOut.resolve(); });
        test.concurrent("fails", async () => { await never; }, 20);
        test.concurrent("passes", async () => { await timedOut.promise; console.log("ran: body of passes ends"); }, 20);
        // Both time limits run out while this test keeps the thread.
        test.concurrent("blocks", () => { const end = performance.now() + 60; while (performance.now() < end); });`,
        ["afterEach", "afterEach", "body of passes ends", "afterEach"],
        ["(pass) blocks", "(fail) fails", "(pass) passes"],
      ],
    ];
    test.each(settled)(
      "gives a test whose body has ended its result and its afterEach: %s",
      async (_, file, ran, results) => {
        const stopped = await run({ "a.test.ts": file }, flags);
        expect({ ran: stopped.ran, results: stopped.results, exitCode: stopped.exitCode }).toEqual({
          ran,
          results,
          exitCode: 1,
        });
      },
    );

    test("does not fail a test in flight that must fail, counts assertions or rejects when its signal aborts", async () => {
      const file = `
        import { drainMicrotasks } from "bun:jsc";
        import { expect, test } from "vitest";
        const never = new Promise(() => {});
        test.fails.concurrent("must fail", async () => { await never; });
        test.concurrent("counts assertions", async ({ expect }) => { expect.assertions(2); await never; });
        test.concurrent("rejects when its signal aborts", ({ signal }) =>
          new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))));
        // The reaction to the rejection runs before the listener returns.
        test.concurrent("has rejected when its signal has aborted", ({ signal }) =>
          new Promise((resolve, reject) =>
            signal.addEventListener("abort", () => { reject(signal.reason); drainMicrotasks(); })));
        test.concurrent("fails", async () => { await 1; expect(1).toBe(2); });
      `;
      const { results, summary, exitCode } = await run({ "a.test.ts": file }, flags);
      expect({ results, summary, exitCode }).toEqual({
        results: [
          "(fail) fails",
          "(skip) must fail",
          "(skip) counts assertions",
          "(skip) rejects when its signal aborts",
          "(skip) has rejected when its signal has aborted",
        ],
        summary: [
          " 0 pass",
          " 4 skip",
          " 1 fail",
          " 1 expect() calls",
          "Ran 5 tests across 1 file.",
          "Bailed out after 1 failure",
        ],
        exitCode: 1,
      });
    });

    test("reports a test in flight as failed only if an assertion of it has failed and no retry is left", async () => {
      const file = `
        import { expect, test } from "vitest";
        const never = new Promise(() => {});
        test.concurrent("has failed", async ({ expect }) => { expect.soft(1).toBe(2); await never; });
        test.concurrent("has failed, with a retry left", { retry: 1 }, async ({ expect }) => { expect.soft(1).toBe(2); await never; });
        test.fails.concurrent("must fail and has failed", async ({ expect }) => { expect.soft(1).toBe(2); await never; });
        test.concurrent("fails", async () => { await 1; expect(1).toBe(2); });
      `;
      const { results, summary, exitCode } = await run({ "a.test.ts": file }, flags);
      expect({ results, summary, exitCode }).toEqual({
        results: [
          "(fail) fails",
          "(fail) has failed",
          "(skip) has failed, with a retry left",
          "(pass) must fail and has failed",
        ],
        summary: [
          " 1 pass",
          " 1 skip",
          " 2 fail",
          " 4 expect() calls",
          "Ran 4 tests across 1 file.",
          "Bailed out after 1 failure",
        ],
        exitCode: 1,
      });
    });

    // What a test that it ended left pending is not an error of the run, and the run does not wait for it.
    // A new expect() that its body makes later belongs to what runs then, as after a timeout.
    const preloadThatCloses = `
      import { afterAll } from "bun:test";
      afterAll(() => { console.log("ran: afterAll of the preload"); globalThis.closeResource(); });
    `;
    const leftBehind: [what: string, files: Record<string, string>, ran: string[]][] = [
      [
        "a matcher that the test did not await",
        {
          "a.test.ts": `import { afterAll, expect, test } from "bun:test";
          const never = new Promise(() => {});
          afterAll(() => console.log("ran: afterAll"));
          test.concurrent("in flight", async () => { await 1; expect(never).resolves.toBe(1); await never; });
          test.concurrent("fails", async () => { await 1; await 1; await 1; throw new Error("fails"); });`,
        },
        ["afterAll"],
      ],
      [
        "a matcher that the test did not await, and that alone keeps the test open",
        {
          "a.test.ts": `import { afterAll, expect, test } from "bun:test";
          afterAll(() => console.log("ran: afterAll"));
          test.concurrent("in flight", async () => { expect(new Promise(() => {})).resolves.toBe(1); });
          test.concurrent("fails", async () => { await 1; throw new Error("fails"); });`,
        },
        ["afterAll"],
      ],
      [
        "a matcher that the test awaits",
        {
          "a.test.ts": `import { afterAll, expect, test } from "bun:test";
          const never = new Promise(() => {});
          afterAll(() => console.log("ran: afterAll"));
          test.concurrent("in flight", async () => { await 1; await expect(never).resolves.toBe(1); });
          test.concurrent("fails", async () => { await 1; await 1; await 1; throw new Error("fails"); });`,
        },
        ["afterAll"],
      ],
      [
        "a matcher of the test that the file holds",
        {
          "a.test.ts": `import { afterAll, expect, test } from "bun:test";
          const never = new Promise(() => {});
          const stopped = Promise.withResolvers();
          afterAll(async () => {
            stopped.resolve();
            await 1;
            await 1;
            console.log("ran: afterAll");
          });
          test.concurrent("in flight", async () => {
            const made = expect(never);
            await stopped.promise;
            console.log("ran: matcher");
            made.resolves.toBe(1);
          });
          test.concurrent("fails", async () => { await 1; throw new Error("fails"); });`,
        },
        ["matcher", "afterAll"],
      ],
      [
        "an error that the test passes to done()",
        {
          "a.test.ts": `import { afterAll, test } from "bun:test";
          const stopped = Promise.withResolvers();
          afterAll(async () => {
            stopped.resolve();
            await 1;
            await 1;
            console.log("ran: afterAll");
          });
          test.concurrent("in flight", done => {
            stopped.promise.then(() => { console.log("ran: done(error)"); done(new Error("late")); });
          });
          test.concurrent("fails", async () => { await 1; throw new Error("fails"); });`,
        },
        ["done(error)", "afterAll"],
      ],
      [
        "an error that the test passes to done() when its signal aborts",
        {
          "a.test.ts": `import { test } from "bun:test";
          import { TestRunner } from "vitest";
          test.concurrent("in flight", done => {
            const { signal } = TestRunner.getCurrentTest().context;
            signal.addEventListener("abort", () => { console.log("ran: done(error)"); done(signal.reason); });
          });
          test.concurrent("fails", async () => { await 1; throw new Error("fails"); });`,
        },
        ["done(error)"],
      ],
      [
        "an error that the test passes to done() while a preload tears down after another file would have run",
        {
          "preload.ts": preloadThatCloses,
          "a.test.ts": `import { test } from "bun:test";
          test.concurrent("in flight", done => {
            globalThis.closeResource = () => { console.log("ran: done(error)"); done(new Error("late")); };
          });
          test.concurrent("fails", async () => { await 1; throw new Error("fails"); });`,
          "b.test.ts": otherFile,
        },
        ["afterAll of the preload", "done(error)"],
      ],
    ];
    test.each(leftBehind)("does not wait for or report %s", async (_, files, expected) => {
      const preload = "preload.ts" in files ? ["--preload=./preload.ts"] : [];
      const { ran, results, summary, exitCode } = await run(files, [...flags, ...preload]);
      expect({ ran, results, summary: summary.filter(line => !line.endsWith("expect() calls")), exitCode }).toEqual({
        ran: expected,
        results: ["(fail) fails", "(skip) in flight"],
        summary: [" 0 pass", " 1 skip", " 1 fail", "Ran 2 tests across 1 file.", "Bailed out after 1 failure"],
        exitCode: 1,
      });
    });

    test("ends a test that waits for a matcher when its body ends while the run ends another test", async () => {
      const file = `
        import { afterAll, afterEach, expect, test } from "bun:test";
        const never = new Promise(() => {});
        const released = Promise.withResolvers();
        let teardowns = 0;
        afterAll(() => console.log("ran: afterAll"));
        // The afterEach of the test that fails runs first, that of the first test that the run ends runs second.
        afterEach(() => { if (++teardowns === 2) released.resolve(); });
        test.concurrent("in flight", async () => { await never; });
        test.concurrent("waits for a matcher", async () => { expect(never).resolves.toBe(1); await released.promise; });
        test.concurrent("fails", async () => { await 1; throw new Error("fails"); });
      `;
      const { ran, results, summary, exitCode } = await run({ "a.test.ts": file }, flags);
      expect({ ran, results, summary: summary.filter(line => !line.endsWith("expect() calls")), exitCode }).toEqual({
        ran: ["afterAll"],
        results: ["(fail) fails", "(skip) in flight", "(skip) waits for a matcher"],
        summary: [" 0 pass", " 2 skip", " 1 fail", "Ran 3 tests across 1 file.", "Bailed out after 1 failure"],
        exitCode: 1,
      });
    });

    test("does not wait for or report a matcher that was called outside a test", async () => {
      const file = `
        import { expect, test } from "bun:test";
        expect(new Promise(() => {})).resolves.toBe(1);
        test("fails", async () => { await 1; throw new Error("fails"); });
      `;
      const { summary, exitCode } = await run({ "a.test.ts": file }, flags);
      expect({ summary, exitCode }).toEqual({
        summary: [" 0 pass", " 1 fail", "Ran 1 test across 1 file.", "Bailed out after 1 failure"],
        exitCode: 1,
      });
    });

    // The stop gives such a test no result, like skip() of Vitest. An error from its teardown does not change that.
    const throws = `() => { throw new Error("afterEach fails"); }`;
    test.each([
      ["bun:test", throws, []],
      ["vitest", throws, []],
      // The hook of the test that fails gives its error to the run, as it does without --bail.
      ["bun:test", `done => { done(new Error("afterEach fails")); }`, [" 1 error"]],
    ])("reports no error from the teardown of a test that it ended: %s, %s", async (from, hook, errors) => {
      const file = `
        import { afterEach, expect, test } from "${from}";
        afterEach(${hook});
        test.concurrent("in flight", async () => { await new Promise(() => {}); });
        test.concurrent("fails", async () => { await 1; expect(1).toBe(2); });
      `;
      const { stderr, results, summary, exitCode } = await run({ "a.test.ts": file }, flags);
      expect({ printed: stderr.match(/^error: afterEach fails$/gm), results, summary, exitCode }).toEqual({
        // The one of the test that fails.
        printed: ["error: afterEach fails"],
        results: ["(fail) fails", "(skip) in flight"],
        summary: [
          " 0 pass",
          " 1 skip",
          " 1 fail",
          ...errors,
          " 1 expect() calls",
          "Ran 2 tests across 1 file.",
          "Bailed out after 1 failure",
        ],
        exitCode: 1,
      });
    });

    // The test has run its body and is in its afterEach when the run stops. The afterEach runs to its end.
    const inTeardown = (options: string, body: string) => `
      import { afterEach, test } from "bun:test";
      const stopped = Promise.withResolvers();
      let waits = false;
      afterEach(async () => {
        if (!waits) return;
        waits = false;
        await stopped.promise;
        console.log("ran: afterEach ends");
      });
      test.concurrent("in its afterEach", ${options} () => {
        console.log("ran: attempt");
        waits = true;
        ${body}
      });
      test.concurrent("fails", async () => { await 1; setImmediate(stopped.resolve); throw new Error("fails"); });
    `;
    test.each([
      ["", "", "(pass) in its afterEach", " 1 pass"],
      // The attempts that decide the result do not run, so the test has none.
      ["{ retry: 1 },", `throw new Error("first attempt");`, "(skip) in its afterEach", " 1 skip"],
      ["{ repeats: 1 },", "", "(skip) in its afterEach", " 1 skip"],
    ])(
      "lets a test that is in its afterEach end, and starts no other attempt of it: %s",
      async (options, body, result, count) => {
        const { ran, results, summary, exitCode } = await run({ "a.test.ts": inTeardown(options, body) }, flags);
        expect({ ran, results, summary: summary.filter(line => line !== " 0 pass"), exitCode }).toEqual({
          ran: ["attempt", "afterEach ends"],
          results: ["(fail) fails", result],
          summary: [count, " 1 fail", "Ran 2 tests across 1 file.", "Bailed out after 1 failure"],
          exitCode: 1,
        });
      },
    );

    test("reports an error that the afterEach of such a test passes to done()", async () => {
      const file = `
        import { afterEach, test } from "bun:test";
        const stopped = Promise.withResolvers();
        let waits = false;
        afterEach(done => {
          if (!waits) return done();
          waits = false;
          stopped.promise.then(() => done(new Error("afterEach failed")));
        });
        test.concurrent("in its afterEach", () => { waits = true; });
        test.concurrent("fails", async () => { await 1; setImmediate(stopped.resolve); throw new Error("fails"); });
      `;
      const { stderr, summary, exitCode } = await run({ "a.test.ts": file }, flags);
      expect({ errors: stderr.match(/^error: afterEach failed$/gm), summary, exitCode }).toEqual({
        errors: ["error: afterEach failed"],
        summary: [" 1 pass", " 1 fail", " 1 error", "Ran 2 tests across 1 file.", "Bailed out after 1 failure"],
        exitCode: 1,
      });
    });

    test("reaches every test in flight when the tests that still run are as many as --max-concurrency allows", async () => {
      // The limit goes down while the group runs. Then the test that is in its afterEach fills it alone.
      const file = `
        import { afterEach, test, vi } from "vitest";
        const never = new Promise(() => {});
        const aborted = Promise.withResolvers();
        let waits = false;
        afterEach(async () => {
          if (!waits) return;
          waits = false;
          await aborted.promise;
          console.log("ran: afterEach ends");
        });
        test.concurrent("in its afterEach", () => { waits = true; });
        test.concurrent("in flight", async ({ signal }) => {
          signal.addEventListener("abort", () => { console.log("ran: abort"); aborted.resolve(); });
          await never;
        });
        test.concurrent("fails", async () => { vi.setConfig({ maxConcurrency: 1 }); await 1; throw new Error("fails"); });
      `;
      const { ran, results, exitCode } = await run({ "a.test.ts": file }, flags);
      expect({ ran, results, exitCode }).toEqual({
        ran: ["abort", "afterEach ends"],
        results: ["(fail) fails", "(skip) in flight", "(pass) in its afterEach"],
        exitCode: 1,
      });
    });

    test("tears down the blocks that a started test is inside, and no block that it started no test of", async () => {
      const file = `
        import { afterAll, describe, expect, test } from "bun:test";
        const failed = Promise.withResolvers();
        describe("a", () => {
          test.concurrent("in flight", async () => { console.log("ran: in flight"); await failed.promise; });
        });
        describe("b", () => {
          afterAll(() => console.log("ran: afterAll of b"));
          describe("entered", () => {
            test.concurrent("fails", async () => { await 1; failed.resolve(); expect(1).toBe(2); });
          });
          describe("not entered", () => {
            afterAll(() => console.log("ran: afterAll of not entered"));
            test.concurrent("not started", () => { console.log("ran: not started"); });
          });
        });
      `;
      const { ran, exitCode } = await run({ "a.test.ts": file }, [...flags, "--max-concurrency=2"]);
      expect({ ran, exitCode }).toEqual({ ran: ["in flight", "afterAll of b"], exitCode: 1 });
    });
  });

  // The script that still runs after the count can end the process, and so can a listener at the end of the run.
  // Each fixture prints "ran: exits" where it does that, which shows that the run got there.
  describe("fails and reports when the script exits with code 0", () => {
    const exits: [name: string, file: string][] = [
      [
        // The test has run its body. It has no result yet, so the report does not count it.
        "from the afterEach of a test that is in it when the run stops",
        `import { afterEach, test } from "bun:test";
        const stopped = Promise.withResolvers();
        let exits = false;
        afterEach(async () => {
          if (!exits) return;
          exits = false;
          await stopped.promise;
          console.log("ran: exits");
          process.exit(0);
        });
        test.concurrent("in its afterEach", () => { exits = true; });
        test.concurrent("fails", async () => { await 1; setImmediate(stopped.resolve); throw new Error("fails"); });`,
      ],
      [
        "from a callback that is due with the failure",
        `import { test } from "bun:test";
        test("fails", async () => {
          await new Promise(resolve => {
            setImmediate(resolve);
            setImmediate(() => { console.log("ran: exits"); process.exit(0); });
          });
          throw new Error("fails");
        });`,
      ],
      [
        "from an after-hook",
        `import { afterAll, test } from "bun:test";
        afterAll(async () => { await 1; console.log("ran: exits"); process.exit(0); });
        test("fails", () => { throw new Error("fails"); });`,
      ],
      [
        "from an 'exit' listener that stores the code",
        `import { test } from "node:test";
        process.on("exit", () => { console.log("ran: exits"); process.exitCode = 0; });
        test("fails", () => { throw new Error("fails"); });`,
      ],
      [
        "from an 'exit' listener that calls process.exit()",
        `import { test } from "node:test";
        process.on("exit", () => { console.log("ran: exits"); process.exit(0); });
        test("fails", () => { throw new Error("fails"); });`,
      ],
      [
        "from an 'exit' listener that stores the code over the one of process.exit()",
        `import { afterAll, test } from "bun:test";
        process.on("exit", () => { console.log("ran: exits"); process.exitCode = 0; });
        afterAll(() => { process.exit(3); });
        test("fails", () => { throw new Error("fails"); });`,
      ],
      [
        // Vitest gives the error to the process, which ends with code 6 because _fatalException is no function.
        "from an 'exit' listener that stores the code over the one of an error that nothing catches",
        `import { afterAll, test } from "vitest";
        process.on("exit", () => { console.log("ran: exits"); process.exitCode = 0; });
        test("fails", () => { throw new Error("fails"); });
        afterAll(async () => {
          process._fatalException = 1;
          setImmediate(() => { throw new Error("not caught"); });
          await new Promise(() => {});
        });`,
      ],
    ];
    test.each(exits)("%s", async (_, file) => {
      const flags = ["--bail", "--reporter=junit", "--reporter-outfile=<out>"];
      const { ran, stderr, summary, out, exitCode } = await run({ "a.test.ts": file }, flags);
      expect({
        ran,
        summary,
        reports: stderr.match(/^Bailed out after/gm)?.length,
        junitFailures: /<testsuites [^>]*failures="(\d+)"/.exec(out ?? "")?.[1],
        junitEnds: out?.match(/<\/testsuites>/g)?.length,
        exitCode,
      }).toEqual({
        ran: ["exits"],
        summary: [" 0 pass", " 1 fail", "Ran 1 test across 1 file.", "Bailed out after 1 failure"],
        reports: 1,
        junitFailures: "1",
        junitEnds: 1,
        exitCode: 1,
      });
    });

    test.each([
      [
        "of process.exit()",
        `import { afterAll, test } from "bun:test";
        afterAll(() => { console.log("ran: exits"); process.exit(3); });
        test("fails", () => { throw new Error("fails"); });`,
      ],
      [
        "that an 'exit' listener stores",
        `import { test } from "node:test";
        process.on("exit", () => { console.log("ran: exits"); process.exitCode = 3; });
        test("fails", () => { throw new Error("fails"); });`,
      ],
    ])("keeps another exit code %s", async (_, file) => {
      const { ran, summary, exitCode } = await run({ "a.test.ts": file }, ["--bail"]);
      expect({ ran, summary, exitCode }).toEqual({
        ran: ["exits"],
        summary: [" 0 pass", " 1 fail", "Ran 1 test across 1 file.", "Bailed out after 1 failure"],
        exitCode: 3,
      });
    });

    test("from the body of a test that it ended", async () => {
      const file = `
        import { afterAll, test } from "bun:test";
        const stopped = Promise.withResolvers();
        afterAll(async () => { stopped.resolve(); await new Promise(() => {}); });
        test.concurrent("in flight", async () => { await stopped.promise; console.log("ran: exits"); process.exit(0); });
        test.concurrent("fails", async () => { await 1; throw new Error("fails"); });
      `;
      const { ran, summary, exitCode } = await run({ "a.test.ts": file }, ["--bail", "--timeout=0"]);
      expect({ ran, summary, exitCode }).toEqual({
        ran: ["exits"],
        summary: [" 0 pass", " 1 skip", " 1 fail", "Ran 2 tests across 1 file.", "Bailed out after 1 failure"],
        exitCode: 1,
      });
    });

    test.each([
      ["process.exit(0)", `process.exit(0);`],
      [
        "process.reallyExit(0) of another realm",
        `process.exitCode = 0; new ShadowRealm().evaluate("process.reallyExit(0)");`,
      ],
    ])("tells 'exit' listeners and process.exitCode the code that the process ends with: %s", async (_, exits) => {
      const file = `
        import { afterAll, test } from "bun:test";
        process.on("exit", code => console.log("ran: listener told " + code + ", exitCode is " + process.exitCode));
        afterAll(() => { ${exits} });
        test("fails", () => { throw new Error("fails"); });
      `;
      const { ran, exitCode } = await run({ "a.test.ts": file }, ["--bail"]);
      expect({ ran, exitCode }).toEqual({ ran: ["listener told 1, exitCode is 1"], exitCode: 1 });
    });
  });

  test("does not wait for the event loop to run dry, where a run without --bail does", async () => {
    const files = {
      "a.test.ts": `
        import { test } from "bun:test";
        process.on("beforeExit", () => console.log("ran: beforeExit"));
        test("fails", () => { setTimeout(() => console.log("ran: timer"), 50); throw new Error("fails"); });
      `,
    };
    const env = { BUN_TEST_DRAIN_EVENT_LOOP: "1" };
    const [stopped, drained] = await Promise.all([run(files, ["--bail"], env), run(files, [], env)]);
    expect({ stopped: stopped.ran, drainedToTheTimer: drained.ran.includes("timer") }).toEqual({
      stopped: [],
      drainedToTheTimer: true,
    });
    expect({ summary: stopped.summary, exitCode: stopped.exitCode }).toEqual({
      summary: [" 0 pass", " 1 fail", "Ran 1 test across 1 file.", "Bailed out after 1 failure"],
      exitCode: 1,
    });
  });

  test("writes no snapshot, and does not say that it added one", async () => {
    const file = `
      import { expect, test } from "bun:test";
      test("has a new snapshot", () => { expect({ a: 1 }).toMatchSnapshot(); });
      ${fails}
    `;
    const { stderr, summary, exitCode } = await run({ "a.test.ts": file }, ["--bail"], { CI: "false" });
    expect({ summary, exitCode }).toEqual({
      summary: [
        " 1 pass",
        " 1 fail",
        " 1 snapshots, 2 expect() calls",
        "Ran 2 tests across 1 file.",
        "Bailed out after 1 failure",
      ],
      exitCode: 1,
    });
    expect(stderr).not.toContain("added");
  });

  // The file is still open when a hook of it ends the process.
  const exitsFromHook = `import { afterAll } from "bun:test"; afterAll(() => process.exit(0));`;
  test.each([
    ["the run ends", ""],
    ["a hook ends the process", exitsFromHook],
  ])("closes the file's group in GitHub Actions once, before the summary, when %s", async (_, hook) => {
    const flags = ["--bail", "--randomize"];
    const file = hook + around(fails);
    const { stderr, exitCode } = await run({ "a.test.ts": file }, flags, { GITHUB_ACTIONS: "true" });
    const lines = ["::group::a.test.ts:", "(fail) fails", "::endgroup::", " --seed=", "Bailed out after 1 failure"];
    const positions = lines.map(line => stderr.indexOf(line));
    expect(positions).not.toContain(-1);
    expect(positions).toEqual(positions.toSorted((a, b) => a - b));
    expect(stderr.match(/^::endgroup::$/gm)).toHaveLength(1);
    expect(exitCode).toBe(1);
  });
});

// Not concurrent with the other tests: it reads the output of a process that stays alive.
// On Windows `bun test --watch` is a parent process that restarts the runner.
test.skipIf(isWindows)("a run that --bail stops keeps watching under --watch", async () => {
  using dir = tempDir("bail-watch", {
    "a.test.ts": `
      import { afterAll, expect, test } from "bun:test";
      afterAll(() => console.error("ran: afterAll"));
      test("fails", () => { expect(1).toBe(2); });
      test("behind the failure", () => {});
    `,
    "b.test.ts": otherFile,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--watch", "--bail", "--no-clear-screen"],
    env: bunEnv,
    cwd: String(dir),
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const reader = proc.stderr.pipeThrough(new TextDecoderStream()).getReader();
  let output = "";
  async function waitFor(needle: string) {
    while (!output.includes(needle)) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`exited before printing ${JSON.stringify(needle)}:\n${output}`);
      output += value;
    }
  }
  await waitFor("Bailed out after 1 failure");
  // Whole lines: the source line of the hook is in the error of the test, and the banner has the count in it.
  expect(output).toMatch(/^ran: afterAll$/m);
  expect(output).toMatch(/^ 1 fail$/m);
  expect(output).not.toContain("(pass)");

  // The run never loaded b.test.ts, and a change to it starts the next run all the same.
  output = "";
  writeFileSync(join(String(dir), "b.test.ts"), otherFile + "\n");
  await waitFor("Bailed out after 1 failure");
  expect(output).toContain("(fail) fails");
});

// The seed is the only way back to the order of a run, so the run that --bail stops has to print it too.
describe.concurrent("a run that --bail stops names the seed", () => {
  // The tenth test to run fails, whichever one that is. The tests before it show the order.
  const tenthFails = (block: "describe" | "describe.shuffle") => `
    import { describe, expect, test } from "bun:test";
    let ran = 0;
    ${block}("block", () => {
      for (let i = 1; i <= 20; i++) {
        test("test " + i, () => {
          console.log("ran: " + i);
          expect(++ran).toBeLessThan(10);
        });
      }
    });
  `;
  const inOrder = Array.from({ length: 10 }, (_, i) => String(i + 1));
  const bailed = { last: "Bailed out after 1 failure", exitCode: 1 };

  async function order(file: string, flags: string[], files: Record<string, string> = {}) {
    const { ran, seeds, summary, exitCode } = await run({ ...files, "a.test.ts": file }, ["--bail", ...flags]);
    return { ran, seeds, last: summary.at(-1), exitCode };
  }

  const shuffled: [block: "describe" | "describe.shuffle", flags: string[]][] = [
    ["describe", ["--randomize"]],
    ["describe", ["--randomize", "--dots"]],
    ["describe", ["--randomize", "--isolate"]],
    ["describe", ["--randomize", "--rerun-each=2"]],
    // With one file there is one worker at most, and then the file runs in this process.
    ["describe", ["--randomize", "--parallel=2"]],
    ["describe.shuffle", []],
  ];
  test.each(shuffled)("and the seed repeats the order: %s %j", async (block, flags) => {
    const file = tenthFails(block);
    const { ran, ...first } = await order(file, flags);
    expect(first).toEqual({ seeds: [expect.stringMatching(/^\d+$/)], ...bailed });
    expect(ran).toHaveLength(10);
    expect(ran).not.toEqual(inOrder);

    const seeded = [...flags.filter(flag => flag !== "--randomize"), "--seed=" + first.seeds[0]];
    expect(await order(file, seeded)).toEqual({ ran, ...first });
  });

  test("of bunfig.toml", async () => {
    const bunfig = { "bunfig.toml": `[test]\nrandomize = true\nseed = 1234\n` };
    const { ran, ...rest } = await order(tenthFails("describe"), [], bunfig);
    expect(rest).toEqual({ seeds: ["1234"], ...bailed });
    expect(ran).not.toEqual(inOrder);
  });

  test("when the failure is a file that does not load", async () => {
    expect(await order(`throw new Error("does not load");`, ["--randomize"])).toEqual({
      ran: [],
      seeds: [expect.stringMatching(/^\d+$/)],
      ...bailed,
    });
  });

  test("only if something was shuffled", async () => {
    expect(await order(tenthFails("describe"), [])).toEqual({ ran: inOrder, seeds: [], ...bailed });
  });
});
