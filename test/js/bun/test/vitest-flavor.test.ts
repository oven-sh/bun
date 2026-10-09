// What `test`, `describe` and the hooks do depends on the module they are imported from: those of "vitest" behave as
// vitest's, those of "bun:test" and "@jest/globals" as Jest's. Expected outputs were taken from vitest 5.0.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isCI, tempDir } from "harness";
import { readdirSync } from "node:fs";

// A run that never ends is killed, and what it printed is compared: a test that times out leaves it running.
// An ASAN build looks for leaks as it exits, and CI gives it minutes for a test.
const beforeTheTestTimesOut = isASAN && isCI ? 60_000 : 4000;

async function runTests(
  files: Record<string, string>,
  args: string[] = [],
  env: Record<string, string> = {},
  killedAfterMs?: number,
) {
  using dir = tempDir("vitest-flavor", files);
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
  const results = stderr
    .split("\n")
    .filter(line => /^\((pass|fail|skip|todo)\)/.test(line))
    .map(line => line.replace(/ \[[\d.]+ms\]$/, ""));
  const errors = stderr
    .split("\n")
    .filter(line => /^(\w*[eE]rror): /.test(line))
    .map(line => line.replaceAll(String(dir), "<dir>"));
  return {
    log: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")),
    results,
    errors,
    stdout,
    stderr,
    exitCode,
  };
}

