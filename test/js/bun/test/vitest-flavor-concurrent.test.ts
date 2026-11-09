// Concurrent tests run at once, each with its own hooks. Code follows the rules of the test or hook that runs for
// its own test: those of "vitest" or those of "bun:test", whichever module that test or hook was imported from.
// Not in vitest-flavor.test.ts: a debug build takes about a minute for that file, and seconds for this one.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function runTests(files: Record<string, string>, args: string[] = []) {
  using dir = tempDir("vitest-flavor-concurrent", files);
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

const modules = ["bun:test", "vitest"] as const;
type Module = (typeof modules)[number];
const ruleOf = (module: Module) => (module === "vitest" ? "Vitest" : "Jest");

// Vitest's toEqual() compares the lengths of two arrays. For Jest's, an item that is not there is undefined.
const rules = `
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const rule = () => { try { expect([1]).toEqual([1, undefined]); return "Jest"; } catch { return "Vitest"; } };
  const seen = {};
  const note = who => void (seen[who] ??= new Set()).add(rule());
  const show = title => console.log(title + " | " + Object.keys(seen).sort().map(who => who + ": " + [...seen[who]].sort().join(" and ")).join(", "));
`;

// Four tests that end at different times, so the hooks of one test start while the other tests wait.
const fourTests = `
  ["a", "b", "c", "d"].forEach((name, index) => {
    test.concurrent(name, async () => {
      note("tests");
      for (let i = 0; i < 2 + index * 2; i++) { await tick(); note("tests"); }
      await new Promise(resolve => setTimeout(resolve, 1));
      note("tests");
    });
  });
`;

function besideEachHooks(ofTests: Module, ofHooks: Module) {
  const title = `tests of ${ofTests}, beforeEach and afterEach of ${ofHooks}`;
  return {
    source: `
      import { afterAll, expect, test } from "${ofTests}";
      import { afterEach, beforeEach } from "${ofHooks}";
      ${rules}
      beforeEach(async () => { note("beforeEach"); await tick(); note("beforeEach"); await tick(); note("beforeEach"); });
      afterEach(async () => { note("afterEach"); await tick(); note("afterEach"); });
      ${fourTests}
      afterAll(() => show(${JSON.stringify(title)}));
    `,
    output: `${title} | afterEach: ${ruleOf(ofHooks)}, beforeEach: ${ruleOf(ofHooks)}, tests: ${ruleOf(ofTests)}`,
  };
}

function insideAroundEach(ofTests: Module, ofHooks: Module) {
  const title = `tests of ${ofTests}, aroundEach of ${ofHooks}`;
  return {
    source: `
      import { afterAll, expect, test } from "${ofTests}";
      import { aroundEach } from "${ofHooks}";
      ${rules}
      aroundEach(async runTest => {
        note("aroundEach"); await tick(); note("aroundEach");
        await runTest();
        note("aroundEach"); await tick(); note("aroundEach");
      });
      ${fourTests}
      afterAll(() => show(${JSON.stringify(title)}));
    `,
    output: `${title} | aroundEach: ${ruleOf(ofHooks)}, tests: ${ruleOf(ofTests)}`,
  };
}

