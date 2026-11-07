// What `expect.assertions()` and `expect.hasAssertions()` count: matcher calls in a "bun:test" test, and
// `expect()` calls in a "vitest" test. Expected outputs for "vitest" were taken from Vitest 5.0.5.
// Not in vitest-flavor.test.ts: a debug build takes about a minute for that file, and seconds for this one.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

async function runTests(files: Record<string, string>, args: string[] = []) {
  using dir = tempDir("vitest-flavor-assertions", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    env: { ...bunEnv, CI: "false" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
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

// Jest counts a matcher call. Vitest counts an expect() call, matcher or not.
test.concurrent(
  "assertionCalls counts matcher calls in a bun:test test and expect() calls in a vitest test",
  async () => {
    const rows: [label: string, jest: number, vitest: number][] = [
      ["expect(), no matcher:", 0, 1],
      ["expect(), one matcher:", 1, 1],
      ["expect(), two matchers:", 2, 1],
      ["expect.soft(), no matcher:", 0, 1],
      ["expect.soft(), two matchers:", 2, 1],
      ["expect.poll(), no matcher:", 0, 1],
      ["expect.poll(), one matcher, three attempts:", 1, 1],
      [".resolves:", 1, 1],
      [".rejects:", 1, 1],
      [".resolves on a value that is not a promise:", 0, 1],
      ["a matcher that fails:", 1, 1],
      ["a custom matcher that calls expect():", 1, 2],
      ["expect.poll(1), which throws:", 0, 1],
      ["expect(1, message), where reading the message throws:", 0, 1],
      ["expect.hasAssertions(), expect.any():", 0, 0],
      ["after setState({ assertionCalls: 4 }), expect(), expect() with a matcher:", 5, 6],
    ];
    const body = (modules: string) => `
      for (const [name, { test, expect }] of Object.entries(${modules})) {
        test(name, async () => {
          let last = expect.getState().assertionCalls;
          const counted = label => {
            const now = expect.getState().assertionCalls;
            console.log(name, label, now - last);
            last = now;
          };
          expect(1);
          counted("expect(), no matcher:");
          expect(1).toBe(1);
          counted("expect(), one matcher:");
          const kept = expect(1);
          kept.toBe(1);
          kept.not.toBe(2);
          counted("expect(), two matchers:");
          expect.soft(1);
          counted("expect.soft(), no matcher:");
          const soft = expect.soft(1);
          soft.toBe(1);
          soft.toBe(1);
          counted("expect.soft(), two matchers:");
          expect.poll(() => 1);
          counted("expect.poll(), no matcher:");
          let polled = 0;
          await expect.poll(() => ++polled, { interval: 1 }).toBe(3);
          counted("expect.poll(), one matcher, three attempts:");
          await expect(Promise.resolve(1)).resolves.toBe(1);
          counted(".resolves:");
          await expect(Promise.reject(new Error("rejected"))).rejects.toThrow("rejected");
          counted(".rejects:");
          try { expect(1).resolves.toEqual(2); } catch {}
          counted(".resolves on a value that is not a promise:");
          try { expect(1).toBe(2); } catch {}
          counted("a matcher that fails:");
          expect.extend({ toBeOne(received) { expect(received); return { pass: received === 1, message: () => "" }; } });
          expect(1).toBeOne();
          counted("a custom matcher that calls expect():");
          try { expect.poll(1); } catch {}
          counted("expect.poll(1), which throws:");
          try { expect(1, { toString() { throw new Error("message"); } }); } catch {}
          counted("expect(1, message), where reading the message throws:");
          expect.hasAssertions();
          expect.any(Number);
          counted("expect.hasAssertions(), expect.any():");
          expect.setState({ assertionCalls: 4 });
          expect(1);
          expect(1).toBe(1);
          console.log(name, "after setState({ assertionCalls: 4 }), expect(), expect() with a matcher:", expect.getState().assertionCalls);
        });
      }
    `;
    const { log, results, exitCode } = await runTests({
      "a.test.js": `import * as bun from "bun:test"; import * as vitest from "vitest";` + body("{ bun, vitest }"),
      // No test in this file is from "vitest".
      "b.test.js": `import * as alone from "bun:test";` + body("{ alone }"),
    });
    expect({ log, results, exitCode }).toEqual({
      log: [
        ...rows.map(([label, jest]) => `bun ${label} ${jest}`),
        ...rows.map(([label, , vitest]) => `vitest ${label} ${vitest}`),
        ...rows.map(([label, jest]) => `alone ${label} ${jest}`),
      ],
      results: ["(pass) bun", "(pass) vitest", "(pass) alone"],
      exitCode: 0,
    });
  },
);

test.concurrent(
  "expect.assertions() and expect.hasAssertions() go by that count, and so does a JUnit report",
  async () => {
    const files = {
      "a.test.js": `
        import * as bun from "bun:test";
        import * as vitest from "vitest";
        for (const [name, { test, expect, describe }] of Object.entries({ bun, vitest })) {
          describe(name, () => {
            test("assertions(1), expect() with no matcher", () => { expect.assertions(1); expect(1); });
            test("assertions(1), one expect() with two matchers", () => { expect.assertions(1); const kept = expect(1); kept.toBe(1); kept.toBe(1); });
            test("assertions(1), two expect() with one matcher", () => { expect.assertions(1); expect(1); expect(2).toBe(2); });
            test("assertions(1) after the expect() call", () => { expect(1); expect.assertions(1); });
            test("hasAssertions(), expect() with no matcher", () => { expect.hasAssertions(); expect(1); });
            test.fails("test.fails, assertions(1), two expect() with one matcher", () => { expect.assertions(1); expect(1); expect(2).toBe(2); });
          });
        }
        vitest.describe.concurrent("context", () => {
          vitest.test("assertions(1), expect() with no matcher", async ({ expect }) => { expect.assertions(1); await 1; expect(1); });
          vitest.test("assertions(1), one expect() with two matchers", async ({ expect }) => { expect.assertions(1); await 1; const kept = expect(1); kept.toBe(1); kept.toBe(1); });
          vitest.test("assertions(1), one expect.soft() with two matchers", async ({ expect }) => { expect.assertions(1); await 1; const soft = expect.soft(1); soft.toBe(1); soft.toBe(1); });
          vitest.test("assertions(1), expect.poll() with no matcher", async ({ expect }) => { expect.assertions(1); await 1; expect.poll(() => 1); });
        });
      `,
    };
    using dir = tempDir("vitest-flavor-junit", {});
    const outfile = join(String(dir), "junit.xml");
    const { results, errors, stderr, exitCode } = await runTests(files, [
      "--reporter=junit",
      `--reporter-outfile=${outfile}`,
    ]);
    const report = await Bun.file(outfile).text();
    const reported = [...report.matchAll(/<testcase name="[^"]*" classname="([^"]*)"[^>]* assertions="(\d+)"/g)];
    expect({
      results,
      errors,
      total: /\d+ expect\(\) calls/.exec(stderr)?.[0],
      junit: reported.map(([, suite, assertions]) => `${suite} ${assertions}`),
      exitCode,
    }).toEqual({
      results: [
        "(fail) bun > assertions(1), expect() with no matcher",
        "(fail) bun > assertions(1), one expect() with two matchers",
        "(pass) bun > assertions(1), two expect() with one matcher",
        "(fail) bun > assertions(1) after the expect() call",
        "(fail) bun > hasAssertions(), expect() with no matcher",
        "(fail) bun > test.fails, assertions(1), two expect() with one matcher",
        "(pass) vitest > assertions(1), expect() with no matcher",
        "(pass) vitest > assertions(1), one expect() with two matchers",
        "(fail) vitest > assertions(1), two expect() with one matcher",
        "(pass) vitest > assertions(1) after the expect() call",
        "(pass) vitest > hasAssertions(), expect() with no matcher",
        "(pass) vitest > test.fails, assertions(1), two expect() with one matcher",
        "(pass) context > assertions(1), expect() with no matcher",
        "(pass) context > assertions(1), one expect() with two matchers",
        "(pass) context > assertions(1), one expect.soft() with two matchers",
        "(pass) context > assertions(1), expect.poll() with no matcher",
      ],
      errors: [
        "AssertionError: expected 1 assertion, but test ended with 0 assertions",
        "AssertionError: expected 1 assertion, but test ended with 2 assertions",
        "AssertionError: expected 1 assertion, but test ended with 0 assertions",
        "AssertionError: received 0 assertions, but expected at least one assertion to be called",
        "AssertionError: expected 1 assertion, but test ended with 2 assertions",
      ],
      total: "16 expect() calls",
      junit: [
        ...[0, 2, 1, 0, 0, 1].map(assertions => `bun ${assertions}`),
        ...[1, 1, 2, 1, 1, 2].map(assertions => `vitest ${assertions}`),
        ...[1, 1, 1, 1].map(assertions => `context ${assertions}`),
      ],
      exitCode: 1,
    });
  },
);

test.concurrent(
  "in a vitest test, expect() counts for the run that calls it and its matchers count for no run",
  async () => {
    const { log, results, errors, exitCode } = await runTests({
      "a.test.js": `
        import * as bun from "bun:test";
        import * as vitest from "vitest";
        for (const [name, { test, expect, describe, beforeAll, afterAll, afterEach, aroundAll }] of Object.entries({ bun, vitest })) {
          const counted = () => {
            const before = expect.getState().assertionCalls;
            expect(1);
            expect(1).toBe(1);
            return expect.getState().assertionCalls - before;
          };
          describe(name, () => {
            let attempts = 0;
            let gate;
            test("expect() in attempt 1, its matcher in attempt 2", { retry: 1 }, async () => {
              expect.assertions(1);
              if (++attempts === 1) {
                gate = Promise.withResolvers();
                const made = expect(1);
                gate.promise.then(() => made.toBe(1));
                throw new Error("attempt 1 fails");
              }
              gate.resolve();
              await gate.promise;
            });

            // As in Vitest and Jest: a call that attempt 1 left behind counts for the attempt that runs when it is made.
            let lateAttempts = 0;
            let lateGate;
            test("expect() and its matcher in attempt 2, called by what attempt 1 left behind", { retry: 1 }, async () => {
              expect.assertions(1);
              if (++lateAttempts === 1) {
                lateGate = Promise.withResolvers();
                lateGate.promise.then(() => expect(1).toBe(1));
                throw new Error("attempt 1 fails");
              }
              lateGate.resolve();
              await lateGate.promise;
            });

            let runs = 0;
            test("each run starts at zero", { repeats: 1 }, () => {
              console.log(name, "run", ++runs, "starts at", expect.getState().assertionCalls);
              expect(1);
              expect(1).toBe(1);
            });

            describe("hooks", () => {
              aroundAll(async (runSuite) => {
                console.log(name, "aroundAll set-up:", counted());
                await runSuite();
                console.log(name, "aroundAll teardown:", counted());
              });
              beforeAll(() => { console.log(name, "beforeAll:", counted()); });
              afterAll(() => { console.log(name, "afterAll:", counted()); });
              let made;
              afterEach(() => { made.toBe(1); });
              test("expect() in the test, its matcher in afterEach", () => { expect.assertions(1); made = expect(1); });
            });
          });
        }
        vitest.describe("vitest, two tests", () => {
          let made;
          vitest.test("expect() in this test", () => { vitest.expect.assertions(1); made = vitest.expect(1); });
          vitest.test("its matcher in the next test", () => { vitest.expect.assertions(1); made.toBe(1); });
        });
        vitest.describe("vitest, hasAssertions() and expect() with no matcher", () => {
          vitest.describe("in aroundAll", () => {
            vitest.aroundAll(async (runSuite) => { vitest.expect.hasAssertions(); vitest.expect(1); await runSuite(); });
            vitest.test("the hook does not fail", () => {});
          });
          vitest.describe("in beforeAll", () => {
            vitest.beforeAll(() => { vitest.expect.hasAssertions(); vitest.expect(1); });
            vitest.test("the hook does not fail", () => {});
          });
        });
      `,
    });
    expect({ log, results, errors, exitCode }).toEqual({
      log: [
        "bun run 1 starts at 0",
        "bun run 2 starts at 0",
        "bun aroundAll set-up: 1",
        "bun beforeAll: 1",
        "bun afterAll: 1",
        "bun aroundAll teardown: 1",
        "vitest run 1 starts at 0",
        "vitest run 2 starts at 0",
        "vitest aroundAll set-up: 2",
        "vitest beforeAll: 2",
        "vitest afterAll: 2",
        "vitest aroundAll teardown: 2",
      ],
      results: [
        "(pass) bun > expect() in attempt 1, its matcher in attempt 2 (attempt 2)",
        "(pass) bun > expect() and its matcher in attempt 2, called by what attempt 1 left behind (attempt 2)",
        "(pass) bun > each run starts at zero (run 2)",
        "(pass) bun > hooks > expect() in the test, its matcher in afterEach",
        "(fail) vitest > expect() in attempt 1, its matcher in attempt 2 (attempt 2)",
        "(pass) vitest > expect() and its matcher in attempt 2, called by what attempt 1 left behind (attempt 2)",
        "(pass) vitest > each run starts at zero (run 2)",
        "(pass) vitest > hooks > expect() in the test, its matcher in afterEach",
        "(pass) vitest, two tests > expect() in this test",
        "(fail) vitest, two tests > its matcher in the next test",
        "(pass) vitest, hasAssertions() and expect() with no matcher > in aroundAll > the hook does not fail",
        "(pass) vitest, hasAssertions() and expect() with no matcher > in beforeAll > the hook does not fail",
      ],
      // Each test with `retry: 1` throws in attempt 1. The two failures are the count of the "vitest" tests.
      errors: [
        "error: attempt 1 fails",
        "error: attempt 1 fails",
        "error: attempt 1 fails",
        "AssertionError: expected 1 assertion, but test ended with 0 assertions",
        "error: attempt 1 fails",
        "AssertionError: expected 1 assertion, but test ended with 0 assertions",
      ],
      exitCode: 1,
    });
  },
);

// The module that registered the test decides for the test and its hooks. `test.for()` and `test.extend()` make
// Vitest tests, from "bun:test" too. A hook that runs one time for a scope goes by its own module. What follows
// `use()` in a fixture of the file runs after the last test: only `test.extend()` makes one, so Vitest decides.
test.concurrent(
  "the test decides what its hooks count, and a beforeAll, afterAll or aroundAll hook decides for itself",
  async () => {
    const counted = `
      const counted = () => {
        const before = expect.getState().assertionCalls;
        expect(1);
        expect(1).toBe(1);
        return expect.getState().assertionCalls - before;
      };
    `;
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test, expect, describe, aroundAll, aroundEach, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
        ${counted}
        aroundAll(async (runSuite) => { console.log("aroundAll:", counted()); await runSuite(); });
        beforeAll(() => { console.log("beforeAll:", counted()); });
        afterAll(() => { console.log("afterAll:", counted()); });
        const log = entry => console.log(expect.getState().currentTestName, entry + ":", counted());
        aroundEach(async (runTest) => { log("aroundEach"); await runTest(); });
        beforeEach(() => log("beforeEach"));
        afterEach(() => log("afterEach"));
        test("test()", () => log("test"));
        test.each([1])("test.each(%i)", () => log("test"));
        test.for([1])("test.for(%i)", () => log("test"));
        const extended = test.extend({
          made: async ({}, use) => { log("fixture"); await use(1); },
          shared: [async ({}, use) => { await use(1); console.log("file fixture, after use():", counted()); }, { scope: "file" }],
        });
        extended("test.extend()", ({ made, shared }) => log("test"));
      `,
      "b.test.js": `
        import * as bun from "bun:test";
        import * as vitest from "vitest";
        const { expect } = bun;
        ${counted}
        bun.describe("a bun:test test with vitest hooks", () => {
          vitest.beforeAll(() => { console.log("vitest beforeAll:", counted()); });
          vitest.beforeEach(() => { console.log("vitest beforeEach:", counted()); });
          bun.test("test", () => {});
        });
        vitest.describe("a vitest test with bun:test hooks", () => {
          bun.beforeAll(() => { console.log("bun:test beforeAll:", counted()); });
          bun.beforeEach(() => { console.log("bun:test beforeEach:", counted()); });
          vitest.test("test", () => {});
        });
      `,
    });
    expect({ log, results, exitCode }).toEqual({
      log: [
        "aroundAll: 1",
        "beforeAll: 1",
        ...["test()", "test.each(1)"].flatMap(title =>
          ["aroundEach", "beforeEach", "test", "afterEach"].map(entry => `${title} ${entry}: 1`),
        ),
        ...["aroundEach", "beforeEach", "test", "afterEach"].map(entry => `test.for(1) ${entry}: 2`),
        ...["aroundEach", "beforeEach", "fixture", "test", "afterEach"].map(entry => `test.extend() ${entry}: 2`),
        "afterAll: 1",
        "file fixture, after use(): 2",
        "vitest beforeAll: 2",
        "vitest beforeEach: 1",
        "bun:test beforeAll: 1",
        "bun:test beforeEach: 2",
      ],
      results: [
        "(pass) test()",
        "(pass) test.each(1)",
        "(pass) test.for(1)",
        "(pass) test.extend()",
        "(pass) a bun:test test with vitest hooks > test",
        "(pass) a vitest test with bun:test hooks > test",
      ],
      exitCode: 0,
    });
  },
);

test.concurrent("a hook from a preload counts by the module that registered it", async () => {
  const preload = (module: string) => `
    import { expect, beforeAll, afterAll, aroundAll, beforeEach } from "${module}";
    const counted = () => {
      const before = expect.getState().assertionCalls;
      expect(1);
      expect(1).toBe(1);
      return expect.getState().assertionCalls - before;
    };
    aroundAll(async (runSuite) => {
      console.log("aroundAll set-up:", counted());
      await runSuite();
      console.log("aroundAll teardown:", counted());
    });
    beforeAll(() => { console.log("beforeAll:", counted()); });
    afterAll(() => { console.log("afterAll:", counted()); });
    beforeEach(() => { expect.hasAssertions(); });
  `;
  const file = (module: string) => `
    import { test, expect } from "${module}";
    test("${module}: expect() with no matcher", () => { expect(1); });
  `;
  // The first two hooks run in the first file and the last two in the last file, whatever those files import.
  const run = async (hooks: string) => {
    const { log, results, exitCode } = await runTests(
      { "preload.js": preload(hooks), "a.test.js": file("vitest"), "b.test.js": file("bun:test") },
      ["--preload", "./preload.js"],
    );
    return { log, results, exitCode };
  };
  const expected = (count: number) => ({
    log: ["aroundAll set-up", "beforeAll", "afterAll", "aroundAll teardown"].map(hook => `${hook}: ${count}`),
    results: ["(pass) vitest: expect() with no matcher", "(fail) bun:test: expect() with no matcher"],
    exitCode: 1,
  });
  expect(await Promise.all([run("vitest"), run("bun:test")])).toEqual([expected(2), expected(1)]);
});