describe.concurrent("test context", () => {
  test("a parameter is the context, never a done callback", async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test, it, beforeEach, afterEach } from "vitest";
        beforeEach((ctx) => { console.log("beforeEach", typeof ctx.task); });
        afterEach((ctx) => { console.log("afterEach", typeof ctx.task); });
        test("one parameter", (ctx) => { console.log("test", typeof ctx.task); }, 500);
        it("destructured", ({ expect, task, onTestFinished, skip }) => {
          console.log(typeof expect, task.name, typeof onTestFinished, typeof skip);
        }, 500);
        test("async", async (ctx) => { await 1; console.log("async", ctx.task.name); }, 500);
        test("arguments", function () { console.log("arguments", arguments.length, this); }, 500);
      `,
    });
    expect({ log, results, exitCode }).toEqual({
      log: [
        "beforeEach object",
        "test object",
        "afterEach object",
        "beforeEach object",
        "function destructured function function",
        "afterEach object",
        "beforeEach object",
        "async async",
        "afterEach object",
        "beforeEach object",
        "arguments 1 undefined",
        "afterEach object",
      ],
      results: ["(pass) one parameter", "(pass) destructured", "(pass) async", "(pass) arguments"],
      exitCode: 0,
    });
  });

  test("is a function, which tells a test that was written for a done callback so", async () => {
    const { log, results, errors, exitCode } = await runTests({
      "a.test.js": `
        import { test, beforeEach } from "vitest";
        beforeEach(ctx => { console.log("beforeEach:", typeof ctx); });
        test("a function with the members of the context", ctx => {
          const { task, expect, skip } = ctx;
          console.log(typeof ctx, ctx instanceof Function, task.name === ctx.task.name, typeof expect, typeof skip);
          for (const call of [() => ctx(), () => ctx(new Error("ignored")), () => ctx.call(undefined), () => Reflect.apply(ctx, undefined, [])]) {
            try { console.log(call()); } catch (error) { console.log(error.constructor.name + ":", error.message); }
          }
        });
        test("calls done", done => { done(); });
        test("calls done in a callback", done => { setImmediate(() => done()); });
        test("runs when that callback does", () => new Promise(resolve => setImmediate(resolve)));
      `,
    });
    const message = "done() callback is deprecated, use promise instead";
    expect({ log, results, errors, exitCode }).toEqual({
      log: [
        "beforeEach: function",
        "function true true function function",
        ...Array(4).fill("Error: " + message),
        "beforeEach: function",
        "beforeEach: function",
        "beforeEach: function",
      ],
      results: [
        "(pass) a function with the members of the context",
        "(fail) calls done",
        "(pass) calls done in a callback",
        "(fail) runs when that callback does",
      ],
      errors: ["error: " + message, "error: " + message],
      exitCode: 1,
    });
  });

  test("is one object for the hooks, the test, its retries and its repeats", async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test, beforeEach, afterEach, onTestFinished, onTestFailed } from "vitest";
        let first, attempt = 0;
        beforeEach(function (ctx) {
          console.log("beforeEach", arguments.length, ctx.stash, ctx.task.result.retryCount, ctx.task.result.repeatCount);
          first ??= ctx;
        });
        afterEach(function (ctx) { console.log("afterEach", arguments.length, first === ctx); });
        test("retry", { retry: 2 }, (ctx) => {
          attempt++;
          console.log("attempt", attempt, first === ctx, ctx.stash);
          ctx.stash = attempt;
          onTestFinished(() => console.log("finished", attempt));
          onTestFailed(() => console.log("failed", attempt));
          if (attempt < 3) throw new Error("again");
        });
        test("other test", (ctx) => { console.log("other", first === ctx, ctx.stash); first = undefined; });
        test("repeats", { repeats: 1 }, (ctx) => { console.log("repeat", first === ctx); });
      `,
    });
    expect({ log, results, exitCode }).toEqual({
      log: [
        "beforeEach 1 undefined 0 0",
        "attempt 1 true undefined",
        "afterEach 1 true",
        "finished 1",
        "failed 1",
        "beforeEach 1 1 1 0",
        "attempt 2 true 1",
        "afterEach 1 true",
        "finished 2",
        "failed 2",
        "beforeEach 1 2 2 0",
        "attempt 3 true 2",
        "afterEach 1 true",
        "finished 3",
        "beforeEach 1 undefined 0 0",
        "other false undefined",
        "afterEach 1 false",
        "beforeEach 1 undefined 0 0",
        "repeat true",
        "afterEach 1 true",
        "beforeEach 1 undefined 0 1",
        "repeat true",
        "afterEach 1 true",
      ],
      results: ["(pass) retry (attempt 3)", "(pass) other test", "(pass) repeats (run 2)"],
      exitCode: 0,
    });
  });

  test("task", async () => {
    const { log, exitCode } = await runTests({
      "dir/a.test.js": `
        import { test, describe, beforeAll } from "vitest";
        const show = (task) => console.log(JSON.stringify(task, (key, value) =>
          key === "file" || key === "suite" ? value && value.name : key === "id" ? typeof value : key === "filepath" ? value === import.meta.path : value));
        let outer;
        test("top", ({ task }) => { show(task); show(task.file); console.log(task.file.file === task.file, task.suite); });
        describe("outer", () => {
          beforeAll(({}, suite) => { outer = suite; suite.meta.shared = 1; });
          describe("inner", () => {
            test.fails("nested", { timeout: 1234, retry: 1 }, (ctx) => {
              show(ctx.task);
              show(ctx.task.suite);
              console.log(ctx.task.suite.suite === outer, ctx.task.suite.suite.meta.shared, ctx.task.context === ctx, Object.keys(ctx.task).includes("context"));
              ctx.task.meta.mine = true;
              console.log(ctx.task === ctx.task, JSON.stringify(ctx.task.meta), Object.getPrototypeOf(ctx.task.meta));
              throw new Error("expected");
            });
          });
        });
        test.concurrent("concurrent", ({ task }) => { console.log(task.concurrent); });
      `,
    });
    expect({ log, exitCode }).toEqual({
      log: [
        `{"id":"string","type":"test","name":"top","fullTestName":"top","fullName":"dir/a.test.js > top","mode":"run","file":"dir/a.test.js","timeout":5000,"retry":0,"repeats":0,"meta":{},"annotations":[],"result":{"state":"run","retryCount":0,"repeatCount":0}}`,
        `{"type":"suite","mode":"run","meta":{},"name":"dir/a.test.js","fullName":"dir/a.test.js","filepath":true,"file":"dir/a.test.js"}`,
        "true undefined",
        `{"id":"string","type":"test","name":"nested","fullTestName":"outer > inner > nested","fullName":"dir/a.test.js > outer > inner > nested","mode":"run","file":"dir/a.test.js","suite":"inner","fails":true,"timeout":1234,"retry":1,"repeats":0,"meta":{},"annotations":[],"result":{"state":"run","retryCount":0,"repeatCount":0}}`,
        `{"type":"suite","mode":"run","meta":{},"name":"inner","fullTestName":"outer > inner","fullName":"dir/a.test.js > outer > inner","file":"dir/a.test.js","suite":"outer"}`,
        "true 1 true false",
        `true {"mine":true} null`,
        "true",
      ],
      exitCode: 0,
    });
  });

  test("task.result follows the test", async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test, beforeEach, afterEach, expect, onTestFinished, onTestFailed } from "vitest";
        const show = (where, { task }) => console.log(where, task.name + ":", task.result.state, JSON.stringify(task.result.errors?.map((error) => error.message)));
        beforeEach((ctx) => show("beforeEach", ctx));
        afterEach((ctx) => show("afterEach", ctx));
        test("passes", (ctx) => { show("test", ctx); onTestFinished((ctx) => show("finished", ctx)); });
        test("throws", (ctx) => { const { result } = ctx.task; onTestFailed((ctx) => { show("failed", ctx); console.log(result === ctx.task.result); }); throw new Error("boom"); });
        test("throws a string", () => { throw "text"; });
        test("rejects", async () => { await 1; throw new TypeError("later"); });
        test("counts", () => { expect.assertions(2); expect(1).toBe(1); });
        test.each([1])("row %i", () => { throw new Error("in a row"); });
      `,
    });
    expect({ log, results, exitCode }).toEqual({
      log: [
        "beforeEach passes: run undefined",
        "test passes: run undefined",
        "afterEach passes: pass undefined",
        "finished passes: pass undefined",
        "beforeEach throws: run undefined",
        `afterEach throws: fail ["boom"]`,
        `failed throws: fail ["boom"]`,
        "true",
        "beforeEach throws a string: run undefined",
        `afterEach throws a string: fail ["text"]`,
        "beforeEach rejects: run undefined",
        `afterEach rejects: fail ["later"]`,
        "beforeEach counts: run undefined",
        "afterEach counts: fail undefined",
        "beforeEach row 1: run undefined",
        `afterEach row 1: fail ["in a row"]`,
      ],
      results: [
        "(pass) passes",
        "(fail) throws",
        "(fail) throws a string",
        "(fail) rejects",
        "(fail) counts",
        "(fail) row 1",
      ],
      exitCode: 1,
    });
  });

  test("skip()", async () => {
    const { log, results, errors, exitCode } = await runTests({
      "a.test.js": `
        import { test, describe, beforeEach, afterEach, onTestFinished, onTestFailed } from "vitest";
        describe("in the test", () => {
          afterEach(({ task }) => console.log("afterEach", task.name + ":", task.result.state, task.result.pending, task.result.note));
          test("skip()", (ctx) => {
            onTestFinished(() => console.log("finished"));
            onTestFailed(() => console.log("unreachable"));
            ctx.skip();
            console.log("unreachable");
          });
          test("skip(note)", (ctx) => { ctx.skip("a note"); console.log("unreachable"); });
          test("skip(false)", (ctx) => { ctx.skip(false); console.log("skip(false) goes on"); });
          test("skip(false, note)", (ctx) => { ctx.skip(false, "a note"); console.log("skip(false, note) goes on"); });
          test("skip(true, note)", (ctx) => { ctx.skip(true, "when true"); console.log("unreachable"); });
          test("skip(0)", (ctx) => { ctx.skip(0); console.log("unreachable"); });
          test("skip(undefined)", (ctx) => { ctx.skip(undefined); console.log("unreachable"); });
          test("destructured", ({ skip }) => { skip(); console.log("unreachable"); });
          test("async", async (ctx) => { await 1; ctx.skip(); console.log("unreachable"); });
          test("caught", (ctx) => { try { ctx.skip(); } catch (error) { console.log("caught:", error.message); } });
          test("caught, then throws", (ctx) => { try { ctx.skip(); } catch {} throw new Error("not reported"); });
          test("with retry", { retry: 2 }, (ctx) => { console.log("one attempt"); ctx.skip(); });
          test("with repeats", { repeats: 2 }, (ctx) => { console.log("one repeat"); ctx.skip(); });
          test.concurrent("concurrent 1", async (ctx) => { await 1; ctx.skip(); });
          test.concurrent("concurrent 2", async () => { await 1; });
        });
        describe("in beforeEach", () => {
          beforeEach((ctx) => ctx.skip());
          afterEach(() => console.log("afterEach still runs"));
          test("test", () => console.log("unreachable"));
        });
        describe("in afterEach", () => {
          afterEach((ctx) => ctx.skip());
          test("test", () => console.log("the test ran"));
        });
      `,
    });
    expect({ log, results, errors, exitCode }).toEqual({
      log: [
        "afterEach skip(): skip true undefined",
        "finished",
        "afterEach skip(note): skip true a note",
        "skip(false) goes on",
        "afterEach skip(false): pass undefined undefined",
        "skip(false, note) goes on",
        "afterEach skip(false, note): pass undefined undefined",
        "afterEach skip(true, note): skip true when true",
        "afterEach skip(0): skip true undefined",
        "afterEach skip(undefined): skip true undefined",
        "afterEach destructured: skip true undefined",
        "afterEach async: skip true undefined",
        "caught: test is skipped; abort execution",
        "afterEach caught: skip true undefined",
        "afterEach caught, then throws: skip true undefined",
        "one attempt",
        "afterEach with retry: skip true undefined",
        "one repeat",
        "afterEach with repeats: skip true undefined",
        "afterEach concurrent 1: skip true undefined",
        "afterEach concurrent 2: pass undefined undefined",
        "afterEach still runs",
        "the test ran",
      ],
      results: [
        "(skip) in the test > skip()",
        "(skip) in the test > skip(note)",
        "(pass) in the test > skip(false)",
        "(pass) in the test > skip(false, note)",
        "(skip) in the test > skip(true, note)",
        "(skip) in the test > skip(0)",
        "(skip) in the test > skip(undefined)",
        "(skip) in the test > destructured",
        "(skip) in the test > async",
        "(skip) in the test > caught",
        "(skip) in the test > caught, then throws",
        "(skip) in the test > with retry",
        "(skip) in the test > with repeats",
        "(skip) in the test > concurrent 1",
        "(pass) in the test > concurrent 2",
        "(skip) in beforeEach > test",
        "(skip) in afterEach > test",
      ],
      errors: [],
      exitCode: 0,
    });
  });

  test("onTestFinished and onTestFailed run after the hooks, last registered first", async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test, afterEach, onTestFinished, onTestFailed } from "vitest";
        afterEach(() => console.log("afterEach"));
        test("passes", (ctx) => {
          onTestFinished(() => console.log("finished 1"));
          ctx.onTestFinished(() => console.log("finished 2"));
          onTestFailed(() => console.log("unreachable"));
          onTestFinished(function (arg) { console.log("finished 3", arguments.length, arg === ctx); });
        });
        test("fails", (ctx) => {
          onTestFinished(() => console.log("finished 1"));
          onTestFailed(() => console.log("failed 1"));
          ctx.onTestFailed(function (arg) { console.log("failed 2", arguments.length, arg === ctx); });
          onTestFinished(async () => { await 1; console.log("finished 2"); });
          throw new Error("boom");
        });
        test("a callback that throws fails the test, and the others still run", () => {
          onTestFailed(() => console.log("failed"));
          onTestFinished(() => console.log("finished 1"));
          onTestFinished(() => { throw new Error("in onTestFinished"); });
        });
        test.fails("test.fails that throws", () => {
          onTestFailed(() => console.log("failed, as expected"));
          throw new Error("expected");
        });
      `,
    });
    expect({ log, results, exitCode }).toEqual({
      log: [
        "afterEach",
        "finished 3 1 true",
        "finished 2",
        "finished 1",
        "afterEach",
        "finished 2",
        "finished 1",
        "failed 2 1 true",
        "failed 1",
        "afterEach",
        "finished 1",
        "failed",
        "afterEach",
        "failed, as expected",
      ],
      results: [
        "(pass) passes",
        "(fail) fails",
        "(fail) a callback that throws fails the test, and the others still run",
        "(pass) test.fails that throws",
      ],
      exitCode: 1,
    });
  });

  test("onTestFinished and onTestFailed of the context, in concurrent tests", async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test } from "vitest";
        for (const name of ["a", "b", "c"]) {
          test.concurrent(name, async ({ onTestFinished, onTestFailed, task }) => {
            onTestFinished(() => console.log("finished", task.name));
            onTestFailed(() => console.log("failed", task.name));
            await 1;
            if (name === "b") throw new Error("boom");
          });
        }
      `,
    });
    expect({ log: log.sort(), results: results.sort(), exitCode }).toEqual({
      log: ["failed b", "finished a", "finished b", "finished c"],
      results: ["(fail) b", "(pass) a", "(pass) c"],
      exitCode: 1,
    });
  });

  test("onTestFinished and onTestFailed outside of a test", async () => {
    const { log, exitCode } = await runTests({
      "a.test.js": `
        import { test, beforeAll, onTestFinished, onTestFailed } from "vitest";
        const message = (fn) => { try { fn(); return "no error"; } catch (error) { return error.message; } };
        console.log(message(() => onTestFailed(() => {})));
        console.log(message(() => onTestFailed()));
        beforeAll(() => { console.log(message(() => onTestFinished(() => {}))); });
        let kept;
        test("a", (ctx) => { kept = ctx; console.log(message(() => ctx.onTestFinished("no"))); });
        test("b", () => {
          console.log(message(() => kept.onTestFinished(() => {})));
          console.log(message(() => kept.skip()));
          console.log(message(() => kept.annotate("late")));
          console.log(kept.task.name, kept.task.result.state);
        });
        test.concurrent("c", async () => { await 1; console.log(message(() => onTestFailed(() => {}))); });
        test.concurrent("d", async () => { await 1; });
      `,
    });
    expect({ log, exitCode }).toEqual({
      log: [
        "Cannot call onTestFailed() outside of a test. It can only be called inside a test.",
        "onTestFailed() expects a function as the first argument",
        "Cannot call onTestFinished() here. It can only be called inside a test.",
        "onTestFinished() expects a function as the first argument",
        "Cannot call onTestFinished() after its test has finished",
        "Cannot call skip() after its test has finished",
        "Cannot call annotate() after its test has finished",
        "a pass",
        "Cannot call onTestFailed() here. It cannot be called inside a concurrent test. Use the one of the test context: test(name, ({ onTestFailed }) => {})",
      ],
      exitCode: 0,
    });
  });

  test("signal is aborted when the test times out", async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test, onTestFinished } from "vitest";
        test("in time", ({ signal }) => {
          console.log(signal instanceof AbortSignal, signal.aborted);
          onTestFinished((ctx) => console.log("finished", ctx.signal === signal, signal.aborted));
        });
        test("times out", { timeout: 20 }, async ({ signal }) => {
          onTestFinished(() => console.log("finished", signal.aborted));
          await new Promise((resolve, reject) => signal.addEventListener("abort", () => { console.log("abort", signal.reason.name); reject(signal.reason); }));
        });
        test("looks at the signal afterwards", { timeout: 20 }, async () => {
          onTestFinished((ctx) => console.log("finished", ctx.signal.aborted));
          await new Promise(() => {});
        });
      `,
    });
    expect({ log, results, exitCode }).toEqual({
      log: ["true false", "finished true false", "abort TimeoutError", "finished true", "finished true"],
      results: ["(pass) in time", "(fail) times out", "(fail) looks at the signal afterwards"],
      exitCode: 1,
    });
  });

  test("annotate() records into task.annotations", async () => {
    const { log, exitCode } = await runTests({
      "a.test.js": `
        import { test } from "vitest";
        test("a", async ({ annotate, task }) => {
          console.log(JSON.stringify(await annotate("plain")));
          await annotate("typed", "warning");
          await annotate("attached", { path: "./file.txt" });
          await annotate("both", "error", { body: "text" });
          console.log(JSON.stringify(task.annotations));
        });
      `,
    });
    expect({ log, exitCode }).toEqual({
      log: [
        `{"message":"plain","type":"notice"}`,
        `[{"message":"plain","type":"notice"},{"message":"typed","type":"warning"},{"message":"attached","type":"notice","attachment":{"path":"./file.txt"}},{"message":"both","type":"error","attachment":{"body":"text"}}]`,
      ],
      exitCode: 0,
    });
  });

  test("expect belongs to its test, also among concurrent tests", async () => {
    const { log, results, stderr, exitCode } = await runTests(
      {
        "a.test.js": `
          import { test, expect as globalExpect } from "vitest";
          const { promise: bothStarted, resolve } = Promise.withResolvers();
          let started = 0;
          const start = () => { if (++started === 2) resolve(); return bothStarted; };
          test.concurrent("counts its own", async ({ expect }) => {
            expect.assertions(2);
            expect(1).toBe(1);
            await start();
            expect(2).toBe(2);
            console.log(expect.getState().currentTestName, expect.getState().assertionCalls);
          });
          test.concurrent("counts too few", async ({ expect }) => {
            expect.assertions(3);
            await start();
            expect(1).toBe(1);
          });
          test.concurrent("has none", async ({ expect }) => { expect.hasAssertions(); await 1; });
          test.concurrent("snapshot 1", async ({ expect }) => { await 1; expect("one").toMatchSnapshot(); expect("two").toMatchSnapshot(); });
          test.concurrent("snapshot 2", async ({ expect }) => { await 1; expect("three").toMatchSnapshot(); });
          test("has what expect has", ({ expect }) => {
            console.log(expect !== globalExpect, Object.getPrototypeOf(expect) === globalExpect, typeof expect.any, typeof expect.extend);
            expect({ a: 1 }).toEqual({ a: expect.any(Number) });
            expect({ a: 1, b: Promise.resolve(1), c: Promise.reject(1) }).toEqual({
              a: expect.not.any(String),
              b: expect.resolvesTo.any(Number),
              c: expect.rejectsTo.any(Number),
            });
            expect(() => expect(1).toBe(2)).toThrow();
            expect("x", "label").not.toBe("y");
          });
        `,
      },
      ["--update-snapshots"],
    );
    expect(stderr).toContain("expected 3 assertions, but test ended with 1 assertion");
    expect(stderr).toContain("received 0 assertions, but expected at least one assertion to be called");
    expect(stderr).toContain("snapshots: +3 added");
    expect({ log, results: results.sort(), exitCode }).toEqual({
      log: ["counts its own 2", "true true function function"],
      results: [
        "(fail) counts too few",
        "(fail) has none",
        "(pass) counts its own",
        "(pass) has what expect has",
        "(pass) snapshot 1",
        "(pass) snapshot 2",
      ],
      exitCode: 1,
    });
  });

  test("snapshots of concurrent tests are written under their names", async () => {
    using dir = tempDir("vitest-flavor-snapshot", {
      "a.test.js": `
        import { test } from "vitest";
        test.concurrent("first", async ({ expect }) => { await 1; expect("one").toMatchSnapshot(); expect("two").toMatchSnapshot(); });
        test.concurrent("second", async ({ expect }) => { await 1; expect("three").toMatchSnapshot(); });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test"],
      env: { ...bunEnv, CI: "false" },
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const written = await Bun.file(`${dir}/__snapshots__/a.test.js.snap`).text();
    expect(written.split("\n").filter(line => line.startsWith("exports["))).toEqual([
      'exports[`first 1`] = `"one"`;',
      'exports[`first 2`] = `"two"`;',
      'exports[`second 1`] = `"three"`;',
    ]);
    expect(stderr).toContain("2 pass");
    expect(exitCode).toBe(0);
  });

  test("is collected after its test", async () => {
    const { log, exitCode } = await runTests({
      "a.test.js": `
        import { test, beforeEach, afterAll } from "vitest";
        import { heapStats } from "bun:jsc";
        beforeEach((ctx) => { ctx.big = new Array(1000).fill(ctx); return () => {}; });
        for (let i = 0; i < 200; i++) test("test " + i, ({ task, expect, signal, onTestFinished }) => { onTestFinished(() => task); });
        test("count", () => {
          Bun.gc(true);
          console.log(heapStats().objectTypeCounts.TestContext < 10);
        });
      `,
    });
    expect({ log, exitCode }).toEqual({ log: ["true"], exitCode: 0 });
  });
});

describe.concurrent("beforeAll and afterAll", () => {
  test("get ({}, suite)", async () => {
    const { log, exitCode } = await runTests({
      "a.test.js": `
        import { test, describe, beforeAll, afterAll } from "vitest";
        const show = (where, args) => console.log(where, args.length, JSON.stringify(args[0]), args[1].type, args[1].name);
        beforeAll(function () { show("file beforeAll", arguments); });
        afterAll(function () { show("file afterAll", arguments); });
        describe("block", () => {
          let seen;
          beforeAll(function () { show("beforeAll", arguments); seen = arguments[1]; });
          afterAll(({}, suite) => { console.log("afterAll", suite === seen); });
          test("a", ({ task }) => { console.log(task.suite === seen); });
        });
      `,
    });
    expect({ log, exitCode }).toEqual({
      log: [
        "file beforeAll 2 {} suite a.test.js",
        "beforeAll 2 {} suite block",
        "true",
        "afterAll true",
        "file afterAll 2 {} suite a.test.js",
      ],
      exitCode: 0,
    });
  });

  test("fail if their first parameter is not an empty object pattern", async () => {
    const { log, results, errors, stderr, exitCode } = await runTests({
      "a.test.js": `
        import { test, describe, beforeAll, afterAll } from "vitest";
        const block = (name, register) => describe(name, () => { register(); test("test", () => console.log(name + ": the test ran")); });
        block("identifier", () => { beforeAll((suite) => console.log("unreachable")); afterAll(() => console.log("afterAll still runs")); });
        block("function", () => beforeAll(function (suite) { console.log("unreachable"); }));
        block("async", () => beforeAll(async (suite) => { console.log("unreachable"); }));
        block("without parentheses", () => beforeAll(suite => console.log("unreachable")));
        block("default", () => beforeAll((a = 1) => console.log("unreachable")));
        block("rest", () => beforeAll((...args) => console.log("unreachable")));
        block("array", () => beforeAll(([a]) => console.log("unreachable")));
        block("properties", () => beforeAll(({ a, "b": c, d = /}/, e: { f } }, suite) => console.log("unreachable")));
        block("rest property", () => beforeAll(({ ...rest }) => console.log("unreachable")));
        block("afterAll", () => afterAll((suite) => console.log("unreachable")));
        block("empty", () => beforeAll(({}, suite) => console.log("empty: ran")));
        block("comment", () => beforeAll((/* ( */ { /* a */ } /* ) */, suite) => console.log("comment: ran")));
        block("none", () => beforeAll(() => console.log("none: ran")));
        block("bound", () => beforeAll(function (suite) { console.log("bound: ran", typeof suite); }.bind(null)));
      `,
    });
    const hint = (name: string) => `The suite is the second argument: ${name}(({}, suite) => {})`;
    const pattern = (name: string) =>
      `error: ${name}() expects the first parameter of its callback to be an object destructuring pattern`;
    expect({ log, results, errors, exitCode }).toEqual({
      log: [
        "afterAll still runs",
        "afterAll: the test ran",
        "empty: ran",
        "empty: the test ran",
        "comment: ran",
        "comment: the test ran",
        "none: ran",
        "none: the test ran",
        "bound: ran object",
        "bound: the test ran",
      ],
      results: [
        "(fail) identifier > (unnamed)",
        "(fail) function > (unnamed)",
        "(fail) async > (unnamed)",
        "(fail) without parentheses > (unnamed)",
        "(fail) default > (unnamed)",
        "(fail) rest > (unnamed)",
        "(fail) array > (unnamed)",
        "(fail) properties > (unnamed)",
        "(fail) rest property > (unnamed)",
        "(pass) afterAll > test",
        "(fail) afterAll > (unnamed)",
        "(pass) empty > test",
        "(pass) comment > test",
        "(pass) none > test",
        "(pass) bound > test",
      ],
      errors: [
        `${pattern("beforeAll")}, received "suite". ${hint("beforeAll")}`,
        `${pattern("beforeAll")}, received "suite". ${hint("beforeAll")}`,
        `${pattern("beforeAll")}, received "suite". ${hint("beforeAll")}`,
        `${pattern("beforeAll")}, received "suite". ${hint("beforeAll")}`,
        `${pattern("beforeAll")}, received "a". ${hint("beforeAll")}`,
        `${pattern("beforeAll")}. ${hint("beforeAll")}`,
        `${pattern("beforeAll")}. ${hint("beforeAll")}`,
        `error: beforeAll() has no fixtures for its callback, which destructures "a", "b", "d", "e". ${hint("beforeAll")}`,
        `error: beforeAll() has no fixtures for its callback, which destructures a rest property. ${hint("beforeAll")}`,
        `${pattern("afterAll")}, received "suite". ${hint("afterAll")}`,
      ],
      exitCode: 1,
    });
    // The error is reported where the hook was registered.
    expect(stderr).toContain("a.test.js:4:37");
  });

  test("do not run in a scope whose tests are all skipped", async () => {
    const files = (module: string) => ({
      "a.test.js": `
        import { test, describe, beforeAll, afterAll } from "${module}";
        beforeAll(() => console.log("file beforeAll"));
        afterAll(() => console.log("file afterAll"));
        describe("block", () => {
          beforeAll(() => console.log("beforeAll"));
          afterAll(() => console.log("afterAll"));
          test.skip("skipped", () => {});
        });
      `,
    });
    const [vitest, bun] = await Promise.all([runTests(files("vitest")), runTests(files("bun:test"))]);
    expect(vitest.log).toEqual([]);
    expect(vitest.results).toEqual(["(skip) block > skipped"]);
    expect(bun.log).toEqual(["file beforeAll", "beforeAll", "afterAll", "file afterAll"]);
  });
});

describe.concurrent("each and for", () => {
  test("titles: long strings, values that are missing, %p and %s", async () => {
    const file = (module: string) => `
      import { test } from "${module}";
      const digits = count => Buffer.alloc(count, "0123456789").toString();
      const title = (rows, title) => test.each(rows)(title, () => {});
      title([{ name: digits(40) }], "fits: $name");
      title([{ name: digits(41) }], "cut: $name");
      title([{ name: Buffer.alloc(90, "é").toString() }], "two bytes: $name");
      title([{ name: Buffer.alloc(100, "😀").toString() }], "surrogates: $name");
      title([[digits(41)]], "not cut: %s");
      title([{ a: { b: "nested" } }], "missing: $a.b $missing $a.missing");
      title([[1]], "no value left: %d %d %i %f %s %j %o %O");
      title([[1]], "unknown: %p");
      title([[[1, 2]], [/x/g], [{ toString: () => "own" }], [{ a: 1 }]], "toString: %s");
    `;
    const [vitest, bun] = await Promise.all([
      runTests({ "a.test.js": file("vitest") }),
      runTests({ "a.test.js": file("bun:test") }),
    ]);
    const digits = (count: number) => Buffer.alloc(count, "0123456789").toString();
    expect(vitest.results.map(line => line.slice("(pass) ".length))).toEqual([
      "fits: " + digits(40),
      "cut: " + digits(39) + "…",
      "two bytes: " + Buffer.alloc(78, "é").toString() + "…",
      "surrogates: " + Buffer.alloc(76, "😀").toString() + "…",
      "not cut: " + digits(41),
      "missing: nested undefined undefined",
      "no value left: 1 NaN NaN NaN undefined undefined undefined undefined",
      "unknown: %p",
      "toString: 1,2",
      "toString: /x/g",
      "toString: own",
      "toString: { a: 1 }",
    ]);
    expect(bun.results.map(line => line.slice("(pass) ".length))).toEqual([
      "fits: " + digits(40),
      "cut: " + digits(41),
      "two bytes: " + Buffer.alloc(90, "é").toString(),
      "surrogates: " + Buffer.alloc(100, "😀").toString(),
      "not cut: " + digits(41),
      "missing: nested $missing $a.missing",
      "no value left: 1 %d %i %f %s %j %o %O",
      "unknown: 1",
      "toString: [ 1, 2 ]",
      "toString: /x/g",
      "toString: own",
      "toString: { a: 1 }",
    ]);
  });

  test("each: a parameter beyond the values of the row is undefined", async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test, describe } from "vitest";
        const show = (name, args) => console.log(name, args.length, JSON.stringify([...args]));
        test.each([[1, 2], [3, 4]])("array %i %i", function (a, b, c, d) { show("array", arguments); console.log(c, d); }, 500);
        test.each([1, 2])("scalar %i", function (a, b) { show("scalar", arguments); }, 500);
        test.each([{ a: 1 }])("object $a", function (a, b) { show("object", arguments); }, 500);
        test.each([[1, 2], 3])("mixed %s", function (a, b) { show("mixed", arguments); }, 500);
        test.each([[[1, 2]], [[3]]])("nested %j", function (a, b) { show("nested", arguments); }, 500);
        test.each([[]])("empty", function (a) { show("empty", arguments); }, 500);
        test.each\`
          a
          \${1}
        \`("template $a", function (row, b) { show("template", arguments); }, 500);
        describe.each([[1, 2]])("describe %i %i", function (a, b, c) { show("describe", arguments); test("test", () => {}); });
      `,
    });
    expect({ log, results, exitCode }).toEqual({
      log: [
        "describe 2 [1,2]",
        "array 2 [1,2]",
        "undefined undefined",
        "array 2 [3,4]",
        "undefined undefined",
        "scalar 1 [1]",
        "scalar 1 [2]",
        `object 1 [{"a":1}]`,
        "mixed 1 [[1,2]]",
        "mixed 1 [3]",
        "nested 1 [[1,2]]",
        "nested 1 [[3]]",
        "empty 0 []",
        `template 1 [{"a":1}]`,
      ],
      results: [
        "(pass) array 1 2",
        "(pass) array 3 4",
        "(pass) scalar 1",
        "(pass) scalar 2",
        "(pass) object 1",
        "(pass) mixed 1",
        "(pass) mixed 3",
        "(pass) nested [1,2]",
        "(pass) nested [3]",
        "(pass) empty",
        "(pass) template 1",
        "(pass) describe 1 2 > test",
      ],
      exitCode: 0,
    });
  });

  for (const module of ["vitest", "bun:test"]) {
    test(`for, from "${module}": the row is one argument, the context the next`, async () => {
      const { log, results, exitCode } = await runTests({
        "a.test.js": `
          import { test, it, describe } from "${module}";
          test.for([[1, 2], [3, 4]])("array %i %i", function (row, ctx, more) {
            console.log("array", arguments.length, JSON.stringify(row), ctx.task.name, more);
          });
          it.for([1])("scalar %i", (row, { task, expect }) => { console.log("scalar", row, task.name); expect(row).toBe(1); });
          test.for([{ a: 1, b: { c: 2 } }])("object $a $b.c", (row, { task }) => { console.log("object", JSON.stringify(row), task.name); });
          test.for([1])("options %i", { timeout: 1234 }, (row, { task }) => { console.log("options", task.timeout); });
          test.for([1])("timeout %i", (row, { task }) => { console.log("timeout", task.timeout); }, 2345);
          test.skip.for([1, 2])("skipped %i", () => { console.log("unreachable"); });
          test.concurrent.for([1, 2])("concurrent %i", async (row, { expect }) => { expect.assertions(1); await 1; expect(row).toBeGreaterThan(0); });
          describe.for([[1, 2]])("describe %i %i", function (row) { console.log("describe", arguments.length, JSON.stringify(row)); test("test", () => {}); });
          describe.for([7])("describe %i", function (row) { console.log("describe", arguments.length, row); test("test", () => {}); });
          try { test.for([1]).for([2]); } catch (error) { console.log(error.message); }
          try { test.each([1]).for([2]); } catch (error) { console.log(error.message); }
          try { test.for(1); } catch (error) { console.log(error.message); }
        `,
      });
      expect({ log, results, exitCode }).toEqual({
        log: [
          "Cannot for on test.for()",
          "Cannot for on test.each()",
          "Expected array, got 1",
          "describe 1 [1,2]",
          "describe 1 7",
          "array 2 [1,2] array 1 2 undefined",
          "array 2 [3,4] array 3 4 undefined",
          "scalar 1 scalar 1",
          `object {"a":1,"b":{"c":2}} object 1 2`,
          "options 1234",
          "timeout 2345",
        ],
        results: [
          "(pass) array 1 2",
          "(pass) array 3 4",
          "(pass) scalar 1",
          "(pass) object 1 2",
          "(pass) options 1",
          "(pass) timeout 1",
          "(skip) skipped 1",
          "(skip) skipped 2",
          "(pass) concurrent 1",
          "(pass) concurrent 2",
          "(pass) describe 1 2 > test",
          "(pass) describe 7 > test",
        ],
        exitCode: 0,
      });
    });
  }

  for (const module of ["vitest", "bun:test", "@jest/globals"]) {
    test(`a table written as a tagged template, from "${module}"`, async () => {
      const { log, results, exitCode } = await runTests({
        "a.test.js": `
          import { test, describe } from "${module}";
          test.each\`
            a       | b      | sum
            \${1}    | \${2}   | \${3}
            \${"x"}  | \${"y"} | \${"xy"}
          \`("$a + $b = $sum", function (row) { console.log(arguments.length, JSON.stringify(row)); });
          describe.each\`
            name
            \${"one"}
          \`("block $name", ({ name }) => { test("test", () => console.log(name)); });
        `,
      });
      expect({ log, results, exitCode }).toEqual({
        log: [`1 {"a":1,"b":2,"sum":3}`, `1 {"a":"x","b":"y","sum":"xy"}`, "one"],
        results: ["(pass) 1 + 2 = 3", "(pass) x + y = xy", "(pass) block one > test"],
        exitCode: 0,
      });
    });
  }

  test("a tagged template that is not a complete table", async () => {
    const file = (module: string) => `
      import { test } from "${module}";
      const attempt = (fn) => { try { fn(); } catch (error) { console.log(error.message); } };
      attempt(() => test.each\`a|b\n\${1}|\${2}\n\${3}\`("incomplete row $a $b", () => {}));
      attempt(() => test.each\`a|b\`("no values", (row) => console.log(JSON.stringify(row))));
      attempt(() => test.each\`\`("empty", (row) => console.log(JSON.stringify(row))));
      test("another", () => {});
    `;
    const [vitest, bun, jest] = await Promise.all(
      ["vitest", "bun:test", "@jest/globals"].map(module => runTests({ "a.test.js": file(module) })),
    );
    expect({ log: vitest.log, results: vitest.results, exitCode: vitest.exitCode }).toEqual({
      log: [`"a|b"`, `""`],
      results: ["(pass) incomplete row 1 2", "(pass) no values", "(pass) empty", "(pass) another"],
      exitCode: 0,
    });
    for (const { log, results, exitCode } of [bun, jest]) {
      expect({ log, results, exitCode }).toEqual({
        log: [
          `Expected a value for each of the 2 headings "a|b" in every row of the table, received 3 values`,
          `Expected a value for each of the 2 headings "a|b" in every row of the table, received 0 values`,
          `Expected a value for each of the 1 headings "" in every row of the table, received 0 values`,
        ],
        results: ["(pass) another"],
        exitCode: 0,
      });
    }
  });

  test("for: a table written as a tagged template", async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test } from "vitest";
        test.for\`
          a    | b
          \${1} | \${2}
        \`("$a $b", (row, { task }) => { console.log(JSON.stringify(row), task.name); });
      `,
    });
    expect({ log, results, exitCode }).toEqual({ log: [`{"a":1,"b":2} 1 2`], results: ["(pass) 1 2"], exitCode: 0 });
  });

  test.each(["vitest", "bun:test"])("a heading of a tagged template may be an array index: %s", async module => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test } from ${JSON.stringify(module)};
        test.each\`
          0    | 1    | a
          \${1} | \${2} | \${3}
        \`("$0 $1 $a", row => { console.log(JSON.stringify(row), row[0], row[1], Object.keys(row).join()); });
      `,
    });
    expect({ log, results, exitCode }).toEqual({
      log: [`{"0":1,"1":2,"a":3} 1 2 0,1,a`],
      results: ["(pass) 1 2 3"],
      exitCode: 0,
    });
  });

  test.each(["vitest", "bun:test"])("%%s of a Proxy whose traps lead nowhere: %s", async module => {
    const { results, exitCode } = await runTests({
      "a.test.js": `
        import { test } from ${JSON.stringify(module)};
        const endless = new Proxy({}, { getPrototypeOf: () => endless, getOwnPropertyDescriptor: () => undefined });
        class Named { toString() { return "named"; } }
        test.each([[endless], [Object.create(endless)], [new Proxy(new Named(), {})], [new Proxy({}, { get() { throw new Error("trap"); } })]])("%s", () => {});
      `,
    });
    expect({ results, exitCode }).toEqual({
      results: ["(pass) {}", "(pass) {}", "(pass) named", "(pass) {}"],
      exitCode: 0,
    });
  });
});

