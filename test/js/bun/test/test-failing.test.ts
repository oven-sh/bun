import { fail } from "assert";
import { $ } from "bun";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

const fixtureDir = path.join(import.meta.dir, "fixtures");
describe("test.failing", () => {
  it("is a function", () => {
    expect(test.failing).toBeFunction();
  });

  it("is an alias for it.failing", () => {
    expect(it.failing).toBe(test.failing);
  });

  it("requires a test function (unlike test.todo)", () => {
    // @ts-expect-error
    expect(() => test.failing("test name")).toThrow("test.failing expects a function as the second argument");
  });

  it("passes if an error is thrown or a promise rejects ", async () => {
    const result = await $.cwd(fixtureDir)`${bunExe()} test ./failing-test-fails.fixture.ts`.quiet();
    const stderr = result.stderr.toString();
    expect(stderr).toContain(" 2 pass\n");
  });

  it("fails if no error is thrown or promise resolves", async () => {
    const result = await $.cwd(
      fixtureDir,
    ).nothrow()`FORCE_COLOR=0 ${bunExe()} test ./failing-test-passes.fixture.ts`.quiet();
    const stderr = result.stderr.toString();
    if (result.exitCode === 0) {
      fail("Expected exit code to be non-zero\n\n" + stderr);
    }
    expect(stderr).toContain(" 2 fail\n");
    expect(stderr.replaceAll(/ \[[\d.]+m?s\]/g, "")).toMatchInlineSnapshot(`
      "
      failing-test-passes.fixture.ts:
      (fail) This should fail but it doesnt
        ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works
      (fail) This should fail but it doesnt (async)
        ^ this test is marked as failing but it passed. Remove \`.failing\` if tested behavior now works

       0 pass
       2 fail
       2 expect() calls
      Ran 2 tests across 1 file.
      "
    `);
  });

  it("timeouts still count as failures", async () => {
    const result = await $.cwd(fixtureDir).nothrow()`${bunExe()} test ./failing-test-timeout.fixture.ts`.quiet();
    const stderr = result.stderr.toString();
    if (result.exitCode === 0) {
      fail("Expected exit code to be non-zero\n\n" + stderr);
    }
    expect(stderr).toContain(" 0 pass\n");
    expect(stderr).toMatch(/timed out after \d+ms/i);
  });

  describe("when using a done() callback", () => {
    it("when a test throws, rejects, or passes an error to done(), the test passes", async () => {
      const result = await $.cwd(
        fixtureDir,
      ).nothrow()`${bunExe()} test ./failing-test-done-test-succeeds.fixture.ts`.quiet();
      const stderr = result.stderr.toString();
      try {
        expect(stderr).toContain("0 fail");
        expect(result.exitCode).toBe(0);
      } catch (e) {
        console.error(stderr);
        throw e;
      }
    });

    it("when the test doesn't throw, or otherwise fail, the test does not pass", async () => {
      const result = await $.cwd(
        fixtureDir,
      ).nothrow()`${bunExe()} test ./failing-test-done-test-fails.fixture.ts`.quiet();
      const stderr = result.stderr.toString();
      try {
        expect(stderr).toContain("0 pass");
        expect(result.exitCode).not.toBe(0);
      } catch (e) {
        console.error(stderr);
        throw e;
      }
    });
  });
});

const prelude = `
  import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from "bun:test";
  const later = (value, ms = 1) => new Promise(resolve => setTimeout(resolve, ms, value));
  const never = () => new Promise(() => {});
`;

/** Runs bun on the files and returns what it printed, without the durations. */
async function run(cmd: string[], files: Record<string, string>) {
  using dir = tempDir("test-failing", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    env: { ...bunEnv, CI: "false" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    stdout: stdout.split("\n").filter(line => line && !line.startsWith("bun test v")),
    stderr,
    results: stderr
      .split("\n")
      .filter(line => /^\((pass|fail|skip|todo)\)/.test(line))
      .map(line => line.replace(/ \[[\d.]+ms\]$/, "")),
    exitCode,
  };
}

const runTests = (source: string) => run(["test"], { "a.test.js": prelude + source });

/** The source line of a.test.js that each error's first stack frame points at. */
function failingLines(stderr: string, source: string) {
  const lines = (prelude + source).split("\n");
  return [...stderr.matchAll(/^error: .*\n(?:(?!\s+at ).*\n)*?\s+at .*a\.test\.js:(\d+):\d+\)?$/gm)].map(match =>
    lines[Number(match[1]) - 1].trim(),
  );
}

