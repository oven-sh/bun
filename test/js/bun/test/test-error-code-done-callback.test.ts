import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import path from "path";

test("verify we print error messages passed to done callbacks", () => {
  const { stdout, stderr } = Bun.spawnSync({
    cmd: [bunExe(), "test", path.resolve(import.meta.dir, "test-error-done-callback-fixture.ts")],
    env: { ...bunEnv, BUN_JSC_showPrivateScriptsInStackTraces: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  let stdoutStr = stdout
    .toString()
    .replaceAll("\\", "/")
    .replaceAll(import.meta.dir.replaceAll("\\", "/"), "<dir>")
    .replace(/\d+(\.\d+)?ms/g, "<time>ms")
    .replace(/\d+(\.\d+)?s/g, "<time>s")
    .replaceAll(Bun.version_with_sha, "<version>")
    .replaceAll("[<time>s]", "")
    .replaceAll("[<time>ms]", "")
    .split("\n")
    .map(line => line.trim())
    .join("\n");
  let stderrStr = stderr
    .toString()
    .replaceAll("\\", "/")
    .replaceAll(import.meta.dir.replaceAll("\\", "/"), "<dir>")
    .replace(/\d+(\.\d+)?ms/g, "<time>ms")
    .replace(/\d+(\.\d+)?s/g, "<time>s")
    .replaceAll(Bun.version_with_sha, "<version>")
    .replaceAll("[<time>s]", "")
    .replaceAll("[<time>ms]", "")
    .split("\n")
    .map(line => line.trim())
    .join("\n");

  expect(stdoutStr).toMatchInlineSnapshot(`
    "bun test <version>
    "
  `);
  expect(stderrStr).toMatchInlineSnapshot(`
    "
    test/js/bun/test/test-error-done-callback-fixture.ts:
    22 |   105,
    23 |   115,
    24 | );
    25 |
    26 | test("error done callback (sync)", done => {
    27 |   done(new Error(msg + "(sync)"));
    ^
    error: you should see this(sync)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:27:12)
    (fail) error done callback (sync)
    27 |   done(new Error(msg + "(sync)"));
    28 | });
    29 |
    30 | test("error done callback (async with await)", async done => {
    31 |   await 1;
    32 |   done(new Error(msg + "(async with await)"));
    ^
    error: you should see this(async with await)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:32:12)
    (fail) error done callback (async with await)
    32 |   done(new Error(msg + "(async with await)"));
    33 | });
    34 |
    35 | test("error done callback (async with Bun.sleep)", async done => {
    36 |   await Bun.sleep(0);
    37 |   done(new Error(msg + "(async with Bun.sleep)"));
    ^
    error: you should see this(async with Bun.sleep)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:37:12)
    (fail) error done callback (async with Bun.sleep)
    37 |   done(new Error(msg + "(async with Bun.sleep)"));
    38 | });
    39 |
    40 | test("error done callback (async)", done => {
    41 |   Promise.resolve().then(() => {
    42 |     done(new Error(msg + "(async)"));
    ^
    error: you should see this(async)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:42:14)
    (fail) error done callback (async)
    43 |   });
    44 | });
    45 |
    46 | test("error done callback (async, setTimeout)", done => {
    47 |   setTimeout(() => {
    48 |     done(new Error(msg + "(async, setTimeout)"));
    ^
    error: you should see this(async, setTimeout)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:48:14)
    (fail) error done callback (async, setTimeout)
    49 |   }, 0);
    50 | });
    51 |
    52 | test("error done callback (async, setImmediate)", done => {
    53 |   setImmediate(() => {
    54 |     done(new Error(msg + "(async, setImmediate)"));
    ^
    error: you should see this(async, setImmediate)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:54:14)
    (fail) error done callback (async, setImmediate)
    55 |   });
    56 | });
    57 |
    58 | test("error done callback (async, nextTick)", done => {
    59 |   process.nextTick(() => {
    60 |     done(new Error(msg + "(async, nextTick)"));
    ^
    error: you should see this(async, nextTick)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:60:14)
    (fail) error done callback (async, nextTick)
    62 | });
    63 |
    64 | test("error done callback (async, setTimeout, Promise.resolve)", done => {
    65 |   setTimeout(() => {
    66 |     Promise.resolve().then(() => {
    67 |       done(new Error(msg + "(async, setTimeout, Promise.resolve)"));
    ^
    error: you should see this(async, setTimeout, Promise.resolve)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:67:16)
    (fail) error done callback (async, setTimeout, Promise.resolve)
    70 | });
    71 |
    72 | test("error done callback (async, setImmediate, Promise.resolve)", done => {
    73 |   setImmediate(() => {
    74 |     Promise.resolve().then(() => {
    75 |       done(new Error(msg + "(async, setImmediate, Promise.resolve)"));
    ^
    error: you should see this(async, setImmediate, Promise.resolve)
    at <anonymous> (<dir>/test-error-done-callback-fixture.ts:75:16)
    (fail) error done callback (async, setImmediate, Promise.resolve)

    0 pass
    9 fail
    Ran 9 tests across 1 file.
    "
  `);
});

// Only the lines that show what each error was attributed to, which entries timed out, and the totals.
function resultLines(stderr: string) {
  return normalizeBunSnapshot(stderr)
    .split("\n")
    .map(line => line.trim().replace(/^\^ (this test|a beforeEach\/afterEach hook) timed out.*/, "^ timed out"))
    .filter(line =>
      /^(\((pass|fail|todo)\) |error: |# Unhandled error|\^ timed out$|\d+ (pass|fail|todo|errors?)$)/.test(line),
    )
    .join("\n");
}

// `files` is the source of one test file, or several test files that run in the order of their names.
async function runFixture(files: string | Record<string, string>, args: string[] = []) {
  using dir = tempDir("done-err", typeof files === "string" ? { "done-err.test.ts": files } : files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: normalizeBunSnapshot(stdout), results: resultLines(stderr), exitCode };
}

describe("done(err) fails the test whose done() received it", () => {
  // `suffix` is "" or ".concurrent". Every case but the last one completes while it is started,
  // so serial and concurrent runs report in the same order.
  const fixture = (suffix: string) => `
    import { it } from "bun:test";

    it${suffix}("sync done(err)", done => {
      done(new Error("sync boom"));
    });
    it${suffix}("microtask done(err)", async done => {
      await 1;
      done(new Error("microtask boom"));
    });
    it${suffix}("done() without an error", done => {
      done();
    });
    it${suffix}.failing("failing test whose done() receives an error", done => {
      done(new Error("expected boom"));
    });
    it${suffix}.todo("todo test whose done() receives an error", done => {
      done(new Error("todo boom"));
    });
    const graph = new Bun.ModuleGraph({ onError: error => console.log("the graph's onError got: " + error.message) });
    it${suffix}("done(err) inside the run() of a Bun.ModuleGraph", done => {
      graph.run(() => done(new Error("graph boom")));
    });
    it${suffix}("macrotask done(err)", done => {
      setTimeout(() => done(new Error("macrotask boom")), 1);
    });
  `;

  // `--todo` runs the body of the todo test.
  test.concurrent.each([
    { name: "serial", suffix: "", args: ["--todo"] },
    { name: "bun test --concurrent", suffix: "", args: ["--todo", "--concurrent"] },
    { name: "it.concurrent", suffix: ".concurrent", args: ["--todo"] },
  ])("$name", async ({ suffix, args }) => {
    expect(await runFixture(fixture(suffix), args)).toEqual({
      exitCode: 1,
      stdout: "bun test <version> (<revision>)",
      results: [
        "error: sync boom",
        "(fail) sync done(err)",
        "error: microtask boom",
        "(fail) microtask done(err)",
        "(pass) done() without an error",
        "(pass) failing test whose done() receives an error",
        "error: todo boom",
        "(todo) todo test whose done() receives an error",
        "error: graph boom",
        "(fail) done(err) inside the run() of a Bun.ModuleGraph",
        "error: macrotask boom",
        "(fail) macrotask done(err)",
        "2 pass",
        "1 todo",
        "4 fail",
      ].join("\n"),
    });
  });

  // Each attempt queues the completion of its done(err), and an async function queues the
  // completion of its promise as well. Neither one may end the next attempt, which fails again.
  test.concurrent("every attempt of a retried test in a concurrent group", async () => {
    const run = await runFixture(`
      import { it } from "bun:test";
      it.concurrent("from a callback", done => {
        setImmediate(() => done(new Error("callback boom")));
      }, { retry: 1 });
      it.concurrent("from an async function", async done => {
        await new Promise(resolve => setImmediate(resolve));
        done(new Error("async boom"));
      }, { retry: 1 });
      it.concurrent("passes", () => {});
    `);
    expect(run).toEqual({
      exitCode: 1,
      stdout: "bun test <version> (<revision>)",
      results: [
        "(pass) passes",
        "error: callback boom",
        "error: async boom",
        "error: callback boom",
        "error: async boom",
        "(fail) from a callback (attempt 2)",
        "(fail) from an async function (attempt 2)",
        "1 pass",
        "2 fail",
      ].join("\n"),
    });
  });

  // done(err) is called before the callback returns its promise, which only the second test
  // settles. done(err) ends the first test without the promise, as it does once the callback has
  // returned. The first test is past its timeout by then, and that must not make it a timeout.
  test.concurrent("at once, when the promise its callback returns is still pending", async () => {
    const run = await runFixture(`
      import { it, describe } from "bun:test";
      for (const [name, test] of [["it", it], ["it.concurrent", it.concurrent]]) {
        for (const [mode, first] of [["", test], [".failing", test.failing]]) {
          describe(name + mode, () => {
            const settledBySecond = Promise.withResolvers();
            first("first", done => {
              done(new Error("boom"));
              Bun.sleepSync(20);
              return settledBySecond.promise;
            }, 10);
            test("second", () => {
              settledBySecond.resolve();
            });
          });
        }
      }
    `);
    expect(run).toEqual({
      exitCode: 1,
      stdout: "bun test <version> (<revision>)",
      results: [
        "error: boom",
        "(fail) it > first",
        "(pass) it > second",
        "(pass) it.failing > first",
        "(pass) it.failing > second",
        "error: boom",
        "(pass) it.concurrent > second",
        "(pass) it.concurrent.failing > second",
        "(fail) it.concurrent > first",
        "(pass) it.concurrent.failing > first",
        "6 pass",
        "2 fail",
      ].join("\n"),
    });
  });

  // toThrow() of a function that returns a pending promise runs the event loop until the promise
  // settles, with the VM's unhandled-error handler replaced by one that reports nothing. Each
  // done(err) is called inside that wait, and the wait ends only after it.
  test.concurrent("when it is called while toThrow() waits on a promise", async () => {
    const run = await runFixture(`
      import { it, describe, expect } from "bun:test";
      function waitInToThrow(until) {
        expect(async () => {
          await until;
          throw new Error("thrown");
        }).toThrow("thrown");
      }
      function lateDone(message) {
        const fired = Promise.withResolvers();
        return {
          fired: fired.promise,
          fire: done =>
            setImmediate(() => {
              done(new Error(message));
              fired.resolve();
            }),
        };
      }
      describe("during its own toThrow() wait", () => {
        const late = lateDone("own boom");
        it("fails", done => {
          late.fire(done);
          waitInToThrow(late.fired);
        });
      });
      describe.concurrent("during a sibling's toThrow() wait", () => {
        const late = lateDone("sibling boom");
        it("fails", done => {
          late.fire(done);
        });
        it("waits", () => {
          waitInToThrow(late.fired);
        });
      });
      describe("inside the function given to toThrow()", () => {
        it("fails, and is not what the function threw", done => {
          expect(() => {
            done(new Error("inside boom"));
          }).not.toThrow();
        });
      });
    `);
    expect(run).toEqual({
      exitCode: 1,
      stdout: "bun test <version> (<revision>)",
      results: [
        "error: own boom",
        "(fail) during its own toThrow() wait > fails",
        "error: sibling boom",
        "(pass) during a sibling's toThrow() wait > waits",
        "(fail) during a sibling's toThrow() wait > fails",
        "error: inside boom",
        "(fail) inside the function given to toThrow() > fails, and is not what the function threw",
        "1 pass",
        "3 fail",
      ].join("\n"),
    });
  });

  // Each "stale" test is already over (timed out, or its body threw before the runner took
  // charge of its pending done) when its done(err) fires during the test after it.
  test.concurrent("but not the test that runs when a late done(err) arrives", async () => {
    const run = await runFixture(`
      import { it, describe } from "bun:test";
      function lateDone(schedule) {
        const fired = Promise.withResolvers();
        return {
          fired: fired.promise,
          fireLater: done =>
            schedule(() => {
              done(new Error("late boom"));
              fired.resolve();
            }),
        };
      }
      describe("its test timed out", () => {
        const late = lateDone(fn => setTimeout(fn, 20));
        it("stale", done => { late.fireLater(done); }, 1);
        it("is running when the late done(err) arrives", async () => { await late.fired; });
      });
      describe("its test threw after scheduling it on a macrotask", () => {
        const late = lateDone(setImmediate);
        it("stale", done => { late.fireLater(done); throw new Error("thrown boom"); });
        it("is running when the late done(err) arrives", async () => { await late.fired; });
      });
      describe("its test threw after scheduling it on a microtask", () => {
        const late = lateDone(queueMicrotask);
        it("stale", done => { late.fireLater(done); throw new Error("thrown boom"); });
        it("is running when the late done(err) arrives", async () => { await late.fired; });
      });
    `);
    expect(run).toEqual({
      exitCode: 1,
      stdout: "bun test <version> (<revision>)",
      results: [
        "(fail) its test timed out > stale",
        "^ timed out",
        "# Unhandled error between tests",
        "error: late boom",
        "(pass) its test timed out > is running when the late done(err) arrives",
        "error: thrown boom",
        "(fail) its test threw after scheduling it on a macrotask > stale",
        "# Unhandled error between tests",
        "error: late boom",
        "(pass) its test threw after scheduling it on a macrotask > is running when the late done(err) arrives",
        "error: thrown boom",
        "(fail) its test threw after scheduling it on a microtask > stale",
        "# Unhandled error between tests",
        "error: late boom",
        "(pass) its test threw after scheduling it on a microtask > is running when the late done(err) arrives",
        "3 pass",
        "3 fail",
        "3 errors",
      ].join("\n"),
    });
  });

  // Attempt 1 of each test times out and fails once the retry runs. The retry reported that
  // failure already: a late done(err) or rejection of attempt 1 is not an error of the run.
  test.concurrent("and not the retry of a timed-out attempt whose done(err) or rejection arrives late", async () => {
    const run = await runFixture(`
      import { it } from "bun:test";
      const first = Promise.withResolvers();
      let rejectAttempt = 0;
      it("rejects late", async () => {
        rejectAttempt++;
        if (rejectAttempt === 1) {
          await first.promise;
          throw new Error("late rejection");
        }
        first.resolve();
        await new Promise(resolve => setImmediate(resolve));
      }, { retry: 1, timeout: 50 });

      let firstDone;
      let doneAttempt = 0;
      it("calls done(err) late", done => {
        doneAttempt++;
        if (doneAttempt === 1) {
          firstDone = done;
          return;
        }
        firstDone(new Error("late done boom"));
        setImmediate(() => done());
      }, { retry: 1, timeout: 50 });
    `);
    expect(run).toEqual({
      exitCode: 0,
      stdout: "bun test <version> (<revision>)",
      results: ["(pass) rejects late (attempt 2)", "(pass) calls done(err) late (attempt 2)", "2 pass", "0 fail"].join(
        "\n",
      ),
    });
  });

  // The test of the first file ends when it throws, so nothing there calls its done(). A test of
  // the second file calls it. The entry it names is gone with the first file: the error is
  // reported, and the test that called it is not failed or ended early.
  test.concurrent("and no test of the next file, when that file calls the done of a finished file", async () => {
    const run = await runFixture({
      "1-first.test.ts": `
        import { it } from "bun:test";
        it("leaves its done uncalled", done => {
          globalThis.doneOfFirstFile = done;
          throw new Error("thrown boom");
        });
      `,
      "2-second.test.ts": `
        import { it } from "bun:test";
        it("calls the done of the first file", async () => {
          globalThis.doneOfFirstFile(new Error("late boom"));
          await new Promise(resolve => setImmediate(resolve));
          console.log("still running after the call");
        });
        it("runs after it", () => {});
      `,
    });
    expect(run).toEqual({
      exitCode: 1,
      stdout: "bun test <version> (<revision>)\nstill running after the call",
      results: [
        "error: thrown boom",
        "(fail) leaves its done uncalled",
        "# Unhandled error between tests",
        "error: late boom",
        "(pass) calls the done of the first file",
        "(pass) runs after it",
        "2 pass",
        "1 fail",
        "1 error",
      ].join("\n"),
    });
  });

  // The second file calls it while its own tests are still being collected. The error must not
  // fail the scope under collection: the tests of the second file still run.
  test.concurrent("and no describe of the next file, when that file calls it while it collects its tests", async () => {
    const run = await runFixture({
      "1-first.test.ts": `
        import { it } from "bun:test";
        it("leaves its done uncalled", done => {
          globalThis.doneOfFirstFile = done;
          throw new Error("thrown boom");
        });
      `,
      "2-second.test.ts": `
        import { it, describe } from "bun:test";
        describe("collected after the call", () => {
          globalThis.doneOfFirstFile(new Error("late boom"));
          it("runs", () => {});
        });
      `,
    });
    expect(run).toEqual({
      exitCode: 1,
      stdout: "bun test <version> (<revision>)",
      results: [
        "error: thrown boom",
        "(fail) leaves its done uncalled",
        "# Unhandled error between tests",
        "error: late boom",
        "(pass) collected after the call > runs",
        "1 pass",
        "1 fail",
        "1 error",
      ].join("\n"),
    });
  });
});

describe("done(err) fails the hook whose done() received it", () => {
  // `suffix` is "" or ".concurrent". The beforeAll case goes last so that the tests it skips
  // cannot include any of the other cases.
  const fixture = (suffix: string) => `
    import { it, describe, beforeAll, beforeEach, afterEach, afterAll } from "bun:test";

    describe${suffix}("beforeEach", () => {
      beforeEach(done => {
        done(new Error("beforeEach boom"));
      });
      it("body is skipped", () => {
        console.log("beforeEach > body ran");
      });
    });
    describe${suffix}("afterEach", () => {
      afterEach(async done => {
        await 1;
        done(new Error("afterEach boom"));
      });
      it("test fails", () => {
        console.log("afterEach > body ran");
      });
    });
    describe${suffix}("afterAll", () => {
      afterAll(async done => {
        await 1;
        done(new Error("afterAll boom"));
      });
      it("test passes", () => {
        console.log("afterAll > body ran");
      });
    });
    describe${suffix}("beforeAll", () => {
      beforeAll(done => {
        done(new Error("beforeAll boom"));
      });
      it("body is skipped", () => {
        console.log("beforeAll > body ran");
      });
    });
  `;

  test.concurrent.each([
    { name: "serial", suffix: "", args: [] },
    { name: "bun test --concurrent", suffix: "", args: ["--concurrent"] },
    { name: "describe.concurrent", suffix: ".concurrent", args: [] },
  ])("$name", async ({ suffix, args }) => {
    expect(await runFixture(fixture(suffix), args)).toEqual({
      exitCode: 1,
      stdout: "bun test <version> (<revision>)\nafterEach > body ran\nafterAll > body ran",
      results: [
        "error: beforeEach boom",
        "(fail) beforeEach > body is skipped",
        "error: afterEach boom",
        "(fail) afterEach > test fails",
        "(pass) afterAll > test passes",
        "error: afterAll boom",
        "(fail) afterAll > (unnamed)",
        "error: beforeAll boom",
        "(fail) beforeAll > (unnamed)",
        "1 pass",
        "4 fail",
      ].join("\n"),
    });
  });

  // A hook that a test registers while it runs, and a hook of a preload file.
  test.concurrent("a hook that a running test or a preload file registers", async () => {
    const run = await runFixture(
      {
        "preload.ts": `
          import { beforeEach } from "bun:test";
          beforeEach(done => {
            if (globalThis.failPreloadHook) done(new Error("preload boom"));
            else done();
          });
        `,
        "done-err.test.ts": `
          import { it, afterEach, onTestFinished } from "bun:test";
          it("onTestFinished, from the hook itself", () => {
            onTestFinished(done => {
              done(new Error("finished boom"));
            });
            onTestFinished(() => {
              console.log("the hook after the failed one ran");
            });
          });
          it("onTestFinished, from a macrotask", () => {
            onTestFinished(done => {
              setImmediate(() => done(new Error("late finished boom")));
            });
          });
          it("afterEach that the test registers", () => {
            afterEach(done => {
              done(new Error("registered boom"));
            });
          });
          it("onTestFinished that calls done()", () => {
            onTestFinished(done => {
              done();
            });
            globalThis.failPreloadHook = true;
          });
          it("the beforeEach of the preload file", () => {
            console.log("body ran after the preload hook failed");
          });
        `,
      },
      ["--preload", "./preload.ts"],
    );
    expect(run).toEqual({
      exitCode: 1,
      stdout: "bun test <version> (<revision>)",
      results: [
        "error: finished boom",
        "(fail) onTestFinished, from the hook itself",
        "error: late finished boom",
        "(fail) onTestFinished, from a macrotask",
        "error: registered boom",
        "(fail) afterEach that the test registers",
        "(pass) onTestFinished that calls done()",
        "error: preload boom",
        "(fail) the beforeEach of the preload file",
        "1 pass",
        "4 fail",
      ].join("\n"),
    });
  });

  // As for a test: done(err) ends the hook without the promise its callback returns, and a hook
  // that is past its timeout by then is not a timeout.
  test.concurrent("at once, when the promise its callback returns is still pending", async () => {
    const run = await runFixture(`
      import { it, describe, beforeEach, afterEach } from "bun:test";
      describe("beforeEach", () => {
        beforeEach(done => {
          done(new Error("beforeEach boom"));
          Bun.sleepSync(20);
          return new Promise(() => {});
        }, 10);
        it("body is skipped", () => {
          console.log("beforeEach > body ran");
        });
      });
      describe("afterEach", () => {
        afterEach(done => {
          done(new Error("afterEach boom"));
          Bun.sleepSync(20);
          return new Promise(() => {});
        }, 10);
        it("test fails", () => {});
      });
    `);
    expect(run).toEqual({
      exitCode: 1,
      stdout: "bun test <version> (<revision>)",
      results: [
        "error: beforeEach boom",
        "(fail) beforeEach > body is skipped",
        "error: afterEach boom",
        "(fail) afterEach > test fails",
        "0 pass",
        "2 fail",
      ].join("\n"),
    });
  });

  // The test is retried, and the hook fails the second attempt as well.
  test.concurrent("in every attempt of a retried test", async () => {
    const run = await runFixture(`
      import { it, describe, beforeEach } from "bun:test";
      describe("from a callback", () => {
        beforeEach(done => {
          setImmediate(() => done(new Error("callback boom")));
        });
        it("retried", () => {}, { retry: 1 });
      });
      describe("from an async function", () => {
        beforeEach(async done => {
          await new Promise(resolve => setImmediate(resolve));
          done(new Error("async boom"));
        });
        it("retried", () => {}, { retry: 1 });
      });
    `);
    expect(run).toEqual({
      exitCode: 1,
      stdout: "bun test <version> (<revision>)",
      results: [
        "error: callback boom",
        "error: callback boom",
        "(fail) from a callback > retried (attempt 2)",
        "error: async boom",
        "error: async boom",
        "(fail) from an async function > retried (attempt 2)",
        "0 pass",
        "2 fail",
      ].join("\n"),
    });
  });

  // As for a test: the hook's done(err) is called inside the toThrow() wait of another test.
  test.concurrent("when it is called while toThrow() waits on a promise", async () => {
    const run = await runFixture(`
      import { it, describe, expect, beforeEach } from "bun:test";
      const fired = Promise.withResolvers();
      describe.concurrent("group", () => {
        describe("hooked", () => {
          beforeEach(done => {
            setImmediate(() => {
              done(new Error("hook boom"));
              fired.resolve();
            });
          });
          it("fails", () => {});
        });
        it("waits", () => {
          expect(async () => {
            await fired.promise;
            throw new Error("thrown");
          }).toThrow("thrown");
        });
      });
    `);
    expect(run).toEqual({
      exitCode: 1,
      stdout: "bun test <version> (<revision>)",
      results: ["error: hook boom", "(pass) group > waits", "(fail) group > hooked > fails", "1 pass", "1 fail"].join(
        "\n",
      ),
    });
  });
});