describe.concurrent("hooks", () => {
  const hooks = (module: string) => `
    import { test, describe, beforeAll, beforeEach, afterEach, afterAll } from "${module}";
    beforeAll(() => console.log("file beforeAll 1"));
    beforeAll(() => console.log("file beforeAll 2"));
    afterAll(() => console.log("file afterAll 1"));
    afterAll(() => console.log("file afterAll 2"));
    beforeEach(() => console.log("file beforeEach 1"));
    beforeEach(() => console.log("file beforeEach 2"));
    afterEach(() => console.log("file afterEach 1"));
    afterEach(() => console.log("file afterEach 2"));
    describe("block", () => {
      beforeAll(() => console.log("beforeAll 1"));
      beforeAll(() => console.log("beforeAll 2"));
      afterAll(() => console.log("afterAll 1"));
      afterAll(() => console.log("afterAll 2"));
      beforeEach(() => console.log("beforeEach 1"));
      beforeEach(() => console.log("beforeEach 2"));
      afterEach(() => console.log("afterEach 1"));
      afterEach(() => console.log("afterEach 2"));
      test("test", () => console.log("test"));
    });
  `;
  const before = [
    "file beforeAll 1",
    "file beforeAll 2",
    "beforeAll 1",
    "beforeAll 2",
    "file beforeEach 1",
    "file beforeEach 2",
    "beforeEach 1",
    "beforeEach 2",
    "test",
  ];

  test("the after-hooks of a scope run last registered first", async () => {
    const { log, exitCode } = await runTests({ "a.test.js": hooks("vitest") });
    expect({ log, exitCode }).toEqual({
      log: [
        ...before,
        "afterEach 2",
        "afterEach 1",
        "file afterEach 2",
        "file afterEach 1",
        "afterAll 2",
        "afterAll 1",
        "file afterAll 2",
        "file afterAll 1",
      ],
      exitCode: 0,
    });
  });

  for (const module of ["bun:test", "@jest/globals"]) {
    test(`those of "${module}" still run in the order they were registered`, async () => {
      const { log, exitCode } = await runTests({ "a.test.js": hooks(module) });
      expect({ log, exitCode }).toEqual({
        log: [
          ...before,
          "afterEach 1",
          "afterEach 2",
          "file afterEach 1",
          "file afterEach 2",
          "afterAll 1",
          "afterAll 2",
          "file afterAll 1",
          "file afterAll 2",
        ],
        exitCode: 0,
      });
    });
  }

  test("of both kinds in one scope: vitest's first, last registered first, then the others in order", async () => {
    const { log, exitCode } = await runTests({
      "a.test.js": `
        import * as vitest from "vitest";
        import * as bun from "bun:test";
        bun.afterEach(() => console.log("bun afterEach 1"));
        vitest.afterEach(() => console.log("vitest afterEach 1"));
        bun.afterEach(() => console.log("bun afterEach 2"));
        vitest.afterEach(() => console.log("vitest afterEach 2"));
        bun.afterAll(() => console.log("bun afterAll 1"));
        vitest.beforeAll(() => () => console.log("vitest beforeAll teardown"));
        vitest.afterAll(() => console.log("vitest afterAll 1"));
        bun.afterAll(() => console.log("bun afterAll 2"));
        vitest.afterAll(() => console.log("vitest afterAll 2"));
        bun.test("test", () => {});
      `,
    });
    expect({ log, exitCode }).toEqual({
      log: [
        "vitest afterEach 2",
        "vitest afterEach 1",
        "bun afterEach 1",
        "bun afterEach 2",
        "vitest afterAll 2",
        "vitest afterAll 1",
        "bun afterAll 1",
        "bun afterAll 2",
        "vitest beforeAll teardown",
      ],
      exitCode: 0,
    });
  });

  test("a function that beforeEach or beforeAll returns is a teardown", async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test, describe, beforeAll, beforeEach, afterEach, afterAll, onTestFinished } from "vitest";
        beforeAll(() => { console.log("file beforeAll 1"); return () => console.log("file beforeAll 1 teardown"); });
        beforeAll(async () => { console.log("file beforeAll 2"); await 1; return async () => { await 1; console.log("file beforeAll 2 teardown"); }; });
        afterAll(() => console.log("file afterAll"));
        beforeEach(() => { console.log("file beforeEach 1"); return () => console.log("file beforeEach 1 teardown"); });
        beforeEach(async () => { console.log("file beforeEach 2"); await 1; return function () { console.log("file beforeEach 2 teardown", arguments.length); }; });
        afterEach(() => console.log("file afterEach"));
        describe("block", () => {
          beforeAll(() => { console.log("beforeAll 1"); return () => console.log("beforeAll 1 teardown"); });
          beforeAll(() => { console.log("beforeAll 2"); return () => console.log("beforeAll 2 teardown"); });
          beforeAll(() => { console.log("beforeAll 3"); return "not a function"; });
          afterAll(() => console.log("afterAll"));
          beforeEach(() => { console.log("beforeEach 1"); return () => console.log("beforeEach 1 teardown"); });
          beforeEach(() => { console.log("beforeEach 2"); return Promise.resolve(() => console.log("beforeEach 2 teardown")); });
          afterEach(() => { console.log("afterEach"); return () => console.log("unreachable"); });
          test("a", () => { console.log("test a"); onTestFinished(() => console.log("finished")); return () => console.log("unreachable"); });
          test("b", () => { console.log("test b"); throw new Error("boom"); });
        });
      `,
    });
    const each = (name: string) => [
      "file beforeEach 1",
      "file beforeEach 2",
      "beforeEach 1",
      "beforeEach 2",
      `test ${name}`,
      "afterEach",
      "file afterEach",
      "beforeEach 2 teardown",
      "beforeEach 1 teardown",
      "file beforeEach 2 teardown 0",
      "file beforeEach 1 teardown",
    ];
    expect({ log, results, exitCode }).toEqual({
      log: [
        "file beforeAll 1",
        "file beforeAll 2",
        "beforeAll 1",
        "beforeAll 2",
        "beforeAll 3",
        ...each("a"),
        "finished",
        ...each("b"),
        "afterAll",
        "beforeAll 2 teardown",
        "beforeAll 1 teardown",
        "file afterAll",
        "file beforeAll 2 teardown",
        "file beforeAll 1 teardown",
      ],
      results: ["(pass) block > a", "(fail) block > b"],
      exitCode: 1,
    });
  });

  test("a teardown that throws fails the test, and the others still run", async () => {
    const { log, results, errors, exitCode } = await runTests({
      "a.test.js": `
        import { test, describe, beforeAll, beforeEach } from "vitest";
        describe("each", () => {
          beforeEach(() => () => console.log("teardown 1"));
          beforeEach(() => () => { throw new Error("teardown 2"); });
          beforeEach(() => async () => { await 1; throw new Error("teardown 3"); });
          test("test", () => {});
        });
        describe("all", () => {
          beforeAll(() => () => { throw new Error("teardown of beforeAll"); });
          test("test", () => {});
        });
        describe("retries", () => {
          let attempt = 0;
          beforeEach(() => () => console.log("teardown of attempt", attempt));
          test("test", { retry: 1 }, () => { if (++attempt === 1) throw new Error("again"); });
        });
      `,
    });
    expect({ log, results, errors, exitCode }).toEqual({
      log: ["teardown 1", "teardown of attempt 1", "teardown of attempt 2"],
      results: [
        "(fail) each > test",
        "(pass) all > test",
        "(fail) all > (unnamed)",
        "(pass) retries > test (attempt 2)",
      ],
      errors: ["error: teardown 3", "error: teardown 2", "error: teardown of beforeAll", "error: again"],
      exitCode: 1,
    });
  });

  // A beforeAll hook has an entry after the afterAll hooks for what it returns. It must never show up as a test.
  describe("only tests are reported, whatever beforeAll returns", () => {
    const file = `
      import { test, describe, beforeAll, afterAll } from "vitest";
      beforeAll(() => { console.log("file beforeAll"); });
      describe("nothing", () => { beforeAll(() => {}); beforeAll(async () => {}); test("test", () => {}); });
      describe("function", () => { beforeAll(() => () => console.log("teardown")); test("test", () => {}); });
      describe("throws", () => {
        beforeAll(() => () => console.log("teardown of the hook before"));
        beforeAll(() => { throw new Error("in beforeAll"); });
        beforeAll(() => () => console.log("unreachable"));
        afterAll(() => console.log("afterAll after a failed beforeAll"));
        test("test", () => console.log("unreachable"));
      });
      describe.skip("skipped", () => { beforeAll(() => () => console.log("unreachable")); test("test", () => {}); });
      describe.todo("todo", () => { beforeAll(() => () => console.log("unreachable")); test("test", () => {}); });
      describe("all skipped", () => { beforeAll(() => () => console.log("unreachable")); test.skip("test", () => {}); });
      describe("empty", () => { beforeAll(() => () => console.log("unreachable")); });
    `;
    const summary = (stderr: string) => stderr.split("\n").filter(line => /^ \d+ (pass|fail|skip|todo)$|^Ran /.test(line)).map(line => line.replace(/ \[.*/, "")); // prettier-ignore

    test("in a plain run", async () => {
      const { log, results, errors, stderr, exitCode } = await runTests({ "a.test.js": file });
      expect({ log, results, errors, summary: summary(stderr), exitCode }).toEqual({
        log: ["file beforeAll", "teardown", "afterAll after a failed beforeAll", "teardown of the hook before"],
        results: [
          "(pass) nothing > test",
          "(pass) function > test",
          "(fail) throws > (unnamed)",
          "(skip) skipped > test",
          "(todo) todo > test",
          "(skip) all skipped > test",
        ],
        errors: ["error: in beforeAll"],
        summary: [" 2 pass", " 2 skip", " 1 todo", " 1 fail", "Ran 6 tests across 1 file."],
        exitCode: 1,
      });
    });

    test("with a name filter", async () => {
      const { log, results, stderr, exitCode } = await runTests({ "a.test.js": file }, ["-t", "function"]);
      expect({ log, results, summary: summary(stderr), exitCode }).toEqual({
        log: ["file beforeAll", "teardown"],
        results: ["(pass) function > test", "(skip) skipped > test", "(todo) todo > test"],
        summary: [" 1 pass", " 1 skip", " 1 todo", " 0 fail", "Ran 3 tests across 1 file."],
        exitCode: 0,
      });
    });

    test("with .only", async () => {
      const { log, results, stderr, exitCode } = await runTests({
        "a.test.js": file.replace(`describe("function"`, `describe.only("function"`),
      });
      expect({ log, results, summary: summary(stderr), exitCode }).toEqual({
        log: ["file beforeAll", "teardown"],
        results: ["(pass) function > test"],
        summary: [" 1 pass", " 0 fail", "Ran 1 test across 1 file."],
        exitCode: 0,
      });
    });

    test("in the JUnit report", async () => {
      using dir = tempDir("vitest-flavor-junit", { "a.test.js": file });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "--reporter=junit", "--reporter-outfile=junit.xml"],
        env: { ...bunEnv, CI: "false" },
        cwd: String(dir),
        stdout: "ignore",
        stderr: "ignore",
      });
      expect(await proc.exited).toBe(1);
      const names = [
        ...(await Bun.file(`${dir}/junit.xml`).text()).matchAll(/<testcase name="([^"]*)" classname="([^"]*)"/g),
      ];
      expect(names.map(([, name, classname]) => `${classname} > ${name}`)).toEqual([
        "nothing > test",
        "function > test",
        "throws > (unnamed)",
        "skipped > test",
        "todo > test",
        "all skipped > test",
      ]);
    });
  });

  test(`what beforeEach of "bun:test" returns is ignored`, async () => {
    const { log, exitCode } = await runTests({
      "a.test.js": `
        import { test, beforeAll, beforeEach } from "bun:test";
        beforeAll(() => () => console.log("unreachable"));
        beforeEach(() => () => console.log("unreachable"));
        beforeEach(async () => () => console.log("unreachable"));
        test("test", () => console.log("test"));
      `,
    });
    expect({ log, exitCode }).toEqual({ log: ["test"], exitCode: 0 });
  });

  test("in a preload script", async () => {
    const { log, exitCode } = await runTests(
      {
        "preload.js": `
          import { beforeAll, beforeEach, afterEach, afterAll } from "vitest";
          beforeAll(function () { console.log("preload beforeAll", arguments.length, arguments[1].name); return () => console.log("preload beforeAll teardown"); });
          afterAll(() => console.log("preload afterAll 1"));
          afterAll(() => console.log("preload afterAll 2"));
          beforeEach((ctx) => { console.log("preload beforeEach", ctx.task.name); return () => console.log("preload beforeEach teardown"); });
          afterEach(({ task }) => console.log("preload afterEach 1", task.result.state, task.result.errors?.[0].message));
          afterEach(() => console.log("preload afterEach 2"));
        `,
        "a.test.js": `
          import { test } from "bun:test";
          test("a", (done) => { console.log("a", typeof done); done(); });
        `,
        "b.test.js": `
          import { test } from "vitest";
          test.fails("b", (ctx) => { console.log("b", typeof ctx.task); throw new Error("expected"); });
        `,
      },
      ["--preload", "./preload.js"],
    );
    expect({ log, exitCode }).toEqual({
      log: [
        "preload beforeAll 2 a.test.js",
        "preload beforeEach a",
        "a function",
        "preload afterEach 2",
        "preload afterEach 1 pass undefined",
        "preload beforeEach teardown",
        "preload beforeEach b",
        "b object",
        "preload afterEach 2",
        "preload afterEach 1 fail expected",
        "preload beforeEach teardown",
        "preload afterAll 2",
        "preload afterAll 1",
        "preload beforeAll teardown",
      ],
      exitCode: 0,
    });
  });
});

describe.concurrent("behaviour follows the function", () => {
  test(`no context is made for the tests of "bun:test", and no signal for a test of "vitest" that does not read it`, async () => {
    const file = (module: string) => `
      import { test, beforeEach, afterEach } from "${module}";
      import { heapStats } from "bun:jsc";
      beforeEach(() => {});
      afterEach(() => {});
      for (let i = 0; i < 10; i++) test("test " + i, () => {});
      test("count", () => {
        const { TestContext = 0, AbortSignal = 0 } = heapStats().objectTypeCounts;
        console.log("${module}", TestContext > 0, AbortSignal);
      });
    `;
    const { log, exitCode } = await runTests({ "a.test.js": file("bun:test"), "b.test.js": file("vitest") });
    expect({ log, exitCode }).toEqual({ log: ["bun:test false 0", "vitest true 0"], exitCode: 0 });
  });

  test(`"bun:test" and "@jest/globals" keep the done callback`, async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import * as bun from "bun:test";
        import * as jest from "@jest/globals";
        import * as vitest from "vitest";
        console.log(bun.test === jest.test, bun.test === vitest.test, bun.describe === vitest.describe, bun.beforeEach === vitest.beforeEach);
        console.log(bun.expect === vitest.expect, bun.vi === vitest.vi, bun.jest === vitest.jest, bun.mock === vitest.mock, bun.spyOn === vitest.spyOn, bun.expectTypeOf === vitest.expectTypeOf);
        bun.beforeEach((done) => { console.log("bun beforeEach", typeof done); done(); });
        bun.test("bun", (done) => { console.log("bun", typeof done); setTimeout(done, 1); });
        jest.test("jest", (done) => { console.log("jest", typeof done); done(); });
        vitest.test("vitest", (ctx) => { console.log("vitest", typeof ctx.task); });
        bun.test.each([[1]])("bun each %i", (a, done) => { console.log("bun each", a, typeof done); done(); });
        bun.test("never calls done", (done) => {}, 20);
      `,
    });
    expect({ log, results, exitCode }).toEqual({
      log: [
        "true false false false",
        "true true true true true true",
        "bun beforeEach function",
        "bun function",
        "bun beforeEach function",
        "jest function",
        "bun beforeEach function",
        "vitest object",
        "bun beforeEach function",
        "bun each 1 function",
        "bun beforeEach function",
      ],
      results: ["(pass) bun", "(pass) jest", "(pass) vitest", "(pass) bun each 1", "(fail) never calls done"],
      exitCode: 1,
    });
  });

  test("modifiers keep the flavour", async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test, it, describe, xtest, xit, xdescribe } from "vitest";
        const show = (ctx) => console.log(ctx.task.name, typeof ctx.task);
        test.concurrent("concurrent", show, 500);
        test.serial("serial", show, 500);
        test.if(true)("if", show, 500);
        test.skipIf(false)("skipIf", show, 500);
        test.todoIf(false)("todoIf", show, 500);
        test.failing("failing", (ctx) => { show(ctx); throw new Error("expected"); }, 500);
        it.concurrent.if(true)("chained", show, 500);
        xtest("xtest", show);
        xit("xit", show);
        xdescribe("xdescribe", () => { test("test", show); });
      `,
    });
    expect({ log: log.sort(), results, exitCode }).toEqual({
      log: [
        "chained object",
        "concurrent object",
        "failing object",
        "if object",
        "serial object",
        "skipIf object",
        "todoIf object",
      ],
      results: [
        "(pass) concurrent",
        "(pass) serial",
        "(pass) if",
        "(pass) skipIf",
        "(pass) todoIf",
        "(pass) failing",
        "(pass) chained",
        "(skip) xtest",
        "(skip) xit",
        "(skip) xdescribe > test",
      ],
      exitCode: 0,
    });
  });

  test("a helper module gives its own flavour to the file that uses it", async () => {
    const { log, results, exitCode } = await runTests({
      "helper.js": `
        import { test, afterEach } from "vitest";
        export const withContext = (name) => test(name, (ctx) => console.log(name, typeof ctx.task), 500);
        export const cleanup = (name) => afterEach(() => console.log(name));
      `,
      "a.test.js": `
        import { test, afterEach } from "bun:test";
        import { withContext, cleanup } from "./helper.js";
        afterEach(() => console.log("bun afterEach"));
        cleanup("vitest afterEach 1");
        cleanup("vitest afterEach 2");
        withContext("from the helper");
        test("own", (done) => { console.log("own", typeof done); done(); });
      `,
    });
    expect({ log, results, exitCode }).toEqual({
      log: [
        "from the helper object",
        "vitest afterEach 2",
        "vitest afterEach 1",
        "bun afterEach",
        "own function",
        "vitest afterEach 2",
        "vitest afterEach 1",
        "bun afterEach",
      ],
      results: ["(pass) from the helper", "(pass) own"],
      exitCode: 0,
    });
  });
});

describe.concurrent("exports", () => {
  test(`"vitest" exports what "bun:test" does, and more`, async () => {
    const { log, exitCode } = await runTests({
      "a.test.ts": `
        import { suite, describe, vitest, vi, onTestFailed, onTestFinished, assertType, expectTypeOf, test } from "vitest";
        import * as all from "vitest";
        import * as bun from "bun:test";
        import defaultExport from "vitest";
        console.log(suite === describe, vitest === vi, typeof onTestFailed, typeof onTestFinished, typeof expectTypeOf);
        console.log(assertType<number>(1), assertType.length);
        console.log(Object.keys(bun).filter((name) => !(name in all)));
        console.log(Object.keys(all).filter((name) => !(name in bun)).sort().join(" "));
        console.log(defaultExport.test === test, "onTestFailed" in bun, "suite" in bun);
        suite("a suite", () => { test("test", (ctx) => console.log(ctx.task.fullTestName)); });
      `,
    });
    expect({ log, exitCode }).toEqual({
      log: [
        "true true function function function",
        "undefined 1",
        "[]",
        "assertType onTestFailed suite vitest",
        "true false false",
        "a suite > test",
      ],
      exitCode: 0,
    });
  });

  const globals = {
    test: "function",
    it: "function",
    describe: "function",
    expect: "function",
    expectTypeOf: "function",
    beforeAll: "function",
    beforeEach: "function",
    afterEach: "function",
    afterAll: "function",
    jest: "object",
    vi: "object",
    xit: "function",
    xtest: "function",
    xdescribe: "function",
    onTestFinished: "function",
  };
  const vitestGlobals = { suite: "function", vitest: "object", onTestFailed: "function", assertType: "function" };
  const typeofEach = (names: object) => `({ ${Object.keys(names).map(name => `${name}: typeof ${name}`)} })`;

  for (const [name, header, args] of [
    ["a.test.js", `import "vitest";`, []],
    ["a.test.cjs", `require("vitest");`, []],
    ["a.test.js", ``, ["--globals=vitest"]],
    ["a.test.cjs", ``, ["--globals=vitest"]],
  ] as const) {
    test(`${name}: every global comes from "vitest": ${header || args}`, async () => {
      const { log, results, exitCode } = await runTests(
        {
          [name]: `
          ${header}
          console.log(JSON.stringify(${typeofEach({ ...globals, ...vitestGlobals })}));
          console.log(vitest === vi, suite === describe);
          suite("a suite", () => {
            afterEach(() => console.log("afterEach 1"));
            afterEach(() => console.log("afterEach 2"));
            test.fails("test", (ctx) => {
              onTestFailed(() => console.log("failed", ctx.task.name));
              assertType(1);
              throw new Error("expected");
            });
          });
        `,
        },
        [...args],
      );
      expect({ log, results, exitCode }).toEqual({
        log: [
          JSON.stringify({ ...globals, ...vitestGlobals }),
          "true true",
          "afterEach 2",
          "afterEach 1",
          "failed test",
        ],
        results: ["(pass) a suite > test"],
        exitCode: 0,
      });
    });
  }

  for (const name of ["a.test.js", "a.test.cjs"]) {
    test(`${name}: the names that only "vitest" exports are not globals of another file`, async () => {
      const { log, results, exitCode } = await runTests({
        [name]: `
          globalThis.suite = "mine";
          console.log(JSON.stringify(${typeofEach({ suite: 1, vitest: 1, onTestFailed: 1, assertType: 1 })}), suite);
          test("test", (done) => { console.log(typeof done); done(); });
        `,
      });
      expect({ log, results, exitCode }).toEqual({
        log: [
          `{"suite":"string","vitest":"undefined","onTestFailed":"undefined","assertType":"undefined"} mine`,
          "function",
        ],
        results: ["(pass) test"],
        exitCode: 0,
      });
    });

    test(`${name}: the global vi does not make the other globals those of "vitest"`, async () => {
      const { log, results, errors, exitCode } = await runTests({
        [name]: `
          afterEach(() => console.log("afterEach 1"));
          afterEach(() => { vi.restoreAllMocks(); console.log("afterEach 2"); });
          test("waits for done", done => { setImmediate(() => { console.log("done"); done(); }); });
          test("fails before done", done => { setImmediate(() => { expect("received").toBe("expected"); done(); }); });
        `,
      });
      expect({ log, results, errors, exitCode }).toEqual({
        log: ["done", "afterEach 1", "afterEach 2", "afterEach 1", "afterEach 2"],
        results: ["(pass) waits for done", "(fail) fails before done"],
        errors: ["error: expect(received).toBe(expected)"],
        exitCode: 1,
      });
    });
  }

  for (const [header, args] of [
    [`import { vitest } from "vitest";`, []],
    [``, ["--globals=vitest"]],
  ] as const) {
    test(`vitest.mock() and vitest.hoisted() are hoisted like vi's: ${header || "the global"}`, async () => {
      const { log, exitCode } = await runTests(
        {
          "mod.js": `globalThis.loads = (globalThis.loads ?? 0) + 1; export const value = "real";`,
          "side.js": `import { value } from "./mod.js"; export const captured = value;`,
          "a.test.js": `
          ${header}
          import { captured } from "./side.js";
          const hoisted = vitest.hoisted(() => ({ value: "mocked" }));
          vitest.mock("./mod.js", () => hoisted);
          test("test", () => console.log(globalThis.loads ?? 0, captured));
        `,
        },
        [...args],
      );
      expect({ log, exitCode }).toEqual({ log: ["0 mocked"], exitCode: 0 });
    });
  }

  test("a type imported without `type` is dropped", async () => {
    const { log, exitCode } = await runTests({
      "a.test.ts": `
        import { test, vi, Mock, MockInstance, TestContext, type Suite } from "vitest";
        import type { Task } from "vitest";
        const mock: Mock = vi.fn();
        let spy: MockInstance | undefined, suite: Suite | undefined, task: Task | undefined, ctx: TestContext | undefined;
        test("test", () => { mock(); console.log(mock.mock.calls.length, spy, suite, task, ctx); });
      `,
    });
    expect({ log, exitCode }).toEqual({ log: ["1 undefined undefined undefined undefined"], exitCode: 0 });
  });
});