// The second beforeEach call fails while the tests of two other sequences run. The first test fails after
// the afterEach hooks of the other tests have started.
const failing = (ofTests: Module, ofHooks: Module) => `
  import { afterAll, test } from "${ofTests}";
  import { afterEach, beforeEach } from "${ofHooks}";
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const listener = error => console.log("the listener heard:", error.message);
  for (const event of ["unhandledRejection", "uncaughtException"]) process.on(event, listener);
  afterAll(() => { for (const event of ["unhandledRejection", "uncaughtException"]) process.off(event, listener); });
  // Each promise resolves after its error is reported.
  const causes = {
    "a rejection": error => { Promise.reject(error); return tick(); },
    "a microtask": error => new Promise(resolve => queueMicrotask(() => { resolve(); throw error; })),
    "a timer": error => new Promise(resolve => setTimeout(() => { resolve(); throw error; }, 1)),
  };
  const fail = async where => {
    for (const how in causes) await causes[how](new Error(how + " in a " + where + " of ${ofTests} tests beside ${ofHooks} hooks"));
  };
  const hook = Promise.withResolvers();
  const others = Promise.withResolvers();
  let started = 0;
  let ended = 0;
  beforeEach(async () => {
    if (++started !== 2) return;
    await tick();
    await fail("hook");
    hook.resolve();
  });
  afterEach(() => { if (++ended === 2) others.resolve(); });
  test.concurrent("first", async () => { await others.promise; await fail("test"); });
  test.concurrent("second", async () => {});
  test.concurrent("third", async () => { await hook.promise; });
`;
// What the listeners of the files hear (`module` is "vitest"), or what the runner reports (`module` is "bun:test").
const failuresOf = (module: Module, files: (readonly [Module, Module])[]) =>
  files.flatMap(([ofTests, ofHooks]) =>
    [...(ofHooks === module ? ["hook"] : []), ...(ofTests === module ? ["test"] : [])].flatMap(where =>
      ["a rejection", "a microtask", "a timer"].map(
        how => `${how} in a ${where} of ${ofTests} tests beside ${ofHooks} hooks`,
      ),
    ),
  );

const pairs = modules.flatMap(ofTests => modules.map(ofHooks => [ofTests, ofHooks] as const));
const inFiles = (fixtures: { source: string }[]) =>
  Object.fromEntries(fixtures.map(({ source }, index) => [`${index}.test.js`, source]));

