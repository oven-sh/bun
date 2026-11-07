// Whose matchers a hook gets, and who gets its unhandled errors: "vitest" or "bun:test".
// Expected outputs for "vitest" were taken from Vitest 5.0.
// Not in vitest-flavor.test.ts: a debug build takes about a minute for that file, and seconds for this one.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function runTests(files: Record<string, string>) {
  using dir = tempDir("vitest-flavor-hooks", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
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
    exitCode,
  };
}

// An around hook's callback gets Vitest's parameters in both modules. Whose matchers it gets is a different question.
test.concurrent(
  "a hook follows the module of the test it runs for, and its own module if it runs for none",
  async () => {
    const { log, exitCode } = await runTests({
      "a.test.js": `
        import * as bun from "bun:test";
        import * as vitest from "vitest";
        const passes = fn => { try { fn(); return true; } catch { return false; } };
        // Both pass in "bun:test". Both fail in "vitest": its .not.not is still negated, and it counts the missing item.
        const follows = expect => [
          passes(() => expect(1).not.not.toBe(1)),
          passes(() => expect([1]).toEqual([1, undefined])),
        ].map(passed => (passed ? "bun" : "vitest"));
        const modules = Object.entries({ bun, vitest });
        for (const [hooks, { afterAll, afterEach, aroundAll, aroundEach, beforeAll, beforeEach, describe, expect }] of modules) {
          for (const [tests, { test }] of modules) {
            const say = where =>
              console.log(hooks, "hooks,", tests, "test,", where + ":", [...new Set(follows(expect))].join(" and "));
            describe(hooks + " hooks, " + tests + " test", () => {
              beforeAll(() => say("beforeAll"));
              afterAll(() => say("afterAll"));
              beforeEach(() => say("beforeEach"));
              afterEach(() => say("afterEach"));
              aroundAll(async (runSuite) => {
                say("aroundAll before runSuite()");
                await runSuite();
                say("aroundAll after runSuite()");
              });
              aroundEach(async (runTest) => {
                say("aroundEach before runTest()");
                await runTest();
                say("aroundEach after runTest()");
              });
              test("test", () => say("test"));
            });
          }
        }
      `,
    });
    const positions = [
      ["aroundAll before runSuite()", "hooks"],
      ["beforeAll", "hooks"],
      ["aroundEach before runTest()", "tests"],
      ["beforeEach", "tests"],
      ["test", "tests"],
      ["afterEach", "tests"],
      ["aroundEach after runTest()", "tests"],
      ["afterAll", "hooks"],
      ["aroundAll after runSuite()", "hooks"],
    ];
    const modules = ["bun", "vitest"];
    expect({ log, exitCode }).toEqual({
      log: modules.flatMap(hooks =>
        modules.flatMap(tests =>
          positions.map(
            ([where, decides]) => `${hooks} hooks, ${tests} test, ${where}: ${decides === "hooks" ? hooks : tests}`,
          ),
        ),
      ),
      exitCode: 0,
    });
  },
);

// ScopeFunctions::extend and ::for make a Vitest test from either module, so the hooks of that test follow Vitest.
test.concurrent("a hook of a test.extend() or test.for() test from bun:test follows that test", async () => {
  const { log, exitCode } = await runTests({
    "a.test.js": `
      import { afterEach, beforeEach, expect, test } from "bun:test";
      const passes = fn => { try { fn(); return true; } catch { return false; } };
      const follows = () => [
        passes(() => expect(1).not.not.toBe(1)),
        passes(() => expect([1]).toEqual([1, undefined])),
      ].map(passed => (passed ? "bun" : "vitest"));
      const say = where => console.log(where + ":", [...new Set(follows())].join(" and "));
      beforeEach(() => say("beforeEach"));
      afterEach(() => say("afterEach"));
      test("test", () => say("test()"));
      test.each([1])("each %i", () => say("test.each()"));
      test.for([1])("for %i", () => say("test.for()"));
      test.extend({})("extended", () => say("test.extend()"));
    `,
  });
  expect({ log, exitCode }).toEqual({
    log: [
      "beforeEach: bun",
      "test(): bun",
      "afterEach: bun",
      "beforeEach: bun",
      "test.each(): bun",
      "afterEach: bun",
      "beforeEach: vitest",
      "test.for(): vitest",
      "afterEach: vitest",
      "beforeEach: vitest",
      "test.extend(): vitest",
      "afterEach: vitest",
    ],
    exitCode: 0,
  });
});

// Vitest: "if there is another listener, assume that it's handled by user code". The runner of "bun:test" reports the error.
test.concurrent(
  "an error that nobody handles in an around hook goes to the process listeners first only under vitest",
  async () => {
    const { log, results, errors, exitCode } = await runTests({
      "a.test.js": `
        import * as bun from "bun:test";
        import * as vitest from "vitest";
        for (const [name, { aroundAll, aroundEach, describe, test }] of Object.entries({ bun, vitest })) {
          const reject = async where => {
            let taker = "the runner";
            process.removeAllListeners("unhandledRejection");
            process.once("unhandledRejection", () => (taker = "the listener"));
            Promise.reject(new Error(name + " " + where));
            await new Promise(resolve => setImmediate(resolve));
            process.removeAllListeners("unhandledRejection");
            console.log(name, where + ":", taker, "got it");
          };
          describe(name + " aroundAll", () => {
            aroundAll(async (runSuite) => {
              await reject("aroundAll");
              await runSuite();
            });
            test("test", () => {});
          });
          describe(name + " aroundEach", () => {
            aroundEach(async (runTest) => {
              await reject("aroundEach");
              await runTest();
            });
            test("test", () => {});
          });
        }
      `,
    });
    expect({ log, results, errors, exitCode }).toEqual({
      log: [
        "bun aroundAll: the runner got it",
        "bun aroundEach: the runner got it",
        "vitest aroundAll: the listener got it",
        "vitest aroundEach: the listener got it",
      ],
      results: [
        "(pass) bun aroundAll > test",
        "(pass) bun aroundEach > test",
        "(pass) vitest aroundAll > test",
        "(pass) vitest aroundEach > test",
      ],
      errors: ["error: bun aroundAll", "error: bun aroundEach"],
      exitCode: 1,
    });
  },
);