describe.concurrent(`[test] globals = "vitest"`, () => {
  // Neither an import nor the global \`vi\` tells where the globals of this file are from.
  const file = `
    afterEach(() => console.log("afterEach 1"));
    afterEach(() => console.log("afterEach 2"));
    const fn = jest.fn();
    test("test", parameter => {
      fn();
      console.log("parameter:", parameter.task ? "context" : "done");
      if (!parameter.task) parameter();
    });
    test.each([[1]])("each", (value, extra) => {
      console.log("extra parameter:", typeof extra + ",", fn.mock.calls.length, "calls");
      if (typeof extra === "function") extra();
    });
  `;
  const ofBun = [
    "parameter: done",
    "afterEach 1",
    "afterEach 2",
    "extra parameter: function, 1 calls",
    "afterEach 1",
    "afterEach 2",
  ];
  const ofVitest = [
    "parameter: context",
    "afterEach 2",
    "afterEach 1",
    "extra parameter: undefined, 0 calls",
    "afterEach 2",
    "afterEach 1",
  ];
  const bunfig = (globals: string) => `[test]\nglobals = "${globals}"\n`;

  for (const name of ["a.test.js", "a.test.cjs", "a.test.ts"]) {
    test(`${name}: the globals of a file that names neither module`, async () => {
      const [byDefault, vitest] = await Promise.all([
        runTests({ [name]: file }),
        runTests({ [name]: file, "bunfig.toml": bunfig("vitest") }),
      ]);
      expect({ byDefault: byDefault.log, vitest: vitest.log }).toEqual({ byDefault: ofBun, vitest: ofVitest });
      for (const { results, exitCode } of [byDefault, vitest]) {
        expect({ results, exitCode }).toEqual({ results: ["(pass) test", "(pass) each"], exitCode: 0 });
      }
    });
  }

  test("--globals, which wins over bunfig.toml", async () => {
    const [alone, vitest, bun] = await Promise.all([
      runTests({ "a.test.js": file }, ["--globals=vitest"]),
      runTests({ "a.test.js": file, "bunfig.toml": bunfig("bun") }, ["--globals=vitest"]),
      runTests({ "a.test.js": file, "bunfig.toml": bunfig("vitest") }, ["--globals=bun"]),
    ]);
    expect({ alone: alone.log, vitest: vitest.log, bun: bun.log }).toEqual({
      alone: ofVitest,
      vitest: ofVitest,
      bun: ofBun,
    });
  });

  test("--isolate", async () => {
    const { log, exitCode } = await runTests({ "a.test.js": file, "bunfig.toml": bunfig("vitest") }, ["--isolate"]);
    expect({ log, exitCode }).toEqual({ log: ofVitest, exitCode: 0 });
  });

  test.each([
    ["--globals=vitest", undefined, ["--globals=vitest"]],
    [`globals = "vitest"`, "vitest", []],
  ] as const)("in the workers of --parallel: %s", async (_, config, args) => {
    const { stdout, stderr, exitCode } = await runTests(
      {
        "a.test.js": file,
        "b.test.js": `test("another file", () => {});`,
        "bunfig.toml": config ? bunfig(config) : "",
      },
      ["--parallel=2", ...args],
    );
    expect((stdout + stderr).split("\n").filter(line => ofVitest.includes(line) || ofBun.includes(line))).toEqual(
      ofVitest,
    );
    expect(exitCode).toBe(0);
  });

  test("what a file imports keeps the semantics of its module, and preload scripts and helpers follow the key", async () => {
    const { log, results, exitCode } = await runTests(
      {
        "bunfig.toml": bunfig("vitest"),
        "preload.js": `beforeEach(parameter => { console.log("preload:", typeof parameter.task); if (!parameter.task) parameter(); });`,
        "helper.js": `export const define = name => test(name, parameter => console.log("helper:", typeof parameter.task));`,
        "a.test.js": `
          import { test as bunTest } from "bun:test";
          import { it as jestIt } from "@jest/globals";
          import { define } from "./helper.js";
          bunTest("bun:test", done => { console.log("bun:test:", typeof done.task); done(); });
          jestIt("@jest/globals", done => { console.log("@jest/globals:", typeof done.task); done(); });
          test("global", parameter => console.log("global:", typeof parameter.task, typeof suite, typeof onTestFailed));
          define("helper");
        `,
      },
      ["--preload=./preload.js"],
    );
    expect({ log, results, exitCode }).toEqual({
      log: [
        "preload: object",
        "bun:test: undefined",
        "preload: object",
        "@jest/globals: undefined",
        "preload: object",
        "global: object function function",
        "preload: object",
        "helper: object",
      ],
      results: ["(pass) bun:test", "(pass) @jest/globals", "(pass) global", "(pass) helper"],
      exitCode: 0,
    });
  });

  test("is part of the key of the transpiler cache", async () => {
    using cache = tempDir("vitest-flavor-cache", {});
    const env = { BUN_RUNTIME_TRANSPILER_CACHE_PATH: String(cache) };
    // Small files are not cached.
    const files = { "a.test.js": file + "// " + Buffer.alloc(8192, "-").toString() };
    const logs: string[][] = [];
    for (const args of [[], ["--globals=vitest"], [], ["--globals=vitest"]]) {
      logs.push((await runTests(files, args, env)).log);
      expect(readdirSync(String(cache))).not.toBeEmpty();
    }
    expect(logs).toEqual([ofBun, ofVitest, ofBun, ofVitest]);
  });

  test("is one of two names", async () => {
    const [config, flag, bun] = await Promise.all([
      runTests({ "a.test.js": file, "bunfig.toml": bunfig("jest") }),
      runTests({ "a.test.js": file }, ["--globals=jest"]),
      runTests({ "a.test.js": file, "bunfig.toml": bunfig("bun") }),
    ]);
    expect({
      config: config.errors,
      flag: flag.errors,
      bun: bun.log,
      exitCodes: [config.exitCode, flag.exitCode, bun.exitCode],
    }).toEqual({
      config: [`error: expected "globals" to be "bun" or "vitest" but received "jest"`],
      flag: [`error: --globals expects 'bun' or 'vitest', received "jest"`],
      bun: ofBun,
      exitCodes: [1, 1, 0],
    });
  });
});