describe.concurrent("toEqual() after an await", () => {
  test("tests of either module beside hooks of either module", async () => {
    const fixtures = [...pairs.map(pair => besideEachHooks(...pair)), ...pairs.map(pair => insideAroundEach(...pair))];
    const { log, exitCode } = await runTests(inFiles(fixtures));
    expect(log).toEqual(fixtures.map(fixture => fixture.output));
    expect(exitCode).toBe(0);
  });

  test.each([[["--isolate"]], [["--max-concurrency=2"]]])("with %j", async args => {
    const fixtures = [besideEachHooks("vitest", "bun:test"), besideEachHooks("bun:test", "vitest")];
    const { log, exitCode } = await runTests(inFiles(fixtures), args);
    expect(log).toEqual(fixtures.map(fixture => fixture.output));
    expect(exitCode).toBe(0);
  });

  test("a matcher fails the test it is in, and no other", async () => {
    const { results, exitCode } = await runTests({
      "hooks.test.js": `
        import { afterEach, beforeEach } from "bun:test";
        import { expect, test } from "vitest";
        const tick = () => new Promise(resolve => setImmediate(resolve));
        beforeEach(() => {});
        afterEach(() => {});
        ["a", "b", "c", "d"].forEach((name, index) => {
          test.concurrent(name, async () => {
            for (let i = 0; i < 2 + index * 2; i++) await tick();
            // Vitest: arrays of different lengths are never equal, so this must fail in each test.
            expect([1]).toEqual([1, undefined]);
          });
        });
      `,
      // A test.for() row of "bun:test" has Vitest's rules.
      "row.test.js": `
        import { expect, test } from "bun:test";
        const tick = () => new Promise(resolve => setImmediate(resolve));
        test.concurrent("plain", async () => {
          expect([1]).toEqual([1, undefined]);
          await tick();
          expect([1]).toEqual([1, undefined]);
        });
        test.concurrent.for([1])("row %i", async () => { await tick(); await tick(); });
      `,
    });
    expect(results).toEqual(["(fail) a", "(fail) b", "(fail) c", "(fail) d", "(pass) plain", "(pass) row 1"]);
    expect(exitCode).toBe(1);
  });

  test("in a timer, in an AsyncLocalStorage, in a matcher that runs later, and in a retry", async () => {
    const { log, results, exitCode } = await runTests({
      "a.test.js": `
        import { AsyncLocalStorage } from "node:async_hooks";
        import { afterAll, expect, test, vi } from "vitest";
        import { afterEach, beforeEach } from "bun:test";
        ${rules}
        const storage = new AsyncLocalStorage();
        // Each of these passes at once with Vitest's toEqual(), and fails or times out with Jest's.
        const later = (who, promise) => promise.then(() => "Vitest", () => "Jest").then(rule => void (seen[who] = [rule]));
        const soon = value => new Promise(resolve => setImmediate(resolve, value));
        beforeEach(done => {
          setTimeout(() => { note("a hook with a done callback"); done(); }, 1);
        });
        afterEach(() => {});
        test.concurrent("ends first", async () => { await tick(); });
        test.concurrent("a timer", async () => {
          await tick();
          await new Promise(resolve => setTimeout(() => { note("a timer"); resolve(); }, 1));
        });
        test.concurrent("an AsyncLocalStorage", async () => {
          await tick();
          await storage.run("the store", async () => {
            await tick();
            note("run(): " + storage.getStore());
            await storage.exit(async () => { await tick(); note("exit(): " + storage.getStore()); });
          });
        });
        test.concurrent("a callback of the context", async ({ onTestFinished }) => {
          onTestFinished(async () => { await tick(); await tick(); note("onTestFinished()"); });
          await tick();
        });
        test.concurrent("matchers that run later", async () => {
          await tick(); await tick();
          await later(".resolves", expect(soon([1])).resolves.not.toEqual([1, undefined]));
          await later("expect.poll()", expect.poll(() => [1], { interval: 1, timeout: 50 }).not.toEqual([1, undefined]));
          await later("vi.waitFor()", vi.waitFor(() => expect([1]).not.toEqual([1, undefined]), { interval: 1, timeout: 50 }));
        });
        test.concurrent("retried", { retry: 1 }, async ({ task }) => {
          await tick(); await tick();
          note("attempt " + (task.result.retryCount + 1));
          if (task.result.retryCount === 0) throw new Error("the first attempt fails");
        });
        afterAll(() => show("tests of vitest beside hooks of bun:test"));
      `,
    });
    expect(log).toEqual([
      "tests of vitest beside hooks of bun:test | " +
        [
          ".resolves: Vitest",
          "a hook with a done callback: Jest",
          "a timer: Vitest",
          "attempt 1: Vitest",
          "attempt 2: Vitest",
          "exit(): undefined: Vitest",
          "expect.poll(): Vitest",
          "onTestFinished(): Vitest",
          "run(): the store: Vitest",
          "vi.waitFor(): Vitest",
        ].join(", "),
    ]);
    expect(results.length).toBe(6);
    expect(exitCode).toBe(0);
  });

  // A group that is not concurrent does the same: there the one test or hook that runs decides.
  test("what a hook left behind follows the test that its hook ran for, while that test runs", async () => {
    const fixtures = [pairs[1], pairs[2]].map(([ofTests, ofHooks]) => {
      const title = `tests of ${ofTests}, beforeEach and afterEach of ${ofHooks}`;
      return {
        source: `
          import { AsyncLocalStorage } from "node:async_hooks";
          import { afterAll, expect, test } from "${ofTests}";
          import { afterEach, beforeEach } from "${ofHooks}";
          ${rules}
          const left = [];
          const snapshots = [];
          let hooks = 0;
          let tests = 0;
          // Each call leaves a loop behind that is longer than the one before, so the tests end one by one.
          beforeEach(() => {
            const ticks = 4 + hooks * 4;
            snapshots.push(AsyncLocalStorage.snapshot());
            left[hooks++] = (async () => {
              for (let i = 0; i < ticks; i++) { await tick(); note("what beforeEach left behind"); }
            })();
          });
          // While the hook of a test that has ended waits, the loops of the other tests go on.
          afterEach(async () => { note("afterEach"); await tick(); await tick(); await tick(); note("afterEach"); });
          for (const name of ["a", "b", "c", "d"]) {
            test.concurrent(name, async () => {
              const mine = tests++;
              await left[mine];
              snapshots[mine](() => note("in a snapshot of beforeEach"));
            });
          }
          afterAll(() => show(${JSON.stringify(title)}));
        `,
        output: `${title} | afterEach: ${ruleOf(ofHooks)}, in a snapshot of beforeEach: ${ruleOf(ofTests)}, what beforeEach left behind: ${ruleOf(ofTests)}`,
      };
    });
    const { log, exitCode } = await runTests(inFiles(fixtures));
    expect(log).toEqual(fixtures.map(fixture => fixture.output));
    expect(exitCode).toBe(0);
  });

  test("in then() of what a test or an aroundEach hook returns", async () => {
    const title = "tests of bun:test inside an aroundEach of vitest";
    const { log, exitCode } = await runTests({
      "a.test.js": `
        import { afterAll, expect, test } from "bun:test";
        import { aroundEach } from "vitest";
        ${rules}
        // then() notes the rule when it is called, and after an await.
        const thenable = (who, settle) => ({
          then(resolve, reject) {
            note(who);
            tick().then(() => { note(who); return settle(); }).then(resolve, reject);
          },
        });
        let hooks = 0;
        // The last hook lets its test start at once. The other hooks are in then() at that time.
        aroundEach(runTest => (++hooks === 3 ? runTest() : thenable("then() of an aroundEach", runTest)));
        for (const name of ["a", "b", "c"]) test.concurrent(name, () => thenable("then() of a test", () => {}));
        afterAll(() => show(${JSON.stringify(title)}));
      `,
    });
    expect(log).toEqual([`${title} | then() of a test: Jest, then() of an aroundEach: Vitest`]);
    expect(exitCode).toBe(0);
  });

  // No import in a test file gives such a project one module: the files share the preload script.
  test("hooks of a preload script that files of both modules share", async () => {
    const testFile = (module: Module) => `
      import { afterAll, expect, test } from "${module}";
      ${rules}
      ${fourTests}
      afterAll(() => { Object.assign(seen, seenInPreload); show("tests of ${module}"); for (const who in seenInPreload) delete seenInPreload[who]; });
    `;
    const { log, exitCode } = await runTests(
      {
        "setup.js": `
          import { afterEach, beforeEach, expect } from "bun:test";
          ${rules}
          Object.assign(globalThis, { seenInPreload: seen });
          beforeEach(async () => { note("beforeEach of the preload"); await tick(); note("beforeEach of the preload"); await tick(); note("beforeEach of the preload"); });
          afterEach(async () => { note("afterEach of the preload"); await tick(); note("afterEach of the preload"); });
        `,
        "a.test.js": testFile("vitest"),
        "b.test.js": testFile("bun:test"),
      },
      ["--preload", "./setup.js"],
    );
    expect(log).toEqual([
      "tests of vitest | afterEach of the preload: Jest, beforeEach of the preload: Jest, tests: Vitest",
      "tests of bun:test | afterEach of the preload: Jest, beforeEach of the preload: Jest, tests: Jest",
    ]);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("an error that nobody handles", () => {
  test("goes to the file's listeners if the test or hook that runs is vitest's, and to the runner if not", async () => {
    // A file with both modules runs first, and files with one module after it.
    const order = [pairs[1], pairs[3], pairs[2], pairs[0]];
    const run = await runTests(Object.fromEntries(order.map((pair, index) => [`${index}.test.js`, failing(...pair)])));
    expect({ log: run.log, errors: run.errors, results: run.results }).toEqual({
      log: failuresOf("vitest", order).map(message => `the listener heard: ${message}`),
      errors: failuresOf("bun:test", order).map(message => `error: ${message}`),
      results: order.flatMap(() => ["(pass) second", "(pass) third", "(pass) first"]),
    });
    expect(run.exitCode).toBe(1);
  });

  test("a rejection in a test of bun:test, after a hook of vitest has started", async () => {
    const { log, errors, exitCode } = await runTests({
      "a.test.js": `
        import { expect, test } from "bun:test";
        import { afterEach } from "vitest";
        const tick = () => new Promise(resolve => setImmediate(resolve));
        process.on("unhandledRejection", error => { console.log("listener got:", error.message); });
        afterEach(() => {});
        test.concurrent("a", async () => { await tick(); });
        test.concurrent("b", async () => {
          for (let i = 0; i < 4; i++) await tick();
          Promise.reject(new Error("from b"));
          for (let i = 0; i < 4; i++) await tick();
        });
      `,
    });
    expect({ log, errors }).toEqual({ log: [], errors: ["error: from b"] });
    expect(exitCode).toBe(1);
  });

  // Bun reports a rejection after the turn it happened in. By then the group is over, and a hook of the next test has started.
  test("a rejection in the last statement of the last test of a group", async () => {
    const file = (ofTests: Module, ofHooks: Module) => `
      import { afterAll, test } from "${ofTests}";
      import { beforeEach } from "${ofHooks}";
      const tick = () => new Promise(resolve => setImmediate(resolve));
      const listener = error => console.log("the listener heard:", error.message);
      process.on("unhandledRejection", listener);
      afterAll(() => { process.off("unhandledRejection", listener); });
      beforeEach(() => {});
      test.concurrent("ends first", async () => { await tick(); });
      test.concurrent("rejects", async () => {
        for (let i = 0; i < 4; i++) await tick();
        Promise.reject(new Error("the last statement of a test of ${ofTests}"));
      });
      test("the next test", async () => { await tick(); });
    `;
    const { log, errors, exitCode } = await runTests({
      "0.test.js": file("vitest", "bun:test"),
      "1.test.js": file("bun:test", "vitest"),
    });
    expect({ log, errors }).toEqual({
      log: ["the listener heard: the last statement of a test of vitest"],
      errors: ["error: the last statement of a test of bun:test"],
    });
    expect(exitCode).toBe(1);
  });
});

describe.concurrent("where nothing changes", () => {
  test("outside a concurrent group with both modules, code has the rules of the test or hook that started last", async () => {
    const { log, exitCode } = await runTests({
      // One entry runs at a time, so code that a hook left behind runs while the test does.
      "0.test.js": `
        import { expect, test } from "vitest";
        import { beforeEach } from "bun:test";
        ${rules}
        let left;
        beforeEach(() => {
          left = (async () => { await tick(); await tick(); note("left by the hook"); })();
        });
        test("the test", async () => { note("the test"); await left; show("not concurrent"); });
      `,
      // What a group with both modules leaves behind doesn't keep its rules in a later group.
      "1.test.js": `
        import { expect, test } from "vitest";
        import { beforeEach, test as testOfBun } from "bun:test";
        ${rules}
        const later = Promise.withResolvers();
        let left;
        beforeEach(() => {});
        test.concurrent("first", async () => {
          await tick();
          note("in its group");
          left = later.promise.then(() => note("in a later group"));
        });
        test.concurrent("second", async () => { await tick(); });
        testOfBun("a later test of bun:test", async () => { later.resolve(); await left; show("left by a group"); });
      `,
      // A concurrent test that nothing runs at once with is a group like the one of "0.test.js".
      "2.test.js": `
        import { heapStats } from "bun:jsc";
        import { expect, test } from "vitest";
        import { beforeEach } from "bun:test";
        ${rules}
        let left;
        beforeEach(() => {
          left = (async () => { await tick(); await tick(); note("left by the hook"); })();
        });
        test.concurrent("the test", async () => {
          note("the test");
          // A timer keeps the async context it was set in, if there is one.
          const timers = Array.from({ length: 100 }, () => setTimeout(() => {}, 100_000));
          await left;
          Bun.gc(true);
          show("one concurrent test");
          console.log("timers that keep an async context:", heapStats().objectTypeCounts.AsyncContextFrame ?? 0);
          timers.forEach(clearTimeout);
        });
      `,
    });
    expect(log).toEqual([
      "not concurrent | left by the hook: Vitest, the test: Vitest",
      "left by a group | in a later group: Jest, in its group: Vitest",
      "one concurrent test | left by the hook: Vitest, the test: Vitest",
      "timers that keep an async context: 0",
    ]);
    expect(exitCode).toBe(0);
  });

  test("what a group left behind when the runner gave up its file has the rules of the running test", async () => {
    const { log, errors, results, exitCode } = await runTests({
      "0.test.js": `
        import { expect, test } from "vitest";
        import { beforeEach } from "bun:test";
        ${rules}
        globalThis.later = Promise.withResolvers();
        beforeEach(() => {}, 0);
        // The runner gives up a test that nothing can settle.
        test.concurrent("never settles", async () => {
          await tick();
          globalThis.left = later.promise.then(rule);
          await new Promise(() => {});
        }, 0);
        test.concurrent("ends", async () => { await tick(); }, 0);
      `,
      "1.test.js": `
        import { heapStats } from "bun:jsc";
        import { test } from "bun:test";
        test("a test of the next file", async () => {
          later.resolve();
          console.log("left by the group:", await left);
          // A timer keeps the async context it was set in, if there is one.
          const timers = Array.from({ length: 100 }, () => setTimeout(() => {}, 100_000));
          Bun.gc(true);
          console.log("timers that keep an async context:", heapStats().objectTypeCounts.AsyncContextFrame ?? 0);
          timers.forEach(clearTimeout);
        });
      `,
    });
    expect({ log, errors: errors.map(line => line.replace(/ in ".*"$/, "")), results, exitCode }).toEqual({
      log: ["left by the group: Jest", "timers that keep an async context: 0"],
      errors: ["error: A test or hook with no timeout never settled"],
      results: ["(pass) ends", "(pass) a test of the next file"],
      exitCode: 1,
    });
  });

  test("a concurrent group with one module runs no callback in an async context", async () => {
    const { log, exitCode } = await runTests({
      "a.test.js": `
        import { heapStats } from "bun:jsc";
        import { test as testOfBun } from "bun:test";
        import { afterAll, afterEach, beforeEach, test } from "vitest";
        const tick = () => new Promise(resolve => setImmediate(resolve));
        const counts = [];
        beforeEach(() => {});
        afterEach(() => {});
        // A test that doesn't run is not a second module.
        testOfBun.concurrent.skip("skipped", () => {});
        for (const name of ["a", "b", "c", "d"]) {
          test.concurrent(name, async () => {
            await tick();
            // A timer keeps the async context it was set in, if there is one.
            const timers = Array.from({ length: 250 }, () => setTimeout(() => {}, 100_000));
            await tick();
            counts.push(heapStats().objectTypeCounts.AsyncContextFrame ?? 0);
            timers.forEach(clearTimeout);
          });
        }
        afterAll(() => console.log("timers that keep an async context:", ...counts));
      `,
    });
    expect(log).toEqual(["timers that keep an async context: 0 0 0 0"]);
    expect(exitCode).toBe(0);
  });
});

// Not among the concurrent tests: a debug build starts slowly with --isolate=modules.
test("with --isolate=modules, in the module graph of the file", async () => {
  const fixtures = [besideEachHooks("vitest", "bun:test"), besideEachHooks("bun:test", "vitest")];
  const { log, errors, exitCode } = await runTests(
    {
      ...inFiles(fixtures),
      // Bun disconnects a PerformanceObserver with the module graph it was made in: the one of its file.
      "2.test.js": `
        import { PerformanceObserver } from "node:perf_hooks";
        import { beforeEach, test } from "vitest";
        import { afterEach } from "bun:test";
        const observe = who => new PerformanceObserver(() => console.log("seen by an observer of", who)).observe({ entryTypes: ["mark"] });
        // The runner calls a function that a vitest hook returns with no async context of its own.
        beforeEach(() => () => observe("a function that a hook returned"));
        afterEach(() => {});
        test.concurrent("a", () => observe("a test"));
        test.concurrent("b", () => {});
      `,
      "3.test.js": `
        import { PerformanceObserver } from "node:perf_hooks";
        import { test } from "bun:test";
        test("the next file", async () => {
          const seen = Promise.withResolvers();
          new PerformanceObserver(() => { console.log("seen by an observer of the next file"); seen.resolve(); }).observe({ entryTypes: ["mark"] });
          performance.mark("in the next file");
          await seen.promise;
        });
      `,
      "4.test.js": failing("bun:test", "vitest"),
    },
    ["--isolate=modules"],
  );
  const failed = [["bun:test", "vitest"]] as const;
  expect({ log, errors }).toEqual({
    log: [
      ...fixtures.map(fixture => fixture.output),
      "seen by an observer of the next file",
      ...failuresOf("vitest", [...failed]).map(message => `the listener heard: ${message}`),
    ],
    errors: failuresOf("bun:test", [...failed]).map(message => `error: ${message}`),
  });
  expect(exitCode).toBe(1);
});