describe.concurrent("test.failing and test.fails", () => {
  /** What the run printed about failures: the result lines, then the errors by what tells them apart. */
  const failures = ({ results, stderr, exitCode }: Awaited<ReturnType<typeof run>>) => ({
    results,
    errors: stderr
      .split("\n")
      .filter(line => /^error: |^Expected: /.test(line))
      .toSorted(),
    betweenTests: stderr.split("# Unhandled error between tests").length - 1,
    exitCode,
  });
  const modifiers = ["failing", "fails"];

  test("don't take a matcher that other code calls", async () => {
    const result = await runTests(`
      expect.extend({ async toBeLater(received, expected) { return { pass: (await received) === expected, message: () => "a custom matcher" }; } });
      const wentOn = [];
      for (const modifier of ${JSON.stringify(modifiers)}) {
        const matchers = {
          ".resolves": settled => expect(settled).resolves.toBe(modifier + " .resolves"),
          ".rejects": settled => expect(settled.then(value => Promise.reject(value))).rejects.toBe(modifier + " .rejects"),
          "a custom matcher": settled => expect(settled).toBeLater("a custom matcher"),
          "toThrow()": settled => expect(() => settled).toThrow(),
          "expect.poll()": () => expect.poll(() => 1, { timeout: 5, interval: 1 }).toBe(modifier + " expect.poll()"),
          "expect.soft()": () => expect.soft(1).toBe(modifier + " expect.soft()"),
        };
        describe(modifier, () => {
          for (const [name, matcher] of Object.entries(matchers)) {
            describe(name, () => {
              const called = Promise.withResolvers(), settled = Promise.withResolvers();
              test("leaves a timer behind", () => {
                setTimeout(() => {
                  try {
                    matcher(settled.promise);
                    wentOn.push(name);
                  } finally {
                    called.resolve();
                  }
                }, 0);
              });
              test[modifier]("runs when the timer fires", async () => {
                await called.promise;
                settled.resolve(1);
              });
            });
          }
          describe("a promise callback", () => {
            const started = Promise.withResolvers(), called = Promise.withResolvers();
            test("is left behind", () => {
              started.promise.then(() => {
                expect(later(1)).resolves.toBe(modifier + " a promise callback");
                called.resolve();
              });
            });
            test[modifier]("runs it", async () => {
              started.resolve();
              await called.promise;
            });
          });
          describe("an immediate", () => {
            const called = Promise.withResolvers();
            test("is left behind", () => {
              setImmediate(() => {
                expect(later(1)).resolves.toBe(modifier + " an immediate");
                called.resolve();
              });
            });
            test[modifier]("runs meanwhile", () => called.promise);
          });
          describe("a body that goes on after its timeout", () => {
            const resumed = Promise.withResolvers(), called = Promise.withResolvers();
            test("times out", async () => {
              await resumed.promise;
              expect(later(1)).resolves.toBe(modifier + " a body that goes on after its timeout");
              called.resolve();
            }, 1);
            test[modifier]("runs meanwhile", async () => {
              resumed.resolve();
              await called.promise;
            });
          });
          describe("a server of a beforeAll hook", () => {
            let server;
            beforeAll(() => {
              server = Bun.serve({
                port: 0,
                fetch() {
                  expect(later(1)).resolves.toBe(modifier + " a server of a beforeAll hook");
                  return new Response();
                },
              });
            });
            afterAll(() => server.stop(true));
            test[modifier]("fetches it", async () => {
              await fetch(server.url);
            });
          });
          // A test.failing whose first attempt passes isn't retried.
          if (modifier === "fails") {
            describe("an earlier attempt", () => {
              const again = Promise.withResolvers(), called = Promise.withResolvers();
              let attempts = 0;
              test.fails("is retried", async () => {
                if (++attempts === 1) {
                  again.promise.then(() => {
                    expect(later(1)).resolves.toBe("fails an earlier attempt");
                    called.resolve();
                  });
                  return;
                }
                again.resolve();
                await called.promise;
              }, { retry: 1 });
            });
          }
        });
      }
      test("the code after each matcher", () => console.log(wentOn.join()));
    `);
    const matchers = [".resolves", ".rejects", "a custom matcher", "toThrow()", "expect.poll()", "expect.soft()"];
    // expect.soft() doesn't throw when the file takes its failure.
    expect(result.stdout).toEqual([[...matchers, ...matchers].join()]);
    expect(failures(result)).toEqual({
      results: [
        ...modifiers.flatMap(modifier => [
          ...matchers.flatMap(name => [
            `(pass) ${modifier} > ${name} > leaves a timer behind`,
            `(fail) ${modifier} > ${name} > runs when the timer fires`,
          ]),
          `(pass) ${modifier} > a promise callback > is left behind`,
          `(fail) ${modifier} > a promise callback > runs it`,
          `(pass) ${modifier} > an immediate > is left behind`,
          `(fail) ${modifier} > an immediate > runs meanwhile`,
          `(fail) ${modifier} > a body that goes on after its timeout > times out`,
          `(fail) ${modifier} > a body that goes on after its timeout > runs meanwhile`,
          `(fail) ${modifier} > a server of a beforeAll hook > fetches it`,
          ...(modifier === "fails" ? ["(fail) fails > an earlier attempt > is retried (attempt 2)"] : []),
        ]),
        "(pass) the code after each matcher",
      ],
      errors: [
        ...modifiers.flatMap(modifier => [
          `Expected: "${modifier} .rejects"`,
          `Expected: "${modifier} .resolves"`,
          `Expected: "${modifier} a body that goes on after its timeout"`,
          `Expected: "${modifier} a promise callback"`,
          `Expected: "${modifier} a server of a beforeAll hook"`,
          ...(modifier === "fails" ? ['Expected: "fails an earlier attempt"'] : []),
          `Expected: "${modifier} an immediate"`,
          `Expected: "${modifier} expect.poll()"`,
          `Expected: "${modifier} expect.soft()"`,
        ]),
        "error: Matcher did not succeed in time.",
        "error: Matcher did not succeed in time.",
        "error: a custom matcher",
        "error: a custom matcher",
        ...Array.from({ length: 17 }, () => "error: expect(received).toBe(expected)"),
        "error: expect(received).toThrow()",
        "error: expect(received).toThrow()",
      ],
      betweenTests: 21,
      exitCode: 1,
    });
  });

  test("take a matcher that their own code calls, also after an await", async () => {
    // This run never loads node:async_hooks, so nothing but the runner turns async context tracking on.
    const result = await runTests(`
      import { aroundAll, beforeEach } from "bun:test";
      import { EventEmitter } from "node:events";
      import fs from "node:fs";
      async function helper() {
        await later();
        expect(later(1)).resolves.toBe("in a helper");
      }
      // Each starts a callback of the test's own.
      const callbacks = {
        "setTimeout()": callback => void setTimeout(callback, 0),
        "setInterval()": callback => {
          const interval = setInterval(() => {
            clearInterval(interval);
            callback();
          }, 1);
        },
        "setImmediate()": callback => void setImmediate(callback),
        "process.nextTick()": callback => process.nextTick(callback),
        "queueMicrotask()": callback => queueMicrotask(callback),
        "a promise callback": callback => void later().then(callback),
        "fs.readFile()": callback => fs.readFile(import.meta.path, callback),
        "fs.promises.readFile()": callback => void fs.promises.readFile(import.meta.path).then(callback),
        "an event that it emits": callback => void later().then(() => new EventEmitter().once("event", callback).emit("event")),
        "a server that it starts": async callback => {
          await using server = Bun.serve({ port: 0, fetch: () => (callback(), new Response()) });
          await fetch(server.url);
        },
      };
      for (const modifier of ${JSON.stringify(modifiers)}) {
        describe(modifier, () => {
          test[modifier]("after an await", async () => {
            await later();
            expect(later(1)).resolves.toBe("after an await");
          });
          test[modifier]("in a helper that it awaits", async () => {
            await helper();
          });
          test[modifier]("in then() of a thenable that it returns", () => ({
            then(resolve) {
              expect(later(1)).resolves.toBe("in then()");
              resolve();
            },
          }));
          for (const [name, start] of Object.entries(callbacks)) {
            test[modifier]("in " + name, async () => {
              const called = Promise.withResolvers();
              await start(() => {
                expect(later(1)).resolves.toBe(name);
                called.resolve();
              });
              await called.promise;
            });
          }
          describe("in a timer of its beforeEach hook", () => {
            const called = Promise.withResolvers();
            beforeEach(() => {
              setTimeout(() => {
                expect(later(1)).resolves.toBe("in a timer of a hook");
                called.resolve();
              }, 0);
            });
            test[modifier]("test", () => called.promise);
          });
          describe("inside an aroundAll hook", () => {
            aroundAll(runSuite => runSuite());
            test[modifier]("test", async () => {
              await later();
              expect(later(1)).resolves.toBe("inside aroundAll");
            });
          });
          test[modifier]("expect.soft() after an await", async () => {
            await later();
            expect.soft(1).toBe("soft");
          });
          test[modifier]("expect.poll() after an await", async () => {
            await later();
            expect.poll(() => 1, { timeout: 5, interval: 1 }).toBe("poll");
          });
        });
      }
    `);
    expect(failures(result)).toEqual({
      results: modifiers.flatMap(modifier => [
        `(pass) ${modifier} > after an await`,
        `(pass) ${modifier} > in a helper that it awaits`,
        `(pass) ${modifier} > in then() of a thenable that it returns`,
        `(pass) ${modifier} > in setTimeout()`,
        `(pass) ${modifier} > in setInterval()`,
        `(pass) ${modifier} > in setImmediate()`,
        `(pass) ${modifier} > in process.nextTick()`,
        `(pass) ${modifier} > in queueMicrotask()`,
        `(pass) ${modifier} > in a promise callback`,
        `(pass) ${modifier} > in fs.readFile()`,
        `(pass) ${modifier} > in fs.promises.readFile()`,
        `(pass) ${modifier} > in an event that it emits`,
        `(pass) ${modifier} > in a server that it starts`,
        `(pass) ${modifier} > in a timer of its beforeEach hook > test`,
        `(pass) ${modifier} > inside an aroundAll hook > test`,
        `(pass) ${modifier} > expect.soft() after an await`,
        `(pass) ${modifier} > expect.poll() after an await`,
      ]),
      errors: [],
      betweenTests: 0,
      exitCode: 0,
    });
  });

  test("take a matcher that their own code calls, whatever async context it runs in", async () => {
    const result = await runTests(`
      import { AsyncLocalStorage } from "node:async_hooks";
      import { aroundEach, beforeEach } from "bun:test";
      const storage = new AsyncLocalStorage();
      const atTheTop = AsyncLocalStorage.snapshot();
      for (const modifier of ${JSON.stringify(modifiers)}) {
        describe(modifier, () => {
          test[modifier]("inside AsyncLocalStorage.run()", () =>
            storage.run("of the test", async () => {
              await later();
              console.log(modifier, "store", storage.getStore());
              expect(later(1)).resolves.toBe("inside run()");
            }));
          storage.run("of the registration", () => {
            test[modifier]("registered inside AsyncLocalStorage.run()", async () => {
              await later();
              console.log(modifier, "store", storage.getStore());
              expect(later(1)).resolves.toBe("registered inside run()");
            });
            // A hook's failure fails a test.failing.
            if (modifier === "fails") {
              describe("in an aroundEach hook that was", () => {
                aroundEach(async runTest => {
                  await later();
                  expect(later(1)).resolves.toBe("in an aroundEach hook");
                  await runTest();
                });
                test.fails("registered inside AsyncLocalStorage.run()", () => {});
              });
            }
          });
          // A hook's failure fails a test.failing.
          if (modifier === "fails") {
            describe("in then() of a thenable that its aroundEach hook returns", () => {
              aroundEach(runTest => ({
                then(resolve, reject) {
                  const hook = async () => {
                    await later();
                    expect(later(1)).resolves.toBe("in then() of a hook");
                    await runTest();
                  };
                  hook().then(resolve, reject);
                },
              }));
              test.fails("test", () => {});
            });
          }
          // The test calls these itself, so they are its own code whatever async context they run in.
          test[modifier]("in a function bound to the async context of the top of the file", () => {
            atTheTop(() => void expect(later(1)).resolves.toBe("bound at the top"));
          });
          describe("in a fake timer of an earlier test", () => {
            test("that starts it", () => {
              jest.useFakeTimers();
              setTimeout(() => void expect(Promise.resolve().then(() => 1)).resolves.toBe("fake timer"), 1000);
            });
            test[modifier]("that it advances", () => {
              jest.advanceTimersByTime(1000);
              jest.useRealTimers();
            });
          });
          // The store of enterWith() ends with the callback that entered it.
          describe("after enterWith()", () => {
            afterEach(() => console.log(modifier, "store in afterEach", storage.getStore()));
            test[modifier]("throws", () => {
              storage.enterWith("entered");
              throw new Error("expected");
            });
          });
          // disable() also takes the store from the callbacks that run after this one.
          const disabled = new AsyncLocalStorage();
          disabled.run("of the registration", () => {
            describe("after disable() in its beforeEach hook", () => {
              beforeEach(() => disabled.disable());
              test[modifier]("throws", () => {
                console.log(modifier, "store after disable()", disabled.getStore());
                throw new Error("expected");
              });
            });
          });
        });
      }
    `);
    expect(result.stdout).toEqual(
      modifiers.flatMap(modifier => [
        `${modifier} store of the test`,
        `${modifier} store of the registration`,
        `${modifier} store in afterEach undefined`,
        `${modifier} store after disable() undefined`,
      ]),
    );
    expect(failures(result)).toEqual({
      results: modifiers.flatMap(modifier => [
        `(pass) ${modifier} > inside AsyncLocalStorage.run()`,
        `(pass) ${modifier} > registered inside AsyncLocalStorage.run()`,
        ...(modifier === "fails"
          ? [
              "(pass) fails > in an aroundEach hook that was > registered inside AsyncLocalStorage.run()",
              "(pass) fails > in then() of a thenable that its aroundEach hook returns > test",
            ]
          : []),
        `(pass) ${modifier} > in a function bound to the async context of the top of the file`,
        `(pass) ${modifier} > in a fake timer of an earlier test > that starts it`,
        `(pass) ${modifier} > in a fake timer of an earlier test > that it advances`,
        `(pass) ${modifier} > after enterWith() > throws`,
        `(pass) ${modifier} > after disable() in its beforeEach hook > throws`,
      ]),
      errors: [],
      betweenTests: 0,
      exitCode: 0,
    });
  });

  /** A file with a matcher that leftover code calls and two that the tests call themselves, and how its run fails. */
  const bothKinds = {
    source: `
      import { AsyncLocalStorage } from "node:async_hooks";
      for (const modifier of ${JSON.stringify(modifiers)}) {
        describe(modifier, () => {
          const called = Promise.withResolvers();
          test("leaves a timer behind", () => {
            setTimeout(() => {
              expect(later(1)).resolves.toBe(modifier + " leftover");
              called.resolve();
            }, 0);
          });
          test[modifier]("runs when the timer fires", () => called.promise);
          test[modifier]("calls a matcher after an await", async () => {
            await later();
            expect(later(1)).resolves.toBe("its own");
          });
          new AsyncLocalStorage().run("store", () => {
            test[modifier]("calls one after an await, registered inside AsyncLocalStorage.run()", async () => {
              await later();
              expect(later(1)).resolves.toBe("its own");
            });
          });
        });
      }
    `,
    failures: {
      results: modifiers.flatMap(modifier => [
        `(pass) ${modifier} > leaves a timer behind`,
        `(fail) ${modifier} > runs when the timer fires`,
        `(pass) ${modifier} > calls a matcher after an await`,
        `(pass) ${modifier} > calls one after an await, registered inside AsyncLocalStorage.run()`,
      ]),
      errors: [
        'Expected: "failing leftover"',
        'Expected: "fails leftover"',
        "error: expect(received).toBe(expected)",
        "error: expect(received).toBe(expected)",
      ],
      betweenTests: 2,
      exitCode: 1,
    },
  };

  test("bun test --isolate: both hold", async () => {
    const result = await run(["test", "--isolate"], { "a.test.js": prelude + bothKinds.source });
    expect(failures(result)).toEqual(bothKinds.failures);
  });

  test('in a "vitest" file, don\'t take a matcher from the expect of a test that has ended', async () => {
    const result = await run(["test"], {
      "a.test.js": `
        import { test } from "vitest";
        const later = (value, ms = 1) => new Promise(resolve => setTimeout(resolve, ms, value));
        const called = Promise.withResolvers();
        test("leaves a timer behind", ({ expect }) => {
          setTimeout(() => {
            expect(later(1)).resolves.toBe("of an ended test");
            called.resolve();
          }, 0);
        });
        test.fails("runs when the timer fires", () => called.promise);
      `,
    });
    expect(failures(result)).toEqual({
      results: ["(pass) leaves a timer behind", "(fail) runs when the timer fires"],
      errors: ['Expected: "of an ended test"', "error: expect(received).toBe(expected)"],
      betweenTests: 1,
      exitCode: 1,
    });
  });

  test("don't take a matcher that code of such a test in an earlier file calls", async () => {
    const result = await run(["test", "./a.test.js", "./b.test.js"], {
      "a.test.js":
        prelude +
        `
        globalThis.started = Promise.withResolvers();
        globalThis.called = Promise.withResolvers();
        test.fails("leaves a promise callback behind", () => {
          globalThis.started.promise.then(() => {
            expect(later(1)).resolves.toBe("of an earlier file");
            globalThis.called.resolve();
          });
          throw new Error("expected");
        });
      `,
      "b.test.js":
        prelude +
        `
        test.fails("runs it", async () => {
          globalThis.started.resolve();
          await globalThis.called.promise;
        });
      `,
    });
    expect(failures(result)).toEqual({
      results: ["(pass) leaves a promise callback behind", "(fail) runs it"],
      errors: ['Expected: "of an earlier file"', "error: expect(received).toBe(expected)"],
      betweenTests: 1,
      exitCode: 1,
    });
  });

  test("a leftover matcher that never settles doesn't time a test.fails out, and the file gives up on it", async () => {
    const source = `
      const called = Promise.withResolvers();
      test("leaves a timer behind", () => {
        setTimeout(() => {
          expect(never()).resolves.toBe("never settles");
          called.resolve();
        }, 0);
      });
      test.fails("runs when the timer fires", () => called.promise);
    `;
    const result = await run(["test", "--timeout=250"], { "a.test.js": prelude + source });
    expect(failures(result)).toEqual({
      results: ["(pass) leaves a timer behind", "(fail) runs when the timer fires"],
      errors: [
        "error: An un-awaited matcher that the running test didn't call timed out 250ms after its file's tests finished because its promise never settled",
      ],
      betweenTests: 1,
      exitCode: 1,
    });
    expect(failingLines(result.stderr, source)).toEqual(['expect(never()).resolves.toBe("never settles");']);
  });

  // On its own: a debug build takes over a second longer to start with --isolate=modules, and longer beside other runs.
  test.serial("bun test --isolate=modules: both hold, and their fixtures run in the file's module graph", async () => {
    const result = await run(["test", "--isolate=modules", "./a.test.js", "./b.test.js"], {
      "a.test.js": prelude + bothKinds.source,
      "b.test.js": `
        import { test as base } from "vitest";
        const ofTheFile = Bun.ModuleGraph.current;
        const test = base.extend({
          async graph({}, use) {
            await use(Bun.ModuleGraph.current);
          },
        });
        test("a test", ({ graph }) => console.log("a test:", graph === ofTheFile));
        test.fails("a test that has to fail", ({ graph }) => {
          console.log("a test that has to fail:", graph === ofTheFile);
          throw new Error("expected");
        });
      `,
    });
    expect(result.stdout).toEqual(["a test: true", "a test that has to fail: true"]);
    expect(failures(result)).toEqual({
      ...bothKinds.failures,
      results: [...bothKinds.failures.results, "(pass) a test", "(pass) a test that has to fail"],
    });
  });

  test("a leftover matcher is still reported when the test that ran has failed as expected", async () => {
    const result = await runTests(`
      const matchers = {
        "not awaited": settled => void expect(settled).resolves.toBe("not awaited"),
        "awaited": async settled => void (await expect(settled).resolves.toBe("awaited")),
      };
      const settle = [];
      for (const [name, matcher] of Object.entries(matchers)) {
        describe(name, () => {
          const called = Promise.withResolvers(), settled = Promise.withResolvers();
          settle.push(settled.resolve);
          test("leaves a timer behind", () => {
            setTimeout(() => {
              matcher(settled.promise);
              called.resolve();
            }, 0);
          });
          test.failing("fails before the matcher does", async () => {
            await called.promise;
            throw new Error("expected");
          });
        });
      }
      describe("called while its afterEach hook runs", () => {
        const started = Promise.withResolvers(), called = Promise.withResolvers();
        test("leaves a promise callback behind", () => {
          started.promise.then(() => {
            expect(later(1)).resolves.toBe("while its afterEach hook runs");
            called.resolve();
          });
        });
        describe("the test", () => {
          afterEach(async () => {
            started.resolve();
            await called.promise;
          });
          test.failing("fails as expected", () => {
            throw new Error("expected");
          });
        });
      });
      // No test runs when the timer fires, so no test is blamed for the rejection of the leftover async function.
      test("the last test leaves the timer behind that settles them", () => {
        setTimeout(() => settle.forEach(resolve => resolve(1)), 0);
      });
    `);
    expect(failures(result)).toEqual({
      results: [
        "(pass) not awaited > leaves a timer behind",
        "(pass) not awaited > fails before the matcher does",
        "(pass) awaited > leaves a timer behind",
        "(pass) awaited > fails before the matcher does",
        "(pass) called while its afterEach hook runs > leaves a promise callback behind",
        "(pass) called while its afterEach hook runs > the test > fails as expected",
        "(pass) the last test leaves the timer behind that settles them",
      ],
      errors: [
        'Expected: "awaited"',
        'Expected: "not awaited"',
        'Expected: "while its afterEach hook runs"',
        "error: expect(received).toBe(expected)",
        "error: expect(received).toBe(expected)",
        "error: expect(received).toBe(expected)",
      ],
      betweenTests: 3,
      exitCode: 1,
    });
  });

  test("a leftover expect.poll() ends with the test that ran when it started", async () => {
    const result = await runTests(`
      describe("at its next attempt", () => {
        const called = Promise.withResolvers();
        let polls = 0;
        test("leaves a timer behind", () => {
          setTimeout(() => {
            expect.poll(() => ++polls, { timeout: 60_000, interval: 1 }).toBe("leftover poll");
            called.resolve();
          }, 0);
        });
        test.failing("runs when the timer fires", async () => {
          await called.promise;
          throw new Error("expected");
        });
        test("a later test", async () => {
          const before = polls;
          for (let i = 0; i < 5; i++) await later();
          console.log("polls during a later test:", polls - before);
        });
      });
      describe("or after the tests of the file, if that comes first", () => {
        const called = Promise.withResolvers();
        const slowly = { timeout: 120_000, interval: 60_000 };
        test("leaves a timer behind", () => {
          setTimeout(() => {
            expect.poll(() => 1, slowly).toBe("not awaited");
            (async () => await expect.poll(() => 1, slowly).toBe("awaited"))();
            called.resolve();
          }, 0);
        });
        test.failing("runs when the timer fires", async () => {
          await called.promise;
          throw new Error("expected");
        });
      });
    `);
    expect(result.stdout).toEqual(["polls during a later test: 0"]);
    expect(failures(result)).toEqual({
      results: [
        "(pass) at its next attempt > leaves a timer behind",
        "(pass) at its next attempt > runs when the timer fires",
        "(pass) at its next attempt > a later test",
        "(pass) or after the tests of the file, if that comes first > leaves a timer behind",
        "(pass) or after the tests of the file, if that comes first > runs when the timer fires",
      ],
      errors: [
        'Expected: "awaited"',
        'Expected: "leftover poll"',
        'Expected: "not awaited"',
        ...Array.from({ length: 3 }, () => "error: Matcher did not succeed in time."),
        ...Array.from({ length: 3 }, () => "error: expect(received).toBe(expected)"),
      ],
      betweenTests: 3,
      exitCode: 1,
    });
  });

  test("a leftover matcher counts once for expect.assertions() of the test that runs", async () => {
    const result = await runTests(`
      expect.extend({
        async toBeANumberLater(received) {
          expect(typeof received).toBe("number");
          await later();
          return { pass: true, message: () => "" };
        },
      });
      describe("that settles while the test runs", () => {
        const called = Promise.withResolvers(), settled = Promise.withResolvers();
        test("leaves a timer behind", () => {
          setTimeout(() => {
            expect(settled.promise).resolves.toBe(1);
            called.resolve();
          }, 0);
        });
        test.fails("has one assertion", async () => {
          expect.assertions(1);
          await called.promise;
          settled.resolve(1);
          await later();
        });
      });
      describe("that settles after the test", () => {
        const called = Promise.withResolvers();
        test("leaves a timer behind", () => {
          setTimeout(() => {
            expect(later(1, 5)).resolves.toBe(1);
            called.resolve();
          }, 0);
        });
        test.fails("has one assertion", async () => {
          expect.assertions(1);
          await called.promise;
        });
      });
      describe("that waits twice and calls expect() in between", () => {
        const done = Promise.withResolvers();
        test("leaves a timer behind", () => {
          setTimeout(() => void expect(later(1)).resolves.toBeANumberLater().then(done.resolve), 0);
        });
        test.fails("has two assertions", async () => {
          expect.assertions(2);
          await done.promise;
        });
      });
      // .resolves counts nothing for a promise that rejects.
      describe("that doesn't get as far as its count", () => {
        const done = Promise.withResolvers();
        test("leaves a timer behind", () => {
          setTimeout(() => void expect(later().then(() => Promise.reject(1))).resolves.toBe(1).catch(done.resolve), 0);
        });
        test.fails("has no assertion", async () => {
          expect.assertions(0);
          await done.promise;
        });
      });
    `);
    expect(failures(result)).toEqual({
      results: [
        "(pass) that settles while the test runs > leaves a timer behind",
        "(fail) that settles while the test runs > has one assertion",
        "(pass) that settles after the test > leaves a timer behind",
        "(fail) that settles after the test > has one assertion",
        "(pass) that waits twice and calls expect() in between > leaves a timer behind",
        "(fail) that waits twice and calls expect() in between > has two assertions",
        "(pass) that doesn't get as far as its count > leaves a timer behind",
        "(fail) that doesn't get as far as its count > has no assertion",
      ],
      errors: [],
      betweenTests: 0,
      exitCode: 1,
    });
    expect(result.stderr).toContain(" 4 expect() calls\n");
  });

  test("only their callbacks run in an async context of their own", async () => {
    const { stdout, exitCode } = await runTests(`
      import { heapStats } from "bun:jsc";
      const contexts = () => (Bun.gc(true), heapStats().objectTypeCounts.AsyncContextFrame ?? 0);
      // A timer keeps the async context that it was started in, if there is one.
      function contextsOfTimers() {
        const before = contexts();
        const timers = Array.from({ length: 50 }, () => setTimeout(() => {}, 60_000));
        const kept = contexts() - before;
        timers.forEach(clearTimeout);
        return kept;
      }
      test("a test", () => console.log("a test:", contextsOfTimers()));
      test.failing("a test that has to fail", () => {
        console.log("a test that has to fail:", contextsOfTimers());
        throw new Error("expected");
      });
      test("the test after it", () => console.log("the test after it:", contextsOfTimers()));
    `);
    expect(stdout).toEqual(["a test: 0", "a test that has to fail: 50", "the test after it: 0"]);
    expect(exitCode).toBe(0);
  });

  test("in a concurrent group, a waiting expect.soft() fails the test that called it", async () => {
    const { stdout, results, stderr, exitCode } = await runTests(`
      import { drainMicrotasks } from "bun:jsc";
      describe.concurrent("its promise settles on its own", () => {
        test("calls the matcher", async () => {
          await expect.soft(later(1)).resolves.toBe("soft");
          console.log("goes on");
        });
        test("beside it", () => later(0, 5));
      });
      describe.concurrent("another test settles its promise", () => {
        const settled = Promise.withResolvers();
        test("calls the matcher", async () => {
          await expect.soft(settled.promise).resolves.toBe("soft");
          console.log("goes on");
        });
        test.failing("settles it and runs the microtasks", async () => {
          settled.resolve(1);
          drainMicrotasks();
          await later();
        });
      });
    `);
    expect(stdout).toEqual(["goes on", "goes on"]);
    expect(results.toSorted()).toEqual([
      "(fail) another test settles its promise > calls the matcher",
      "(fail) another test settles its promise > settles it and runs the microtasks",
      "(fail) its promise settles on its own > calls the matcher",
      "(pass) its promise settles on its own > beside it",
    ]);
    expect(stderr).not.toContain("Unhandled error");
    expect(exitCode).toBe(1);
  });
});