describe.concurrent("options", () => {
  test("test(name, options, fn)", async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test, expect } from "vitest";
        const show = ({ task }) => console.log(task.name + ":", task.timeout, task.retry, task.repeats, task.mode, task.concurrent, task.fails);
        test("timeout", { timeout: 1234 }, show);
        test("number", show, 2345);
        test("retry", { retry: 2 }, show);
        test("retry object", { retry: { count: 2, delay: 1 } }, show);
        test("repeats", { repeats: 1 }, show);
        test("retry and repeats", { retry: 1, repeats: 1 }, show);
        test("skip", { skip: true }, () => console.log("unreachable"));
        test("skip: false", { skip: false }, show);
        test("todo", { todo: true }, () => console.log("unreachable"));
        test("fails", { fails: true }, (ctx) => { show(ctx); throw new Error("expected"); });
        test("concurrent", { concurrent: true }, show);
        test.skip("skip: false undoes test.skip", { skip: false }, show);
        test.concurrent("concurrent: false undoes test.concurrent", { concurrent: false }, show);
        test("sequential", { sequential: true }, show);
        test("without a callback");
        test("options without a callback", { timeout: 5 });
        test.fails("test.fails without a callback");
      `,
    });
    expect({ log, results, exitCode }).toEqual({
      log: [
        "timeout: 1234 0 0 run undefined undefined",
        "number: 2345 0 0 run undefined undefined",
        "retry: 5000 2 0 run undefined undefined",
        "retry object: 5000 2 0 run undefined undefined",
        "repeats: 5000 0 1 run undefined undefined",
        "repeats: 5000 0 1 run undefined undefined",
        "retry and repeats: 5000 1 1 run undefined undefined",
        "retry and repeats: 5000 1 1 run undefined undefined",
        "skip: false: 5000 0 0 run undefined undefined",
        "fails: 5000 0 0 run undefined true",
        "concurrent: 5000 0 0 run true undefined",
        "skip: false undoes test.skip: 5000 0 0 run undefined undefined",
        "concurrent: false undoes test.concurrent: 5000 0 0 run undefined undefined",
        "sequential: 5000 0 0 run undefined undefined",
      ],
      results: [
        "(pass) timeout",
        "(pass) number",
        "(pass) retry",
        "(pass) retry object",
        "(pass) repeats (run 2)",
        "(pass) retry and repeats (run 2)",
        "(skip) skip",
        "(pass) skip: false",
        "(todo) todo",
        "(pass) fails",
        "(pass) concurrent",
        "(pass) skip: false undoes test.skip",
        "(pass) concurrent: false undoes test.concurrent",
        "(pass) sequential",
        "(todo) without a callback",
        "(todo) options without a callback",
        "(todo) test.fails without a callback",
      ],
      exitCode: 0,
    });
  });

  test("{ only: true }", async () => {
    const files = {
      "a.test.js": `
        import { test, describe } from "vitest";
        test("not this one", () => console.log("unreachable"));
        test("only", { only: true }, () => console.log("only"));
        test("only wins over skip", { only: true, skip: true }, () => console.log("only wins over skip"));
        describe("block", { only: true }, () => { test("in an only block", () => console.log("in an only block")); });
      `,
    };
    const [local, ci] = await Promise.all([runTests(files), runTests(files, [], { CI: "true" })]);
    expect({ log: local.log, exitCode: local.exitCode }).toEqual({
      log: ["only", "only wins over skip", "in an only block"],
      exitCode: 0,
    });
    expect(ci.stderr).toContain(".only is disabled in CI environments");
    expect(ci.exitCode).toBe(1);
  });

  test("the options of describe() are the defaults of what is inside it", async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test, describe } from "vitest";
        import { test as bunTest, describe as bunDescribe } from "bun:test";
        const show = ({ task }) => console.log(task.fullTestName + ":", task.timeout, task.retry, task.repeats, task.concurrent);
        describe("options", { timeout: 777, retry: 1 }, () => {
          test("inherits", show);
          test("overrides", { timeout: 888, retry: 0 }, show);
          describe("nested", () => { test("inherits", show); });
          describe("nested options", { timeout: 999 }, () => { test("inherits", show); });
          bunDescribe("of bun:test", () => { test("inherits", show); });
        });
        describe("number", () => { test("inherits", show); }, 555);
        describe("skip", { skip: true }, () => { test("test", () => console.log("unreachable")); });
        describe("todo", { todo: true }, () => { test("test", () => console.log("unreachable")); });
        describe("concurrent", { concurrent: true }, () => { test("inherits", show); test("overrides", { concurrent: false }, show); });
        describe("without a callback");
        bunDescribe("options of bun:test", () => { test("does not inherit", show); }, { timeout: 777 });
        test("outside", show);
      `,
    });
    expect({ log, results, exitCode }).toEqual({
      log: [
        "options > inherits: 777 1 0 undefined",
        "options > overrides: 888 0 0 undefined",
        "options > nested > inherits: 777 1 0 undefined",
        "options > nested options > inherits: 999 1 0 undefined",
        "options > of bun:test > inherits: 777 1 0 undefined",
        "number > inherits: 555 0 0 undefined",
        "concurrent > inherits: 5000 0 0 true",
        "concurrent > overrides: 5000 0 0 undefined",
        "options of bun:test > does not inherit: 5000 0 0 undefined",
        "outside: 5000 0 0 undefined",
      ],
      results: [
        "(pass) options > inherits",
        "(pass) options > overrides",
        "(pass) options > nested > inherits",
        "(pass) options > nested options > inherits",
        "(pass) options > of bun:test > inherits",
        "(pass) number > inherits",
        "(skip) skip > test",
        "(todo) todo > test",
        "(pass) concurrent > inherits",
        "(pass) concurrent > overrides",
        "(pass) options of bun:test > does not inherit",
        "(pass) outside",
      ],
      exitCode: 0,
    });
  });

  test(`"bun:test" does not read them`, async () => {
    const { log, results, errors, exitCode } = await runTests({
      "a.test.js": `
        import { test } from "bun:test";
        test("skip", { skip: true }, () => console.log("skip ran"));
        test("todo", { todo: true }, () => console.log("todo ran"));
        test("fails", { fails: true }, () => console.log("fails ran"));
        for (const args of [["without a callback"], ["options only", { timeout: 5 }], ["both", { retry: 1, repeats: 1 }, () => {}]]) {
          try { test(...args); } catch (error) { console.log(error.message); }
        }
      `,
    });
    expect({ log, results, errors, exitCode }).toEqual({
      log: [
        "test expects a function as the second argument",
        "test expects a function as the second argument",
        "test(): Cannot set both retry and repeats",
        "skip ran",
        "todo ran",
        "fails ran",
      ],
      results: ["(pass) skip", "(pass) todo", "(pass) fails"],
      errors: [],
      exitCode: 0,
    });
  });

  test("a wrong number of assertions and a timeout are failures like any other", async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test, expect, afterEach, onTestFailed } from "vitest";
        let attempt = 0;
        test("is retried", { retry: 2 }, () => {
          console.log("attempt", ++attempt);
          expect.assertions(attempt < 3 ? 5 : 1);
          expect(1).toBe(1);
        });
        test.fails("test.fails: wrong number of assertions", () => { onTestFailed(() => console.log("failed")); expect.assertions(2); expect(1).toBe(1); });
        test.fails("test.fails: no assertion", () => { expect.hasAssertions(); });
        test.fails("test.fails: timeout", { timeout: 20 }, async () => { await new Promise(() => {}); });
        test("expect() in afterEach is not counted", () => { expect.assertions(1); expect(1).toBe(1); });
        afterEach(() => { expect(1).toBe(1); });
      `,
    });
    expect({ log, results, exitCode }).toEqual({
      log: ["attempt 1", "attempt 2", "attempt 3", "failed"],
      results: [
        "(pass) is retried (attempt 3)",
        "(pass) test.fails: wrong number of assertions",
        "(pass) test.fails: no assertion",
        "(pass) test.fails: timeout",
        "(pass) expect() in afterEach is not counted",
      ],
      exitCode: 0,
    });
  });
});

test.concurrent("test.fails passes whatever it is that fails", async () => {
  const file = (module: string, modifier: string) => `
    import { test as base, describe, beforeEach, afterEach } from "${module}";
    import { onTestFinished } from "vitest";
    describe("beforeEach", () => { beforeEach(() => { throw new Error("beforeEach"); }); base.${modifier}("test", () => {}); });
    describe("afterEach", () => { afterEach(() => { throw new Error("afterEach"); }); base.${modifier}("test", () => {}); });
    describe("hook timeout", () => { beforeEach(async () => { await new Promise(() => {}); }, 20); base.${modifier}("test", () => {}); });
  `;
  const [vitest, bun, vitestFailing, bunFailing] = await Promise.all([
    runTests({
      "a.test.js": `
        ${file("vitest", "fails")}
        const test = base.extend({
          setup: async ({}, use) => { throw new Error("fixture"); },
          teardown: async ({}, use) => { await use(1); throw new Error("fixture teardown"); },
        });
        test.fails("fixture setup", ({ setup }) => {});
        test.fails("fixture teardown", ({ teardown }) => {});
        base.fails("onTestFinished", () => { onTestFinished(() => { throw new Error("onTestFinished"); }); });
        describe("teardown", () => { beforeEach(() => () => { throw new Error("teardown"); }); base.fails("test", () => {}); });
        base.fails("nothing", () => {});
      `,
    }),
    runTests({ "a.test.js": file("bun:test", "fails") }),
    runTests({ "a.test.js": file("vitest", "failing") }),
    runTests({ "a.test.js": file("bun:test", "failing") }),
  ]);
  expect({ results: vitest.results, errors: vitest.errors, exitCode: vitest.exitCode }).toEqual({
    results: [
      "(pass) beforeEach > test",
      "(pass) afterEach > test",
      "(pass) hook timeout > test",
      "(pass) fixture setup",
      "(pass) fixture teardown",
      "(pass) onTestFinished",
      "(pass) teardown > test",
      "(fail) nothing",
    ],
    errors: [],
    exitCode: 1,
  });
  expect({ results: bun.results, errors: bun.errors, exitCode: bun.exitCode }).toEqual({
    results: ["(pass) beforeEach > test", "(pass) afterEach > test", "(pass) hook timeout > test"],
    errors: [],
    exitCode: 0,
  });
  // Jest's modifier keeps Jest's rule, whichever module `test` is from.
  for (const failing of [vitestFailing, bunFailing]) {
    expect({ results: failing.results, errors: failing.errors, exitCode: failing.exitCode }).toEqual({
      results: ["(fail) beforeEach > test", "(fail) afterEach > test", "(fail) hook timeout > test"],
      errors: ["error: beforeEach", "error: afterEach"],
      exitCode: 1,
    });
  }
});

test.concurrent.each([
  ["vitest", "fails"],
  ["bun:test", "fails"],
  ["bun:test", "failing"],
])("%s: an error that nothing caught is not the failure that test.%s expects", async (module, modifier) => {
  const { results, errors, stderr, exitCode } = await runTests({
    "a.test.js": `
      import { test } from "${module}";
      const thrown = Promise.withResolvers();
      test("leaves a timer behind", () => {
        setTimeout(() => {
          thrown.resolve();
          throw new Error("of an earlier test");
        }, 0);
      });
      test.${modifier}("runs when the timer fires", () => thrown.promise);
      test.${modifier}("rejects a promise that nothing waits for", async () => {
        Promise.reject(new Error("rejected"));
        await new Promise(resolve => setImmediate(resolve));
      });
      test.${modifier}("throws", () => {
        throw new Error("expected");
      });
      test.${modifier}("returns a promise that is rejected", () => Promise.reject(new Error("expected")));
      test.${modifier}("returns a promise that is rejected later", async () => {
        await new Promise(resolve => setImmediate(resolve));
        throw new Error("expected");
      });
      if ("${module}" === "bun:test") {
        test.${modifier}("done(error)", done => done(new Error("expected")));
        test.${modifier}("done(error) later", done => void setImmediate(() => done(new Error("expected"))));
      }
    `,
  });
  expect({
    results,
    errors,
    betweenTests: stderr.split("# Unhandled error between tests").length - 1,
    exitCode,
  }).toEqual({
    results: [
      "(pass) leaves a timer behind",
      "(fail) runs when the timer fires",
      "(fail) rejects a promise that nothing waits for",
      "(pass) throws",
      "(pass) returns a promise that is rejected",
      "(pass) returns a promise that is rejected later",
      ...(module === "bun:test" ? ["(pass) done(error)", "(pass) done(error) later"] : []),
    ],
    errors: ["error: of an earlier test", "error: rejected"],
    betweenTests: 2,
    exitCode: 1,
  });
});

test.concurrent("test.fails: what the hooks see, retries, repeats and inheritance", async () => {
  const { log, results, exitCode } = await runTests({
    "a.test.js": `
      import { test, describe, expect, afterEach, onTestFinished, onTestFailed } from "vitest";
      const runs = {};
      const failsOn = (name, ...attempts) => () => {
        runs[name] = (runs[name] ?? 0) + 1;
        if (attempts.includes(runs[name])) throw new Error("expected");
      };
      describe("state", () => {
        afterEach(({ task }) => console.log(task.name + ":", task.fails, task.result.state));
        test.fails("throws", () => { onTestFailed(({ task }) => console.log("onTestFailed", task.result.errors.length)); throw new Error("expected"); });
        test.fails("does not throw", () => { onTestFailed(() => console.log("unreachable")); });
        test.fails("time limit", { timeout: 1 }, ({ signal }) => new Promise(resolve => signal.addEventListener("abort", resolve)));
        test.fails("skips itself", ({ skip }) => { expect.assertions(1); skip(); });
        test("skips itself, without the modifier", ({ skip }) => { expect.assertions(1); skip(); });
      });
      test.fails("retry: fails the second time", { retry: 1 }, () => {
        onTestFinished(() => console.log("finished"));
        onTestFailed(() => console.log("failed"));
        failsOn("retry", 2)();
      });
      test.fails("each repeat has all the retries", { retry: 1, repeats: 1 }, failsOn("both", 2, 4));
      test("each repeat has all the retries, without the modifier", { retry: 1, repeats: 1 }, failsOn("plain", 1, 3));
      describe("inherited", { fails: true }, () => {
        test("throws", () => { throw new Error("expected"); });
        test("does not throw", () => {});
        test("fails: false", { fails: false }, () => {});
        describe("nested", () => { test("time limit", { timeout: 1 }, () => new Promise(() => {})); });
      });
      describe("fails: false", { fails: false }, () => { test.fails("test.fails wins", () => { throw new Error("expected"); }); });
      test.fails("fails: false wins", { fails: false }, () => {});
      describe.concurrent("concurrent", () => {
        test.fails("throws", async () => { await 1; throw new Error("expected"); });
        test.fails("assertions", async ({ expect }) => { await 1; expect.assertions(1); });
        test.fails("does not throw", async () => { await 1; });
      });
      test("runs", () => console.log(JSON.stringify(runs)));
    `,
  });
  expect({ log, results, exitCode }).toEqual({
    log: [
      "throws: true fail",
      "onTestFailed 1",
      "does not throw: true pass",
      "time limit: true fail",
      "skips itself: true skip",
      "skips itself, without the modifier: undefined skip",
      "finished",
      "finished",
      "failed",
      `{"retry":2,"both":4,"plain":4}`,
    ],
    results: [
      "(pass) state > throws",
      "(fail) state > does not throw",
      "(pass) state > time limit",
      "(skip) state > skips itself",
      "(skip) state > skips itself, without the modifier",
      "(pass) retry: fails the second time (attempt 2)",
      "(pass) each repeat has all the retries (attempt 2) (run 2)",
      "(pass) each repeat has all the retries, without the modifier (attempt 2) (run 2)",
      "(pass) inherited > throws",
      "(fail) inherited > does not throw",
      "(pass) inherited > fails: false",
      "(pass) inherited > nested > time limit",
      "(pass) fails: false > test.fails wins",
      "(pass) fails: false wins",
      "(pass) concurrent > throws",
      "(pass) concurrent > assertions",
      "(fail) concurrent > does not throw",
      "(pass) runs",
    ],
    exitCode: 1,
  });
});

describe.concurrent("test.extend()", () => {
  for (const module of ["vitest", "bun:test"]) {
    test(`from "${module}": a fixture is set up for the callbacks that destructure it, and torn down after the hooks`, async () => {
      const { log, results, exitCode } = await runTests({
        "a.test.js": `
          import { test as base, describe } from "${module}";
          import { beforeEach, afterEach, onTestFinished } from "vitest";
          const test = base.extend({
            a: async ({}, use) => { console.log("a setup"); await use("A"); console.log("a teardown"); },
            b: async ({ a }, use) => { console.log("b setup", a); await use(a + "B"); console.log("b teardown"); },
            c: async ({ b, a }, use) => { console.log("c setup", a, b); await use(b + "C"); console.log("c teardown"); },
            plain: 42,
            object: { x: 1 },
            array: [1, 2],
            auto: [async ({}, use) => { console.log("auto setup"); await use("AUTO"); console.log("auto teardown"); }, { auto: true }],
            unused: async ({}, use) => { console.log("unreachable"); await use(1); },
            usesTask: async ({ task }, use) => { console.log("usesTask setup", task.name); await use(task.name); },
          });
          describe("tests", () => {
            beforeEach(() => { console.log("beforeEach"); return () => console.log("beforeEach teardown"); });
            afterEach(() => console.log("afterEach"));
            test("none", () => { console.log("test none"); });
            test("a", ({ a }) => { console.log("test a", a); onTestFinished(() => console.log("finished")); });
            test("c", ({ c }) => { console.log("test c", c); });
            test("values", ({ plain, object, array }) => { console.log("test values", plain, JSON.stringify(object), JSON.stringify(array)); });
            test("the context", ({ a, task, expect, skip }) => { console.log("test the context", a, task.name, typeof expect, typeof skip); });
            test("usesTask", ({ usesTask }) => { console.log("test usesTask", usesTask); });
            test("renamed", async ({ a: renamed, "plain": quoted = 7, unknown }) => { await 1; console.log("test renamed", renamed, quoted, unknown); });
          });
        `,
      });
      const around = (name: string, setup: string[], body: string, teardown: string[], after: string[] = []) => [
        "auto setup",
        "beforeEach",
        ...setup,
        body,
        "afterEach",
        "beforeEach teardown",
        ...teardown,
        "auto teardown",
        ...after,
      ];
      expect({ log, results, exitCode }).toEqual({
        log: [
          ...around("none", [], "test none", []),
          ...around("a", ["a setup"], "test a A", ["a teardown"], ["finished"]),
          ...around("c", ["a setup", "b setup A", "c setup A AB"], "test c ABC", [
            "c teardown",
            "b teardown",
            "a teardown",
          ]),
          ...around("values", [], `test values 42 {"x":1} [1,2]`, []),
          ...around("the context", ["a setup"], "test the context A the context function function", ["a teardown"]),
          ...around("usesTask", ["usesTask setup usesTask"], "test usesTask usesTask", []),
          ...around("renamed", ["a setup"], "test renamed A 42 undefined", ["a teardown"]),
        ],
        results: [
          "(pass) tests > none",
          "(pass) tests > a",
          "(pass) tests > c",
          "(pass) tests > values",
          "(pass) tests > the context",
          "(pass) tests > usesTask",
          "(pass) tests > renamed",
        ],
        exitCode: 0,
      });
    });
  }

  test("hooks get the fixtures of the test they run for", async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test as base, beforeEach, afterEach } from "vitest";
        const test = base.extend({
          a: async ({}, use) => { console.log("a setup"); await use("A"); console.log("a teardown"); },
          b: async ({ a }, use) => { console.log("b setup", a); await use(a + "B"); console.log("b teardown"); },
          auto: [async ({}, use) => { console.log("auto setup"); await use("AUTO"); console.log("auto teardown"); }, { auto: true }],
        });
        beforeEach(({ a }) => console.log("beforeEach", a));
        afterEach(({ b }) => console.log("afterEach", b));
        test("extended", ({ a }) => { console.log("test", a); });
        base("not extended", () => { console.log("test"); });
      `,
    });
    expect({ log, results, exitCode }).toEqual({
      log: [
        "a setup",
        "auto setup",
        "beforeEach A",
        "test A",
        "b setup A",
        "afterEach AB",
        "b teardown",
        "auto teardown",
        "a teardown",
        "beforeEach undefined",
        "test",
        "afterEach undefined",
      ],
      results: ["(pass) extended", "(pass) not extended"],
      exitCode: 0,
    });
  });

  test("extend() of an extended test adds to its fixtures, and can build on the one it replaces", async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test as base } from "vitest";
        const one = base.extend({ a: async ({}, use) => { console.log("a1 setup"); await use("a1"); console.log("a1 teardown"); }, kept: "kept" });
        const two = one.extend({
          a: async ({ a }, use) => { console.log("a2 setup on", a); await use(a + "+a2"); console.log("a2 teardown"); },
          b: async ({ a }, use) => { await use("b(" + a + ")"); },
        });
        const three = two.extend({ a: "a value" });
        one("one", ({ a, kept, b }) => console.log("one", a, kept, b));
        two("two", ({ a, b, kept }) => console.log("two", a, b, kept));
        three("three", ({ a, b }) => console.log("three", a, b));
      `,
    });
    expect({ log, results, exitCode }).toEqual({
      log: [
        "a1 setup",
        "one a1 kept undefined",
        "a1 teardown",
        "a1 setup",
        "a2 setup on a1",
        "two a1+a2 b(a1+a2) kept",
        "a2 teardown",
        "a1 teardown",
        "three a value b(a value)",
      ],
      results: ["(pass) one", "(pass) two", "(pass) three"],
      exitCode: 0,
    });
  });

  test("what extend() refuses", async () => {
    const { log, exitCode } = await runTests({
      "a.test.js": `
        import { test, describe } from "vitest";
        const attempt = (fn) => { try { fn(); console.log("accepted"); } catch (error) { console.log(error.name + ":", error.message, ...(error.errors ?? []).map((error) => "| " + error.message)); } };
        const use1 = async ({}, use) => use(1);
        attempt(() => test.extend({ x: async ({ nope }, use) => use(1) }));
        attempt(() => test.extend({ x: async ({ x }, use) => use(1) }));
        attempt(() => test.extend({ x: async (context, use) => use(1) }));
        attempt(() => test.extend({ x: async ([a], use) => use(1) }));
        attempt(() => test.extend({ x: async ({ ...rest }, use) => use(1) }));
        attempt(() => test.extend({ x: async ({ n1 }, use) => use(1), y: async ({ n2 }, use) => use(1) }));
        attempt(() => test.extend({ x: [1, { scope: "nope" }] }));
        attempt(() => test.extend({ x: use1, f: [async ({ x }, use) => use(1), { scope: "file" }] }));
        attempt(() => test.extend({ f: [use1, { scope: "file" }], w: [async ({ f }, use) => use(1), { scope: "worker" }] }));
        attempt(() => test.extend({ x: use1 }).extend({ x: [use1, { scope: "file" }] }));
        attempt(() => test.extend({ x: use1 }).extend({ x: [use1, { auto: true }] }));
        attempt(() => test.extend());
        attempt(() => test.extend(null));
        attempt(() => test.extend(() => {}));
        attempt(() => describe.extend({}));
        attempt(() => test.override({ x: 1 }));
        describe("block", () => { attempt(() => test.extend({ f: [use1, { scope: "file" }] })); test("test", () => {}); });
        console.log("---");
        attempt(() => test.extend({}));
        attempt(() => test.extend({ f: [use1, { scope: "file" }], x: async ({ f }, use) => use(f) }));
        attempt(() => test.extend({ x: async ({ y }, use) => use(1), y: async ({ x }, use) => use(1) }));
        attempt(() => test.extend({ x: [1, 2], y: [1, {}], z: [5, { auto: true }], i: [6, { injected: true }] }));
        attempt(() => test.extend({ x: async ({ task, expect, signal, skip, annotate, onTestFinished, onTestFailed }, use) => use(1) }));
        attempt(() => test.extend({ x: function ({}, use) { return use(1); }, async y({ x }, use) { await use(1); }, z: () => {} }));
      `,
    });
    expect({ log, exitCode }).toEqual({
      log: [
        `Error: test.extend(): fixture "x" depends on "nope", which is not a fixture`,
        `Error: test.extend(): fixture "x" depends on itself, and there is no earlier "x" for it to extend`,
        `Error: test.extend(): the first parameter of fixture "x" must be an object destructuring pattern, received "context"`,
        `Error: test.extend(): the first parameter of fixture "x" must be an object destructuring pattern`,
        `Error: test.extend(): the first parameter of fixture "x" cannot have a rest property`,
        `AggregateError: test.extend(): 2 of the fixtures cannot be used | test.extend(): fixture "x" depends on "n1", which is not a fixture | test.extend(): fixture "y" depends on "n2", which is not a fixture`,
        `Error: test.extend(): fixture "x" has the unknown scope "nope". Expected "test", "file" or "worker"`,
        `Error: test.extend(): the file-scoped fixture "f" cannot depend on the test-scoped fixture "x"`,
        `Error: test.extend(): the worker-scoped fixture "w" cannot depend on the file-scoped fixture "f"`,
        `Error: test.extend(): fixture "x" is already defined with the scope "test"`,
        `Error: test.extend(): fixture "x" is already defined with { auto: false }`,
        `TypeError: The "fixtures" argument must be one of type object or string. Received undefined`,
        `TypeError: The "fixtures" argument must be one of type object or string. Received null`,
        `TypeError: The "fixtures" argument must be one of type object or string. Received function `,
        `Error: test.extend() cannot be called on describe`,
        `Error: test.override() can only be called on a function that test.extend() returned`,
        "---",
        "accepted",
        "accepted",
        "accepted",
        "accepted",
        "accepted",
        "accepted",
        `Error: test.extend(): the file-scoped fixture "f" cannot be defined inside describe(). Define it at the top level of the file`,
      ],
      exitCode: 0,
    });
  });

  test("a fixture that fails", async () => {
    const { log, results, errors, stderr, exitCode } = await runTests({
      "a.test.js": `
        import { test as base, afterEach, beforeEach, describe } from "vitest";
        const test = base.extend({
          x: async ({ y }, use) => use(1),
          y: async ({ x }, use) => use(1),
          setupThrows: async ({}, use) => { throw new Error("setup failed"); },
          setupThrowsNow: ({}, use) => { throw new Error("setup failed at once"); },
          teardownThrows: async ({}, use) => { await use(1); throw new Error("teardown failed"); },
          noUse: async ({}, use) => { console.log("noUse ran"); },
          noUseNoPromise: ({}, use) => 5,
          twice: async ({}, use) => { await use(1); console.log("after the first use()"); await use(2); console.log("unreachable"); },
          notAsync: ({}, use) => { use(7); },
          notAwaited: async ({}, use) => { use(9); console.log("notAwaited goes on"); },
          ok: async ({}, use) => { console.log("ok setup"); await use("ok"); console.log("ok teardown"); },
        });
        afterEach(({ task }) => console.log("afterEach", task.name + ":", task.result.state, task.result.errors?.map((error) => error.message).join(" | ")));
        test("cycle", ({ x }) => console.log("unreachable"));
        test("setupThrows", ({ ok, setupThrows }) => console.log("unreachable"));
        test("setupThrowsNow", ({ setupThrowsNow }) => console.log("unreachable"));
        test("after another", ({ setupThrows: last, ok }) => console.log("unreachable"));
        test("teardownThrows", ({ ok, teardownThrows }) => console.log("teardownThrows: the test ran"));
        test("noUse", ({ noUse }) => console.log("unreachable"));
        test("noUseNoPromise", ({ noUseNoPromise }) => console.log("unreachable"));
        test("twice", ({ twice }) => console.log("twice: the test ran", twice));
        test("notAsync", ({ notAsync }) => console.log("notAsync: the test ran", notAsync));
        test("notAwaited", ({ notAwaited }) => console.log("notAwaited: the test ran", notAwaited));
        test("the test throws", ({ ok }) => { Bun.gc(true); throw new Error("in the test"); });
        test("parameter", (context) => console.log("unreachable"));
        test("rest", ({ ...rest }) => console.log("unreachable"));
        test.for([1])("for parameter", (row, context) => console.log("unreachable"));
        describe("in a hook", () => {
          beforeEach(({ setupThrows }) => console.log("unreachable"));
          test("test", () => console.log("unreachable"));
        });
        describe("parameter of a hook", () => {
          beforeEach((context) => console.log("beforeEach of", context.task.name));
          test("test", () => console.log("unreachable"));
          base("not extended", () => console.log("not extended: the test ran"));
        });
      `,
    });
    const why = "fixtures are set up for the properties it names";
    expect({ log, results, errors, exitCode }).toEqual({
      log: [
        "afterEach cycle: fail Fixtures depend on each other: x <- y <- x",
        "afterEach setupThrows: fail setup failed",
        "afterEach setupThrowsNow: fail setup failed at once",
        "afterEach after another: fail setup failed",
        "ok setup",
        "teardownThrows: the test ran",
        "afterEach teardownThrows: pass undefined",
        "ok teardown",
        "noUse ran",
        `afterEach noUse: fail Fixture "noUse" returned without calling use()`,
        `afterEach noUseNoPromise: fail Fixture "noUseNoPromise" returned without calling use()`,
        "twice: the test ran 1",
        "afterEach twice: pass undefined",
        "after the first use()",
        "notAsync: the test ran 7",
        "afterEach notAsync: pass undefined",
        "notAwaited goes on",
        "notAwaited: the test ran 9",
        "afterEach notAwaited: pass undefined",
        "ok setup",
        "afterEach the test throws: fail in the test",
        "ok teardown",
        `afterEach parameter: fail test() expects the first parameter of its callback to be an object destructuring pattern, received "context": ${why}`,
        `afterEach rest: fail test() expects the first parameter of its callback not to have a rest property: ${why}`,
        `afterEach for parameter: fail test.for() expects the second parameter of its callback to be an object destructuring pattern, received "context": ${why}`,
        "afterEach test: fail setup failed",
        `afterEach test: fail The parameter that fixtures are destructured from must be an object destructuring pattern, received "context"`,
        "beforeEach of not extended",
        "not extended: the test ran",
        "afterEach not extended: pass undefined",
      ],
      results: [
        "(fail) cycle",
        "(fail) setupThrows",
        "(fail) setupThrowsNow",
        "(fail) after another",
        "(fail) teardownThrows",
        "(fail) noUse",
        "(fail) noUseNoPromise",
        "(fail) twice",
        "(pass) notAsync",
        "(pass) notAwaited",
        "(fail) the test throws",
        "(fail) parameter",
        "(fail) rest",
        "(fail) for parameter",
        "(fail) in a hook > test",
        "(fail) parameter of a hook > test",
        "(pass) parameter of a hook > not extended",
      ],
      errors: [
        "error: Fixtures depend on each other: x <- y <- x",
        "error: setup failed",
        "error: setup failed at once",
        "error: setup failed",
        "error: teardown failed",
        `error: Fixture "noUse" returned without calling use()`,
        `error: Fixture "noUseNoPromise" returned without calling use()`,
        `error: use() of fixture "twice" was called more than once`,
        "error: in the test",
        `error: test() expects the first parameter of its callback to be an object destructuring pattern, received "context": ${why}`,
        `error: test() expects the first parameter of its callback not to have a rest property: ${why}`,
        `error: test.for() expects the second parameter of its callback to be an object destructuring pattern, received "context": ${why}`,
        "error: setup failed",
        `error: The parameter that fixtures are destructured from must be an object destructuring pattern, received "context"`,
      ],
      exitCode: 1,
    });
    // Reported where the test was registered, also when the code there has been collected since.
    expect(stderr).toContain("a.test.js:28:9");
  });

  test("a fixture that never finishes fails its test when the time is up, and the run goes on", async () => {
    const { results, exitCode } = await runTests({
      "a.test.js": `
        import { test as base } from "vitest";
        const test = base.extend({
          setup: async ({}, use) => { await new Promise(() => {}); },
          teardown: async ({}, use) => { await use(1); await new Promise(() => {}); },
          perFile: [async ({}, use) => { await use(1); await new Promise(() => {}); }, { scope: "file" }],
        });
        test("setup", { timeout: 1 }, ({ setup }) => {});
        test("teardown", { timeout: 1 }, ({ teardown }) => {});
        test("after", () => {});
        test("file", { timeout: 1 }, ({ perFile }) => {});
      `,
    });
    expect({ results: results.slice(0, 3), exitCode }).toEqual({
      results: ["(fail) setup", "(fail) teardown", "(pass) after"],
      exitCode: 1,
    });
  });

  test("file and worker scope: set up once, torn down after the afterAll hooks of the file", async () => {
    const { log, results, errors, exitCode } = await runTests({
      "a.test.js": `
        import { test as base, describe, afterAll, beforeAll } from "vitest";
        beforeAll(() => () => console.log("file beforeAll teardown"));
        afterAll(() => console.log("file afterAll"));
        const test = base.extend({
          perFile: [async ({}, use) => { console.log("perFile setup"); await use({ n: 0 }); console.log("perFile teardown"); }, { scope: "file" }],
          perWorker: [async ({}, use) => { console.log("perWorker setup"); await use("W"); console.log("perWorker teardown"); }, { scope: "worker" }],
          fileDependent: [async function ({ perFile, perWorker }, use) { console.log("fileDependent setup", perWorker, Object.keys(arguments[0]).join()); await use("FD"); console.log("fileDependent teardown"); }, { scope: "file" }],
          autoFile: [async ({}, use) => { console.log("autoFile setup"); await use("AF"); console.log("autoFile teardown"); }, { scope: "file", auto: true }],
          fileValue: ["a value", { scope: "file" }],
          perTest: async ({ perFile }, use) => { perFile.n++; console.log("perTest setup", perFile.n); await use(perFile.n); console.log("perTest teardown"); },
          unusedFile: [async ({}, use) => { console.log("unreachable"); await use(1); }, { scope: "file" }],
        });
        describe("block", () => {
          test.beforeAll(function ({ perFile }, suite) { console.log("test.beforeAll", JSON.stringify(perFile), suite.name, Object.keys(arguments[0]).join()); });
          test.afterAll(({ perFile, fileValue }) => console.log("test.afterAll", JSON.stringify(perFile), fileValue));
          test("one", ({ perTest, perFile }) => console.log("one", perTest, JSON.stringify(perFile)));
          test("two", ({ perTest, fileDependent, fileValue }) => console.log("two", perTest, fileDependent, fileValue));
          test("three", ({ perWorker }) => console.log("three", perWorker));
        });
        describe("a test-scoped fixture in beforeAll", () => {
          test.beforeAll(({ perTest }) => console.log("unreachable"));
          test("test", () => console.log("unreachable"));
        });
        describe("retry", () => {
          let attempt = 0;
          test("test", { retry: 1 }, ({ perTest }) => { console.log("attempt", ++attempt, perTest); if (attempt === 1) throw new Error("again"); });
        });
      `,
    });
    expect({ log, results, errors, exitCode }).toEqual({
      log: [
        "perFile setup",
        "autoFile setup",
        `test.beforeAll {"n":0} block perFile,autoFile`,
        "perTest setup 1",
        `one 1 {"n":1}`,
        "perTest teardown",
        "perWorker setup",
        "fileDependent setup W perFile,autoFile,perWorker",
        "perTest setup 2",
        "two 2 FD a value",
        "perTest teardown",
        "three W",
        `test.afterAll {"n":2} a value`,
        "perTest setup 3",
        "attempt 1 3",
        "perTest teardown",
        "perTest setup 4",
        "attempt 2 4",
        "perTest teardown",
        "file afterAll",
        "file beforeAll teardown",
        "fileDependent teardown",
        "perWorker teardown",
        "autoFile teardown",
        "perFile teardown",
      ],
      results: [
        "(pass) block > one",
        "(pass) block > two",
        "(pass) block > three",
        "(fail) a test-scoped fixture in beforeAll > (unnamed)",
        "(pass) retry > test (attempt 2)",
      ],
      errors: [
        `error: The test-scoped fixture "perTest" cannot be used in beforeAll() or afterAll(). Give it { scope: "file" }, or use beforeEach() or afterEach()`,
        "error: again",
      ],
      exitCode: 1,
    });
  });

  for (const args of [[], ["--isolate"], ["--parallel=2"]]) {
    test(`a file-scoped fixture of a shared module is set up for each file ${args}`.trim(), async () => {
      const { stdout, stderr, exitCode } = await runTests(
        {
          "shared.js": `
            import { test as base } from "vitest";
            export const test = base.extend({
              perFile: [async ({}, use) => { console.log(file, "setup"); await use({ uses: 0 }); console.log(file, "teardown"); }, { scope: "file" }],
              failing: [async ({}, use) => { console.log(file, "failing setup"); throw new Error("no"); }, { scope: "file" }],
            });
          `,
          "a.test.js": `
            import { test } from "./shared.js";
            globalThis.file = "a";
            test("one", ({ perFile }) => console.log("a one", ++perFile.uses));
            test("two", ({ perFile }) => console.log("a two", ++perFile.uses));
          `,
          "b.test.js": `
            import { test } from "./shared.js";
            globalThis.file = "b";
            test("one", ({ perFile }) => console.log("b one", ++perFile.uses));
            test.fails("fails once", ({ failing }) => console.log("unreachable"));
            test.fails("fails again", ({ failing }) => console.log("unreachable"));
          `,
        },
        args,
      );
      const a = ["a setup", "a one 1", "a two 2", "a teardown"];
      const b = ["b setup", "b one 1", "b failing setup", "b teardown"];
      // --parallel prints what the files wrote to stderr, test by test: files that run at the same time take turns.
      const log = (stdout + stderr).split("\n").filter(line => [...a, ...b].includes(line));
      const takeTurns = args.includes("--parallel=2");
      expect(takeTurns ? log.toSorted((x, y) => x.charCodeAt(0) - y.charCodeAt(0)) : log).toEqual([...a, ...b]);
      expect(exitCode).toBe(0);
    });
  }

  describe("file-scoped fixtures that the hooks of a preload script ask for are torn down after those hooks", () => {
    const files = (hooks: string) => ({
      "preload.js": `
        import { test } from "vitest";
        const fixture = name => [async ({}, use) => { console.log(name, "setup"); await use(name); console.log(name, "teardown"); }, { scope: "file" }];
        globalThis.extended = test.extend({ shared: fixture("shared"), first: fixture("first"), last: fixture("last") });
        ${hooks}
      `,
      "a.test.js": `
        import { afterAll } from "vitest";
        afterAll(() => console.log("afterAll of a"));
        extended("a", ({ shared }) => console.log("a", shared));
      `,
      "b.test.js": `
        import { test } from "vitest";
        test("b", () => console.log("b"));
      `,
    });
    const before = ["first setup", "beforeAll first"];
    const after = ["last setup", "afterAll shared last", "last teardown", "shared teardown"];
    const a = ["shared setup", "a shared", "afterAll of a"];

    test.each([
      // The hooks of a preload script run before the first file and after the last one.
      [
        "--no-isolate",
        [
          [...before, ...a, "shared teardown", "first teardown"],
          ["b", "shared setup", ...after],
        ],
      ],
      // The preload script runs for each file.
      [
        "--isolate",
        [
          [...before, ...a, ...after, "first teardown"],
          [...before, "b", "shared setup", ...after, "first teardown"],
        ],
      ],
    ])("%s", async (flag, [logOfA, logOfB]) => {
      const hooks = `
        extended.beforeAll(({ first }) => console.log("beforeAll", first));
        extended.afterAll(({ shared, last }) => console.log("afterAll", shared, last));
      `;
      const run = (...args: string[]) =>
        runTests(files(hooks), ["--preload=./preload.js", ...args], {}, beforeTheTestTimesOut);
      const [once, twice] = await Promise.all([run(flag), run(flag, "--rerun-each=2")]);
      expect({ log: once.log, exitCode: once.exitCode }).toEqual({ log: [...logOfA, ...logOfB], exitCode: 0 });
      expect({ log: twice.log, exitCode: twice.exitCode }).toEqual({
        log: [...logOfA, ...logOfA, ...logOfB, ...logOfB],
        exitCode: 0,
      });
    });

    test("--parallel", async () => {
      const { stdout, stderr, exitCode } = await runTests(
        files(`extended.beforeAll(({ first }) => console.log("beforeAll", first));`),
        ["--preload=./preload.js", "--parallel=1"],
      );
      const expected = [...before, ...a, "shared teardown", "first teardown", ...before, "b", "first teardown"];
      expect({ log: (stdout + stderr).split("\n").filter(line => expected.includes(line)), exitCode }).toEqual({
        log: expected,
        exitCode: 0,
      });
    });
  });

  test("a file-scoped fixture that has failed fails each test that asks for it, at once", async () => {
    const { log, results, errors, stderr, exitCode } = await runTests(
      {
        "a.test.js": `
          import { test as base } from "vitest";
          const scope = { scope: "file" };
          const test = base
            .extend({
              throws: [({}, use) => { console.log("throws"); throw new Error("throws"); }, scope],
              throwsAfterUse: [({}, use) => { console.log("throwsAfterUse"); use(1); throw new Error("throwsAfterUse"); }, scope],
              thenThrows: [({}, use) => { console.log("thenThrows"); return { then() { throw new Error("thenThrows"); } }; }, scope],
              thenGetterThrows: [({}, use) => { console.log("thenGetterThrows"); return { get then() { throw new Error("thenGetterThrows"); } }; }, scope],
            })
            .extend("builderThrows", scope, () => { console.log("builderThrows"); throw new Error("builderThrows"); });
          for (const nth of [1, 2]) {
            test("throws " + nth, ({ throws }) => console.log("unreachable"));
            test("throwsAfterUse " + nth, ({ throwsAfterUse }) => console.log("unreachable"));
            test("thenThrows " + nth, ({ thenThrows }) => console.log("unreachable"));
            test("thenGetterThrows " + nth, ({ thenGetterThrows }) => console.log("unreachable"));
            test("builderThrows " + nth, ({ builderThrows }) => console.log("unreachable"));
          }
          test.afterAll(({ throws }) => console.log("unreachable"));
        `,
      },
      [],
      {},
      beforeTheTestTimesOut,
    );
    const names = ["throws", "throwsAfterUse", "thenThrows", "thenGetterThrows", "builderThrows"];
    expect({ log, results, errors, timedOut: stderr.includes("timed out"), exitCode }).toEqual({
      log: names,
      results: [...names.map(name => `(fail) ${name} 1`), ...names.map(name => `(fail) ${name} 2`), "(fail) (unnamed)"],
      errors: [...names, ...names, "throws"].map(name => `error: ${name}`),
      timedOut: false,
      exitCode: 1,
    });
  });

  test("a fixture that calls use() when what asked for it has ended is told to tear itself down", async () => {
    const { log, results, exitCode } = await runTests({
      "shared.js": `export const sameFile = Promise.withResolvers(), nextFile = Promise.withResolvers();`,
      "a.test.js": `
        import { test as base } from "vitest";
        import { sameFile, nextFile } from "./shared.js";
        const fixture = (name, gate) => async ({}, use) => { await gate.promise; console.log(name, "use"); await use(1); console.log(name, "teardown"); };
        const test = base.extend({
          early: fixture("early", sameFile),
          perTest: fixture("perTest", nextFile),
          perFile: [fixture("perFile", nextFile), { scope: "file" }],
        });
        test("early", { timeout: 1 }, ({ early }) => console.log("unreachable"));
        test("perTest", { timeout: 1 }, ({ perTest }) => console.log("unreachable"));
        test("perFile", { timeout: 1 }, ({ perFile }) => console.log("unreachable"));
        test("a later test", async () => {
          sameFile.resolve();
          await new Promise(resolve => setImmediate(resolve));
          console.log("a later test");
        });
      `,
      "b.test.js": `
        import { test } from "vitest";
        import { nextFile } from "./shared.js";
        nextFile.resolve();
        await new Promise(resolve => setImmediate(resolve));
        test("the next file", () => console.log("the next file"));
      `,
    });
    expect({ log, results, exitCode }).toEqual({
      log: [
        "early use",
        "early teardown",
        "a later test",
        "perTest use",
        "perFile use",
        "perTest teardown",
        "perFile teardown",
        "the next file",
      ],
      results: ["(fail) early", "(fail) perTest", "(fail) perFile", "(pass) a later test", "(pass) the next file"],
      exitCode: 1,
    });
  });

  test("concurrent tests have their own fixtures, and share those of the file", async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test as base } from "vitest";
        const started = Promise.withResolvers();
        let running = 0;
        const test = base.extend({
          perFile: [async ({}, use) => { console.log("perFile setup"); await new Promise((resolve) => setImmediate(resolve)); await use("F"); console.log("perFile teardown"); }, { scope: "file" }],
          own: async ({ task, perFile }, use) => { await use(task.name + perFile); console.log("own teardown", task.name); },
        });
        for (const name of ["a", "b", "c"]) {
          test.concurrent(name, async ({ own, expect }) => {
            if (++running === 3) started.resolve();
            await started.promise;
            expect(own).toBe(name + "F");
          });
        }
      `,
    });
    expect({ log: log.sort(), results: results.sort(), exitCode }).toEqual({
      log: ["own teardown a", "own teardown b", "own teardown c", "perFile setup", "perFile teardown"],
      results: ["(pass) a", "(pass) b", "(pass) c"],
      exitCode: 0,
    });
  });

  test("each, for and the modifiers", async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test as base } from "vitest";
        const test = base.extend({
          a: async ({}, use) => { console.log("a setup"); await use("A"); },
          auto: [async ({}, use) => { console.log("auto setup"); await use(1); }, { auto: true }],
        });
        test.for([10])("for %i", (row, { a }) => console.log("for", row, a));
        test.for([[1, 2]])("for %i %i", ([x, y], { a, task }) => console.log("for", x, y, a, task.name));
        test.each([20])("each %i", function (row, more) { console.log("each", row, arguments.length, more); });
        test.skip("skip", ({ a }) => console.log("unreachable"));
        test.todo("todo");
        test.fails("fails", ({ a }) => { console.log("fails", a); throw new Error("expected"); });
        test.skipIf(false)("skipIf", ({ a }) => console.log("skipIf", a));
        test.runIf(true)("runIf", ({ a }) => console.log("runIf", a));
        test.concurrent("concurrent", ({ a }) => console.log("concurrent", a));
        test("options", { timeout: 1234 }, ({ a, task }) => console.log("options", a, task.timeout));
        console.log(typeof test.only, typeof test.skip.extend, typeof test.extend({}).extend);
      `,
    });
    expect({ log, results, exitCode }).toEqual({
      log: [
        "function function function",
        "a setup",
        "auto setup",
        "for 10 A",
        "a setup",
        "auto setup",
        "for 1 2 A for 1 2",
        "auto setup",
        "each 20 1 undefined",
        "a setup",
        "auto setup",
        "fails A",
        "a setup",
        "auto setup",
        "skipIf A",
        "a setup",
        "auto setup",
        "runIf A",
        "a setup",
        "auto setup",
        "concurrent A",
        "a setup",
        "auto setup",
        "options A 1234",
      ],
      results: [
        "(pass) for 10",
        "(pass) for 1 2",
        "(pass) each 20",
        "(skip) skip",
        "(todo) todo",
        "(pass) fails",
        "(pass) skipIf",
        "(pass) runIf",
        "(pass) concurrent",
        "(pass) options",
      ],
      exitCode: 0,
    });
  });

  test("override() and scoped() replace fixtures for a describe block", async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test as base, describe } from "vitest";
        const test = base.extend({ value: "base", dependent: async ({ value }, use) => use("dependent(" + value + ")") });
        test("before", ({ value, dependent }) => console.log("before", value, dependent));
        describe("block", () => {
          test("registered first", ({ value, dependent }) => console.log("registered first", value, dependent));
          console.log(test.override({ value: "block" }) === test);
          test("block", ({ value, dependent }) => console.log("block", value, dependent));
          describe("deeper", () => { test("deeper", ({ value, dependent }) => console.log("deeper", value, dependent)); });
          describe("again", () => {
            test.scoped({ value: async ({ value }, use) => use(value + "+again") });
            test("again", ({ value, dependent }) => console.log("again", value, dependent));
          });
        });
        test("after", ({ value, dependent }) => console.log("after", value, dependent));
        test("inside a test", () => { try { test.override({ value: 1 }); } catch (error) { console.log(error.message); } });

        const top = base.extend({ value: "base" });
        top("top, registered first", ({ value }) => console.log("top", value));
        top.override({ value: "for the whole file" });
      `,
    });
    expect({ log, results, exitCode }).toEqual({
      log: [
        "true",
        "before base dependent(base)",
        "registered first block dependent(block)",
        "block block dependent(block)",
        "deeper block dependent(block)",
        "again block+again dependent(block+again)",
        "after base dependent(base)",
        "Cannot call test.override() inside a test. Call it inside describe() instead.",
        "top for the whole file",
      ],
      results: [
        "(pass) before",
        "(pass) block > registered first",
        "(pass) block > block",
        "(pass) block > deeper > deeper",
        "(pass) block > again > again",
        "(pass) after",
        "(pass) inside a test",
        "(pass) top, registered first",
      ],
      exitCode: 0,
    });
  });

  test("override() at the top level of a file is undone at the end of the file, that of a preload script stays", async () => {
    const files = {
      "helper.js": `
        import { test as base } from "vitest";
        export const test = base.extend({ value: "default", other: "default", dependent: async ({ value }, use) => use("dependent(" + value + ")") });
      `,
      "preload.js": `
        import { test } from "./helper.js";
        test.override({ other: "of the preload" });
      `,
      "a.test.js": `
        import { test } from "./helper.js";
        test.override({ value: "of a" });
        test("a", ({ value, other, dependent }) => console.log("a:", value, other, dependent));
      `,
      "b.test.js": `
        import { test } from "./helper.js";
        test("b", ({ value, other, dependent }) => console.log("b:", value, other, dependent));
      `,
      "c.test.js": `
        import { describe } from "vitest";
        import { test } from "./helper.js";
        test.override({ value: async ({ value }, use) => use(value + ", then of c") });
        describe("block", () => {
          test.override({ other: "of the block" });
          test("c", ({ value, other, dependent }) => console.log("c:", value, other, dependent));
        });
      `,
    };
    const { log, exitCode } = await runTests(files, [
      "--preload=./preload.js",
      "./a.test.js",
      "./b.test.js",
      "./c.test.js",
    ]);
    expect({ log, exitCode }).toEqual({
      log: [
        "a: of a of the preload dependent(of a)",
        "b: default of the preload dependent(default)",
        "c: default, then of c of the block dependent(default, then of c)",
      ],
      exitCode: 0,
    });
  });

  test("what a callback destructures is not taken from another callback that has been collected", async () => {
    const { log, exitCode } = await runTests({
      "a.test.js": `
        import { test as base, describe } from "vitest";
        const test = base.extend({ a: async ({}, use) => use("A"), b: async ({}, use) => use("B") });
        // Nothing keeps the callback of a skipped test.
        for (let i = 0; i < 500; i++) test.skip("skipped " + i, ({ a }) => i);
        Bun.gc(true);
        let hooks = 0, wrong = 0;
        describe("block", () => {
          for (let i = 0; i < 300; i++) test.beforeEach(({ b }) => { hooks++; if (b !== "B") wrong++; });
          test("test", () => console.log(hooks, wrong));
        });
      `,
    });
    expect({ log, exitCode }).toEqual({ log: ["300 0"], exitCode: 0 });
  });

  test("a callback that is only valid where it was written gets its fixtures", async () => {
    const { log, exitCode } = await runTests({
      "a.test.js": `
        import { test as base } from "vitest";
        const test = base.extend({ a: async ({}, use) => use("A") });
        class Base {
          inherited() { return "inherited"; }
        }
        class Tests extends Base {
          #secret = "private";
          register() {
            test("arrow function: private name", ({ a }) => console.log(a, this.#secret));
            test("arrow function: #x in", ({ a }) => console.log(a, #secret in this));
            test("arrow function: super", ({ a }) => console.log(a, super.inherited()));
            test("arrow function: new.target", ({ a }) => console.log(a, new.target));
            test("function: private name", function ({ a }) { console.log(a, new Tests().#secret); });
          }
          method({ a }) { console.log(a, super.inherited()); }
        }
        new Tests().register();
        test("method of a class: super", Tests.prototype.method);
        test("method of an object: super", { __proto__: new Base(), method({ a }) { console.log(a, super.inherited()); } }.method);
      `,
      "b.test.cjs": `
        const test = require("vitest").test.extend({ a: async ({}, use) => use("A") });
        test("not strict mode code", function ({ a }) { with ({ b: 010 }) console.log(a, b); });
      `,
    });
    expect({ log, exitCode }).toEqual({
      log: ["A private", "A true", "A inherited", "A undefined", "A private", "A inherited", "A inherited", "A 8"],
      exitCode: 0,
    });
  });

  test("a fixture may have the name of an array index", async () => {
    const { log, exitCode } = await runTests({
      "a.test.js": `
        import { test as base } from "vitest";
        const test = base
          .extend({ 0: "zero", 1: async ({}, use) => use("one"), 2: [async ({}, use) => use("two"), { scope: "file" }] })
          .extend("3", async ({ 0: zero }) => zero + ", three");
        test("test", ({ 0: zero, 1: one, "2": two, 3: three }) => console.log(zero, one, two, three));
        test.beforeAll(({ 2: two }) => console.log("beforeAll:", two));
      `,
    });
    expect({ log, exitCode }).toEqual({ log: ["beforeAll: two", "zero one two zero, three"], exitCode: 0 });
  });

  test("extend(name, value) and extend(name, options, fn)", async () => {
    const { log, results, errors, exitCode } = await runTests({
      "a.test.js": `
        import { test as base } from "vitest";
        const test = base
          .extend("one", 1)
          .extend("two", async ({ one }) => { console.log("two setup"); return one + 1; })
          .extend("three", { auto: false }, async ({ two }, { onCleanup }) => { onCleanup(() => console.log("three cleanup")); return two + 1; })
          .extend("sync", ({ one }, { onCleanup }) => { onCleanup(async () => { await 1; console.log("sync cleanup"); }); return "sync" + one; })
          .extend("perFile", { scope: "file" }, (_, { onCleanup }) => { console.log("perFile setup"); onCleanup(() => console.log("perFile cleanup")); return "F"; })
          .extend("empty", { auto: false })
          .extend("twice", ({}, { onCleanup }) => { onCleanup(() => {}); onCleanup(() => {}); })
          .extend("throws", async () => { throw new Error("no value"); });
        test("test", ({ one, two, three, sync, perFile, empty }) => console.log(one, two, three, sync, perFile, JSON.stringify(empty)));
        test("again", ({ two, perFile }) => console.log(two, perFile));
        test("twice", ({ twice }) => console.log("unreachable"));
        test("throws", ({ throws }) => console.log("unreachable"));
      `.replace("(_, {", "({}, {"),
    });
    expect({ log, results, errors, exitCode }).toEqual({
      log: [
        "two setup",
        "perFile setup",
        "1 2 3 sync1 F {}",
        "sync cleanup",
        "three cleanup",
        "two setup",
        "2 F",
        "perFile cleanup",
      ],
      results: ["(pass) test", "(pass) again", "(fail) twice", "(fail) throws"],
      errors: [`error: onCleanup() of fixture "twice" was called more than once`, "error: no value"],
      exitCode: 1,
    });
  });

  test("test.describe, test.suite and the hooks of test", async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { test as base, describe } from "vitest";
        import { test as bunTest } from "bun:test";
        const test = base.extend({ a: "A" });
        console.log(test.describe === test.suite, typeof describe.describe, typeof describe.beforeEach, typeof base.beforeAll);
        test.describe("block", () => {
          test.beforeAll(() => console.log("beforeAll"));
          test.beforeEach(({ a }) => console.log("beforeEach", a));
          test.afterEach(({ a }) => console.log("afterEach 1", a));
          test.afterEach(({ a }) => console.log("afterEach 2", a));
          test.afterAll(() => console.log("afterAll"));
          test("test", ({ a, task }) => console.log(task.fullTestName, a));
        });
        bunTest.describe("of bun:test", () => {
          bunTest.afterEach((done) => { console.log("afterEach 1", typeof done); done(); });
          bunTest.afterEach(() => console.log("afterEach 2"));
          bunTest("test", () => {});
        });
      `,
    });
    expect({ log, results, exitCode }).toEqual({
      log: [
        "true undefined undefined function",
        "beforeAll",
        "beforeEach A",
        "block > test A",
        "afterEach 2 A",
        "afterEach 1 A",
        "afterAll",
        "afterEach 1 function",
        "afterEach 2",
      ],
      results: ["(pass) block > test", "(pass) of bun:test > test"],
      exitCode: 0,
    });
  });

  test("fixtures survive a collection between extend() and the tests, and are collected afterwards", async () => {
    const { log, exitCode } = await runTests({
      "a.test.js": `
        import { test as base } from "vitest";
        import { heapStats } from "bun:jsc";
        const test = base.extend({ a: async ({}, use) => { await use({ big: new Array(1000).fill(0) }); }, value: { kept: true } }).extend({ b: async ({ a }, use) => use(a) });
        Bun.gc(true);
        for (let i = 0; i < 60; i++) test("test " + i, ({ b, value }) => { if (!b.big || !value.kept) throw new Error("lost"); if (i === 30) Bun.gc(true); });
        test("count", ({ value }) => {
          Bun.gc(true);
          const { ActiveFixture = 0, TestContext, TestFixtures } = heapStats().objectTypeCounts;
          console.log(ActiveFixture < 10, TestContext < 10, TestFixtures < 10);
        });
      `,
    });
    expect({ log, exitCode }).toEqual({ log: ["true true true"], exitCode: 0 });
  });
});

describe.concurrent("resolution", () => {
  const probe = `
    const out = {};
    const attempt = async (name, fn) => { try { out[name] = await fn(); } catch (error) { out[name] = "error: " + error.message.split("\\n")[0]; } };
  `;
  const flavour = (module: string) => `((m) => m.test === FLAVOURS["${module}"].test)`;

  test("every way to ask for the modules finds them", async () => {
    const { log, exitCode } = await runTests({
      "esm.test.mjs": `
        import * as vitest from "vitest";
        import * as jest from "@jest/globals";
        import * as bun from "bun:test";
        import { createRequire } from "node:module";
        ${probe}
        const names = { vitest: "vit" + "est", jest: "@jest/" + "globals" };
        vitest.test("esm", async () => {
          await attempt("import()", async () => (await import("vitest")).test === vitest.test && (await import("@jest/globals")).test === bun.test);
          await attempt("import(name)", async () => (await import(names.vitest)).test === vitest.test && (await import(names.jest)).test === bun.test);
          await attempt("require()", () => require("vitest").test === vitest.test && require("@jest/globals").test === bun.test);
          await attempt("require(name)", () => require(names.vitest).test === vitest.test && require(names.jest).test === bun.test);
          await attempt("createRequire", () => createRequire(import.meta.url)("vitest").test === vitest.test);
          await attempt("import.meta.resolve", () => [import.meta.resolve("vitest"), import.meta.resolve(names.jest)].join());
          await attempt("require.resolve", () => [require.resolve("vitest"), require.resolve(names.jest)].join());
          await attempt("Bun.resolveSync", () => [Bun.resolveSync("vitest", import.meta.dir), Bun.resolveSync("@jest/globals", import.meta.dir)].join());
          await attempt("direct", async () => (await import("bun:test/vitest")).test === vitest.test && require("bun:test/vitest") === vitest.default);
          await attempt("default", () => require("vitest") === vitest.default && jest.default === bun.default);
          console.log(JSON.stringify(out, null, 1));
        });
      `,
      "cjs.test.cjs": `
        const vitest = require("vitest");
        const jest = require("@jest/globals");
        const bun = require("bun:test");
        console.log("cjs", vitest !== bun, jest === bun, require.resolve("vitest"), require.resolve("@jest/globals"));
        vitest.test("vitest", (ctx) => console.log("cjs vitest", typeof ctx.task));
        jest.test("jest", (done) => { console.log("cjs jest", typeof done); done(); });
      `,
    });
    expect({ log, exitCode }).toEqual({
      log: [
        "cjs true true bun:test/vitest bun:test",
        "cjs vitest object",
        "cjs jest function",
        "{",
        ` "import()": true,`,
        ` "import(name)": true,`,
        ` "require()": true,`,
        ` "require(name)": true,`,
        ` "createRequire": true,`,
        ` "import.meta.resolve": "bun:test/vitest,bun:test",`,
        ` "require.resolve": "bun:test/vitest,bun:test",`,
        ` "Bun.resolveSync": "bun:test/vitest,bun:test",`,
        ` "direct": true,`,
        ` "default": true`,
        "}",
      ],
      exitCode: 0,
    });
  });

  const installed = {
    "node_modules/vitest/package.json": JSON.stringify({ name: "vitest", version: "0.0.0", main: "index.js" }),
    "node_modules/vitest/index.js": `exports.installed = "vitest";`,
    "node_modules/@jest/globals/package.json": JSON.stringify({
      name: "@jest/globals",
      version: "0.0.0",
      main: "index.js",
    }),
    "node_modules/@jest/globals/index.js": `exports.installed = "@jest/globals";`,
    "node_modules/library/package.json": JSON.stringify({
      name: "library",
      version: "0.0.0",
      exports: { ".": { import: "./index.mjs", require: "./index.cjs" } },
    }),
    "node_modules/library/index.mjs": `
      import { expect, afterEach } from "vitest";
      import * as vitest from "vitest";
      export { vitest };
      expect.extend({ toBeFromTheLibrary: () => ({ pass: true, message: () => "" }) });
      afterEach((ctx) => console.log("library afterEach", ctx.task.name));
    `,
    "node_modules/library/index.cjs": `exports.vitest = require("vitest"); exports.jest = require("@jest/globals");`,
  };

  test("under `bun test` the builtin wins over an installed package, also for a library in node_modules", async () => {
    const { log, exitCode } = await runTests({
      ...installed,
      "a.test.mjs": `
        import * as vitest from "vitest";
        import * as bun from "bun:test";
        import * as library from "library";
        const name = "vit" + "est";
        vitest.test("test", async () => {
          console.log(vitest.installed, require("vitest").installed, (await import(name)).installed, require("@jest/globals").installed);
          console.log(library.vitest.test === vitest.test, require("library").vitest.test === vitest.test, require("library").jest.test === bun.test);
          vitest.expect(1).toBeFromTheLibrary();
        });
      `,
    });
    expect({ log, exitCode }).toEqual({
      log: ["undefined undefined undefined undefined", "true true true", "library afterEach test"],
      exitCode: 0,
    });
  });

  test("outside of `bun test` nothing changes", async () => {
    using dir = tempDir("vitest-flavor-run", {
      ...installed,
      "installed.mjs": `
        import * as vitest from "vitest";
        import * as jest from "@jest/globals";
        const name = "vit" + "est";
        console.log(vitest.installed, jest.installed, require("vitest").installed, (await import(name)).installed);
        console.log(import.meta.resolve("vitest").endsWith("/node_modules/vitest/index.js"), require.resolve("@jest/globals").endsWith("index.js"));
        console.log(require("node:module").isBuiltin("vitest"), require("node:module").isBuiltin("@jest/globals"));
      `,
      "missing/package.json": "{}",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "installed.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "vitest @jest/globals vitest vitest\ntrue true\nfalse false\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("outside of `bun test`, a package that is not installed is not found", async () => {
    using dir = tempDir("vitest-flavor-missing", {
      "missing.mjs": `
        for (const name of ["vitest", "@jest/globals"]) {
          try { require(name); console.log("found"); } catch (error) { console.log(error.code ?? error.name, name); }
          try { await import(name); console.log("found"); } catch (error) { console.log(error.code ?? error.name, name); }
        }
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--no-install", "missing.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout:
        "MODULE_NOT_FOUND vitest\nERR_MODULE_NOT_FOUND vitest\nMODULE_NOT_FOUND @jest/globals\nERR_MODULE_NOT_FOUND @jest/globals\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

describe.concurrent("the name of the running test", () => {
  const names = `
    expect.extend({
      toLogItsTest(received) {
        console.log(received, "matcher:", this.currentTestName);
        return { pass: true, message: () => "" };
      },
    });
    const log = label => {
      console.log(label, "state:", expect.getState().currentTestName);
      expect(label).toLogItsTest();
    };
  `;

  test(`is joined with " > " for a test of "vitest", with a space for the others`, async () => {
    const file = (module: string) => `
      import { describe, test, expect, beforeEach, afterEach } from ${JSON.stringify(module)};
      ${names}
      describe("outer", () => {
        beforeEach(() => log("beforeEach"));
        afterEach(() => log("afterEach"));
        describe("", () => {
          describe("inner", () => {
            test("a > b", () => log("test"));
          });
        });
      });
      test("alone", () => log("test"));
    `;
    const expected = (name: string) => [
      ...["beforeEach", "test", "afterEach"].flatMap(label => [`${label} state: ${name}`, `${label} matcher: ${name}`]),
      "test state: alone",
      "test matcher: alone",
    ];
    const [vitest, bun, jest] = await Promise.all(
      ["vitest", "bun:test", "@jest/globals"].map(module => runTests({ "a.test.js": file(module) })),
    );
    expect(vitest.log).toEqual(expected("outer > inner > a > b"));
    expect(bun.log).toEqual(expected("outer inner a > b"));
    expect(jest.log).toEqual(expected("outer inner a > b"));
    expect([vitest.exitCode, bun.exitCode, jest.exitCode]).toEqual([0, 0, 0]);
  });

  test("goes by the test, not by the describe block, the hook or the expect", async () => {
    const { log, exitCode } = await runTests({
      "a.test.js": `
        import * as vitest from "vitest";
        import * as bun from "bun:test";
        const { expect } = bun;
        ${names}
        vitest.describe("of vitest", () => {
          bun.beforeEach(() => log("beforeEach"));
          bun.test("test of bun", () => log("test"));
        });
        bun.describe("of bun", () => {
          vitest.beforeEach(() => log("beforeEach"));
          vitest.test("test of vitest", () => log("test"));
        });
      `,
    });
    expect(log).toEqual([
      "beforeEach state: of vitest test of bun",
      "beforeEach matcher: of vitest test of bun",
      "test state: of vitest test of bun",
      "test matcher: of vitest test of bun",
      "beforeEach state: of bun > test of vitest",
      "beforeEach matcher: of bun > test of vitest",
      "test state: of bun > test of vitest",
      "test matcher: of bun > test of vitest",
    ]);
    expect(exitCode).toBe(0);
  });
});

test.concurrent("node:module does not take what stands in for a package for a builtin module", async () => {
  const { log, exitCode } = await runTests({
    "builtin.test.ts": `
      import { test } from "bun:test";
      import Module, { builtinModules, isBuiltin } from "node:module";
      test("every way to ask", () => {
        for (const name of ["vitest", "@jest/globals", "bun:test/vitest", "bun:test", "fs"]) {
          console.log(name, isBuiltin(name), builtinModules.includes(name), require.resolve.paths(name) === null, Module._resolveLookupPaths(name, null) === null);
        }
      });
    `,
  });
  expect(log).toEqual([
    "vitest false false false false",
    "@jest/globals false false false false",
    "bun:test/vitest false false false false",
    "bun:test true true true true",
    "fs true true true true",
  ]);
  expect(exitCode).toBe(0);
});
