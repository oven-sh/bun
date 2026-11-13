// Whose rules a hook, a fixture or a callback of the test context follows: those of "vitest" or those of "bun:test".
// Expected outputs for "vitest" were taken from Vitest 5.0.
// Not in vitest-flavor.test.ts: a debug build takes about a minute for that file, and seconds for this one.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isCI, tempDir } from "harness";

// Kills a hung child before this test's own timeout, which would leave it running and lose its output.
// ASAN's leak check makes exit slow, and CI gives ASAN tests minutes.
const beforeTheTestTimesOut = isASAN && isCI ? 60_000 : 4000;

async function runTests(
  files: Record<string, string>,
  args: string[] = [],
  env: Record<string, string> = {},
  killedAfterMs?: number,
) {
  using dir = tempDir("vitest-flavor-hooks", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    env: { ...bunEnv, CI: "false", ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    timeout: killedAfterMs,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = stderr.split("\n");
  return {
    log: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")),
    results: lines
      .filter(line => /^\((pass|fail|skip|todo)\)/.test(line))
      .map(line => line.replace(/ \[[\d.]+ms\]$/, "")),
    errors: lines.filter(line => /^(\w*[eE]rror): /.test(line)),
    stderr,
    exitCode,
  };
}

// Vitest's toEqual() compares the lengths of two arrays, and its .not.not still negates.
const rules = `
  const which = check => { try { check(); return "Jest"; } catch { return "Vitest"; } };
  const toEqual = () => which(() => expect([1]).toEqual([1, undefined]));
  const notNot = () => which(() => expect(1).not.not.toBe(1));
`;

// Every module calls these the way Vitest does, so how a callback is called doesn't tell its module.
describe.concurrent("an around hook and a callback of the test context have the rules of their module", () => {
  const everyPosition = `
    ${rules}
    const show = where => console.log(where, "| toEqual:", toEqual(), "| .not.not:", notNot());
    let context;
    aroundAll(async runSuite => { show("aroundAll >"); await runSuite(); show("aroundAll <"); });
    aroundEach(async (runTest, current) => {
      context = current;
      show("aroundEach >");
      current.onTestFinished(() => show("onTestFinished from the hook"));
      current.onTestFailed(() => show("onTestFailed from the hook"));
      await runTest();
      show("aroundEach <");
    });
    test("passes", () => {
      show("test");
      context.onTestFinished(() => show("onTestFinished from the test"));
    });
    test.fails("fails", () => {
      show("test");
      context.onTestFailed(() => show("onTestFailed from the test"));
      throw new Error("expected");
    });
  `;
  test.each([
    [`"bun:test"`, `import { aroundAll, aroundEach, expect, test } from "bun:test";`, "Jest"],
    [`"@jest/globals"`, `import { aroundAll, aroundEach, expect, test } from "@jest/globals";`, "Jest"],
    [
      `the test of "bun:test"`,
      `import { expect, test } from "bun:test"; const { aroundAll, aroundEach } = test;`,
      "Jest",
    ],
    ["the globals", "", "Jest"],
    [`"vitest"`, `import { aroundAll, aroundEach, expect, test } from "vitest";`, "Vitest"],
    [
      `the test of "vitest"`,
      `import { expect, test } from "vitest"; const { aroundAll, aroundEach } = test;`,
      "Vitest",
    ],
  ])("before and after runSuite() and runTest(), from %s", async (_, header, ofModule) => {
    const { log, results, exitCode } = await runTests({ "a.test.js": header + everyPosition });
    const each = (deferred: string[]) => ["aroundEach >", "test", ...deferred, "aroundEach <"];
    expect({ log, results, exitCode }).toEqual({
      log: [
        "aroundAll >",
        ...each(["onTestFinished from the test", "onTestFinished from the hook"]),
        ...each(["onTestFinished from the hook", "onTestFailed from the test", "onTestFailed from the hook"]),
        "aroundAll <",
      ].map(where => `${where} | toEqual: ${ofModule} | .not.not: ${ofModule}`),
      results: ["(pass) passes", "(pass) fails"],
      exitCode: 0,
    });
  });

  test("an error that nobody handles goes to the file's process listeners first, if the hook is vitest's", async () => {
    const file = (module: string) => `
      import { aroundAll, aroundEach, test } from "${module}";
      const unhandled = async where => {
        for (const [event, cause] of [
          ["unhandledRejection", error => void Promise.reject(error)],
          ["uncaughtException", error => queueMicrotask(() => { throw error; })],
        ]) {
          const listener = error => console.log("the listener heard:", error.message);
          process.on(event, listener);
          cause(new Error(event + " " + where));
          // Either error is reported before the next immediate runs.
          await new Promise(resolve => setImmediate(resolve));
          process.off(event, listener);
        }
      };
      aroundAll(async runSuite => {
        await unhandled("before runSuite()");
        await runSuite();
        await unhandled("after runSuite()");
      });
      aroundEach(async (runTest, context) => {
        await unhandled("before runTest()");
        context.onTestFinished(() => unhandled("in onTestFinished()"));
        await runTest();
        await unhandled("after runTest()");
      });
      test("the test", () => {});
    `;
    const thrown = [
      "before runSuite()",
      "before runTest()",
      "in onTestFinished()",
      "after runTest()",
      "after runSuite()",
    ].flatMap(where => [`unhandledRejection ${where}`, `uncaughtException ${where}`]);
    const [vitest, bun] = await Promise.all([
      runTests({ "a.test.js": file("vitest") }),
      runTests({ "a.test.js": file("bun:test") }),
    ]);
    expect({ log: vitest.log, results: vitest.results, errors: vitest.errors, exitCode: vitest.exitCode }).toEqual({
      log: thrown.map(message => `the listener heard: ${message}`),
      results: ["(pass) the test"],
      errors: [],
      exitCode: 0,
    });
    expect({ log: bun.log, results: bun.results, errors: bun.errors, exitCode: bun.exitCode }).toEqual({
      log: [],
      results: ["(pass) the test"],
      errors: thrown.map(message => `error: ${message}`),
      exitCode: 1,
    });
  });

  test("around a test of the other module, and from a preload", async () => {
    const expected = (log: string[]) =>
      log.map(where => `${where} | toEqual: ${where.includes("bun:test") ? "Jest" : "Vitest"}`);
    const hooks = (name: string) => `
      aroundAll(async runSuite => { show("aroundAll of ${name} >"); await runSuite(); show("aroundAll of ${name} <"); });
      aroundEach(async (runTest, context) => {
        show("aroundEach of ${name} >");
        context.onTestFinished(() => show("onTestFinished of the context, from ${name}"));
        await runTest();
        show("aroundEach of ${name} <");
      });
    `;
    const [mixed, preloaded] = await Promise.all([
      runTests({
        "a.test.js": `
          import * as bun from "bun:test";
          import * as vitest from "vitest";
          const { expect } = bun;
          ${rules}
          const show = where => console.log(where, "| toEqual:", toEqual());
          { const { aroundAll, aroundEach } = bun; ${hooks("bun:test")} }
          { const { aroundAll, aroundEach } = vitest; ${hooks("vitest")} }
          bun.test("of bun:test", () => {
            show("test of bun:test");
            vitest.onTestFinished(() => show("onTestFinished of vitest"));
          });
          vitest.test("of vitest", () => show("test of vitest"));
        `,
      }),
      runTests(
        {
          "preload.js": `
            import { aroundAll, aroundEach, expect } from "bun:test";
            ${rules}
            globalThis.show = where => console.log(where, "| toEqual:", toEqual());
            ${hooks("bun:test")}
          `,
          "a.test.js": `import { test } from "bun:test"; test("of bun:test", () => show("test of bun:test"));`,
          "b.test.js": `import { test } from "vitest"; test("of vitest", () => show("test of vitest"));`,
        },
        ["--preload=./preload.js"],
      ),
    ]);
    const around = (names: string[], inside: string[]) => [
      ...names.map(name => `aroundEach of ${name} >`),
      ...inside,
      ...names.map(name => `onTestFinished of the context, from ${name}`).reverse(),
      ...names.map(name => `aroundEach of ${name} <`).reverse(),
    ];
    expect({ log: mixed.log, exitCode: mixed.exitCode }).toEqual({
      log: expected([
        "aroundAll of bun:test >",
        "aroundAll of vitest >",
        ...around(["bun:test", "vitest"], ["test of bun:test", "onTestFinished of vitest"]),
        ...around(["bun:test", "vitest"], ["test of vitest"]),
        "aroundAll of vitest <",
        "aroundAll of bun:test <",
      ]),
      exitCode: 0,
    });
    expect({ log: preloaded.log, exitCode: preloaded.exitCode }).toEqual({
      log: expected([
        "aroundAll of bun:test >",
        ...around(["bun:test"], ["test of bun:test"]),
        ...around(["bun:test"], ["test of vitest"]),
        "aroundAll of bun:test <",
      ]),
      exitCode: 0,
    });
  });

  test("a fixture and a function that a hook of vitest returns have Vitest's rules", async () => {
    const { log, exitCode } = await runTests({
      "a.test.js": `
        import { beforeAll, beforeEach, expect, test as base } from "vitest";
        ${rules}
        const show = where => console.log(where, "| toEqual:", toEqual(), "| .not.not:", notNot());
        beforeAll(() => () => show("function that beforeAll returned"));
        beforeEach(() => () => show("function that beforeEach returned"));
        const test = base.extend({
          ofTest: async ({}, use) => { show("fixture >"); await use(1); show("fixture <"); },
          ofFile: [async ({}, use) => { show("file fixture >"); await use(1); show("file fixture <"); }, { scope: "file" }],
        });
        test("test", ({ ofTest, ofFile }) => show("test"));
      `,
    });
    expect({ log, exitCode }).toEqual({
      log: [
        "fixture >",
        "file fixture >",
        "test",
        "function that beforeEach returned",
        "fixture <",
        "function that beforeAll returned",
        "file fixture <",
      ].map(where => `${where} | toEqual: Vitest | .not.not: Vitest`),
      exitCode: 0,
    });
  });

  test(`concurrent tests of "bun:test" keep its toEqual() inside an aroundEach of "bun:test"`, async () => {
    const { results, exitCode } = await runTests({
      "a.test.js": `
        import { aroundEach, expect, test } from "bun:test";
        aroundEach(async runTest => { await runTest(); });
        for (const name of ["a", "b", "c", "d"]) {
          test.concurrent(name, async () => {
            await new Promise(resolve => setImmediate(resolve));
            expect([1]).toEqual([1, undefined]);
          });
        }
      `,
    });
    expect({ results, exitCode }).toEqual({
      results: ["(pass) a", "(pass) b", "(pass) c", "(pass) d"],
      exitCode: 0,
    });
  });

  test(`a file of "bun:test" is loaded again with its rules after an aroundAll`, async () => {
    const { log, exitCode } = await runTests(
      {
        "a.test.js": `
          import { aroundAll, describe, expect, test } from "bun:test";
          ${rules}
          const show = where => console.log(where, "| toEqual:", toEqual());
          show("the file");
          aroundAll(async runSuite => { await runSuite(); });
          describe("block", () => {
            show("describe()");
            test("test", () => show("test"));
          });
        `,
      },
      ["--rerun-each=2"],
    );
    const load = ["the file", "describe()", "test"].map(where => `${where} | toEqual: Jest`);
    expect({ log, exitCode }).toEqual({ log: [...load, ...load], exitCode: 0 });
  });

  // The default of a hook of "vitest" is 10 seconds, or --timeout if that is longer.
  test("a callback of the test context has the default timeout of the hook that registers it", async () => {
    const file = (module: string, callback: string) => `
      import { aroundEach, test } from "${module}";
      aroundEach(async (runTest, context) => {
        context.onTestFinished(${callback});
        await runTest();
      }, 30_000);
      test("the test", () => {}, 30_000);
    `;
    const [bun, vitest] = await Promise.all([
      runTests(
        {
          "a.test.js": file(
            "bun:test",
            `() => {
              setTimeout(() => console.log("still running after 5 seconds"), 5000);
              return new Promise(() => {});
            }`,
          ),
        },
        ["--timeout=50"],
        {},
        beforeTheTestTimesOut,
      ),
      runTests(
        {
          "a.test.js": file(
            "vitest",
            `async () => {
              await new Promise(resolve => setTimeout(resolve, 200));
              console.log("done after 200 ms");
            }`,
          ),
        },
        ["--timeout=50"],
      ),
    ]);
    expect(bun.stderr).toContain("a beforeEach/afterEach hook timed out for this test");
    expect({ log: bun.log, results: bun.results, exitCode: bun.exitCode }).toEqual({
      log: [],
      results: ["(fail) the test"],
      exitCode: 1,
    });
    expect({ log: vitest.log, results: vitest.results, exitCode: vitest.exitCode }).toEqual({
      log: ["done after 200 ms"],
      results: ["(pass) the test"],
      exitCode: 0,
    });
  });
});

describe.concurrent("which module decides", () => {
  // Who gets a rejection that nobody handles: the runner reports it, or a listener of the process takes it first.
  const unhandled = `
    const unhandled = async message => {
      let taker = "the runner";
      // A listener of code that still waits hears the errors of later callbacks too.
      const listener = error => { if (error.message === message) taker = "the listener"; };
      process.on("unhandledRejection", listener);
      Promise.reject(new Error(message));
      await new Promise(resolve => setImmediate(resolve));
      process.off("unhandledRejection", listener);
      return taker;
    };
  `;

  // In one sequence: the callback that runs decides toEqual() and unhandled errors, and the test decides .not.not.
  test("for each hook, around a test of each module", async () => {
    const { log, errors, exitCode } = await runTests({
      "a.test.js": `
        import * as bun from "bun:test";
        import * as vitest from "vitest";
        const { expect } = bun;
        ${rules}
        ${unhandled}
        const show = async where =>
          console.log(where, "| toEqual:", toEqual(), "| .not.not:", notNot(), "| unhandled:", await unhandled(where));
        const modules = Object.entries({ "bun:test": bun, vitest });
        for (const [hooks, { afterAll, afterEach, aroundAll, aroundEach, beforeAll, beforeEach, describe }] of modules) {
          for (const [tests, { test }] of modules) {
            const at = where => show(hooks + " hooks, " + tests + " test, " + where);
            describe(hooks + " hooks, " + tests + " test", () => {
              beforeAll(() => at("beforeAll"));
              afterAll(() => at("afterAll"));
              beforeEach(() => at("beforeEach"));
              afterEach(() => at("afterEach"));
              aroundAll(async (runSuite) => {
                await at("aroundAll >");
                await runSuite();
                await at("aroundAll <");
              });
              aroundEach(async (runTest) => {
                await at("aroundEach >");
                await runTest();
                await at("aroundEach <");
              });
              test("test", () => at("test"));
            });
          }
        }
      `,
    });
    const positions: [where: string, runsForATest: boolean][] = [
      ["aroundAll >", false],
      ["beforeAll", false],
      ["aroundEach >", true],
      ["beforeEach", true],
      ["test", true],
      ["afterEach", true],
      ["aroundEach <", true],
      ["afterAll", false],
      ["aroundAll <", false],
    ];
    const modules = ["bun:test", "vitest"];
    const rows = modules.flatMap(hooks =>
      modules.flatMap(tests =>
        positions.map(([where, runsForATest]) => ({
          message: `${hooks} hooks, ${tests} test, ${where}`,
          ofCallback: where === "test" ? tests : hooks,
          ofMatchers: runsForATest ? tests : hooks,
        })),
      ),
    );
    const runner = (module: string) => (module === "vitest" ? "Vitest" : "Jest");
    const taker = (module: string) => (module === "vitest" ? "the listener" : "the runner");
    expect({ log, errors, exitCode }).toEqual({
      log: rows.map(
        ({ message, ofCallback, ofMatchers }) =>
          `${message} | toEqual: ${runner(ofCallback)} | .not.not: ${runner(ofMatchers)} | unhandled: ${taker(ofCallback)}`,
      ),
      errors: rows.filter(row => row.ofCallback === "bun:test").map(row => `error: ${row.message}`),
      exitCode: 1,
    });
  });

  // Whatever module the rules of a test.extend() or test.for() test come from, its plain hooks are hooks of "bun:test".
  test(`for a hook of "bun:test", also before and after a test.extend() or test.for() test`, async () => {
    const { log, errors, exitCode } = await runTests({
      "a.test.js": `
        import { afterEach, beforeEach, expect, test } from "bun:test";
        ${rules}
        ${unhandled}
        const show = async where => console.log(where, "| toEqual:", toEqual(), "| unhandled:", await unhandled(where));
        beforeEach(() => show("beforeEach"));
        afterEach(() => show("afterEach"));
        test("test", () => {});
        test.each([1])("each %i", () => {});
        test.for([1])("for %i", () => {});
        test.extend({})("extended", () => {});
      `,
    });
    const hooks = [1, 2, 3, 4].flatMap(() => ["beforeEach", "afterEach"]);
    expect({ log, errors, exitCode }).toEqual({
      log: hooks.map(where => `${where} | toEqual: Jest | unhandled: the runner`),
      errors: hooks.map(where => `error: ${where}`),
      exitCode: 1,
    });
  });

  // The entry that the sequence runs at the call registers the callback. Here that is the hook, at each of the three calls.
  test("for a callback of the test context: the hook that registers it", async () => {
    const { log, exitCode } = await runTests({
      "a.test.js": `
        import * as bun from "bun:test";
        import * as vitest from "vitest";
        const { expect } = bun;
        ${rules}
        const show = where => console.log(where, "| toEqual:", toEqual());
        bun.aroundEach(async (runTest, context) => {
          context.onTestFinished(() => show("registered before runTest()"));
          const ran = runTest();
          context.onTestFinished(() => show("registered after the call of runTest()"));
          await ran;
          context.onTestFinished(() => show("registered after runTest() ended"));
        });
        vitest.test("test", () => show("test"));
      `,
    });
    expect({ log, exitCode }).toEqual({
      log: [
        "test | toEqual: Vitest",
        "registered after the call of runTest() | toEqual: Jest",
        "registered before runTest() | toEqual: Jest",
        "registered after runTest() ended | toEqual: Jest",
      ],
      exitCode: 0,
    });
  });

  // The last entry of the first load is a test of "vitest". The second load starts under the rules of "bun:test" again.
  test(`for the top level and the describe() bodies of a file that --rerun-each loads again`, async () => {
    const { log, exitCode } = await runTests(
      {
        "a.test.js": `
          import { describe, expect, test } from "bun:test";
          import { test as testOfVitest } from "vitest";
          ${rules}
          console.log("the file | toEqual:", toEqual());
          describe("block", () => {
            console.log("describe() | toEqual:", toEqual());
            test("of bun:test", () => {});
            testOfVitest("of vitest", () => {});
          });
        `,
      },
      ["--rerun-each=2"],
    );
    const load = ["the file | toEqual: Jest", "describe() | toEqual: Jest"];
    expect({ log, exitCode }).toEqual({ log: [...load, ...load], exitCode: 0 });
  });

  // Late work is taken for the entry that runs when it comes, as before. Here that is a hook of "bun:test".
  test(`for an error of a "vitest" test that comes in the second half of a "bun:test" aroundEach: the hook`, async () => {
    const { log, errors, exitCode } = await runTests({
      "a.test.js": `
        import * as bun from "bun:test";
        import * as vitest from "vitest";
        const ticks = async count => {
          for (let i = 0; i < count; i++) await new Promise(resolve => setImmediate(resolve));
        };
        bun.aroundEach(async runTest => {
          await runTest();
          await ticks(4);
        });
        vitest.test("its error comes after it ended", () => {
          process.on("uncaughtException", error => console.log("the listener heard:", error.message));
          ticks(2).then(() => setImmediate(() => { throw new Error("late, from the vitest test"); }));
        });
      `,
    });
    expect({ log, errors, exitCode }).toEqual({
      log: [],
      errors: ["error: late, from the vitest test"],
      exitCode: 1,
    });
  });
});

test.concurrent(
  `beforeEach from "bun:test" ignores a returned function for a test that has a context too`,
  async () => {
    const { log, exitCode } = await runTests({
      "a.test.js": `
      import { test, aroundEach, beforeEach } from "bun:test";
      aroundEach(async runTest => { await runTest(); });
      beforeEach(() => () => console.log("unreachable"));
      beforeEach(async () => () => console.log("unreachable"));
      test("test", () => console.log("test"));
    `,
    });
    expect({ log, exitCode }).toEqual({ log: ["test"], exitCode: 0 });
  },
);

test.concurrent(`an aroundAll from "bun:test" doesn't run either if every test of its block is skipped`, async () => {
  const { log, results, exitCode } = await runTests({
    "a.test.js": `
      import { test, describe, aroundAll, beforeAll, afterAll } from "bun:test";
      describe("every test is skipped", () => {
        aroundAll(async runSuite => { console.log("unreachable"); await runSuite(); });
        beforeAll(() => console.log("beforeAll"));
        afterAll(() => console.log("afterAll"));
        test.skip("test", () => {});
      });
    `,
  });
  expect({ log, results, exitCode }).toEqual({
    log: ["beforeAll", "afterAll"],
    results: ["(skip) every test is skipped > test"],
    exitCode: 0,
  });
});
