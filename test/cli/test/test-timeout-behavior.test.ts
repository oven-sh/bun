import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isFlaky, isLinux, normalizeBunSnapshot, tempDir } from "harness";
import path from "path";

if (isFlaky && isLinux) {
  test.todo("processes get killed");
} else {
  test.concurrent.each([true, false])(`processes get killed (sync: %p)`, async sync => {
    const { exited, stdout, stderr } = Bun.spawn({
      cmd: [
        bunExe(),
        "test",
        path.join(import.meta.dir, sync ? "process-kill-fixture-sync.ts" : "process-kill-fixture.ts"),
      ],
      stdout: "pipe",
      stderr: "pipe",
      stdin: "inherit",
      env: bunEnv,
    });
    const [out, err, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
    // merge outputs so that this test still works if we change which things are printed to stdout
    // and which to stderr
    const combined = out + err;
    // exit code should indicate failed tests, not abort or anything
    expect(exitCode).toBe(1);
    expect(combined).not.toContain("This should not be printed!");
    expect(combined).toContain("killed 1 dangling process");
    // we should not expose the termination exception
    expect(combined).not.toContain("Unhandled error between tests");
    expect(combined).not.toContain("JavaScript execution terminated");
    // both tests should have run with the expected result
    expect(combined).toContain("(fail) test timeout kills dangling processes");
    expect(combined).toContain("(pass) slow test after test timeout");
  });
}

// .resolves / .rejects, toThrow() on an async function and async expect.extend matchers block
// inside the matcher, ticking the event loop until their promise settles. The per-test timeout
// cannot interrupt that the way it interrupts an awaiting test, so the matcher has to give up on
// its own once the test it runs in has timed out; otherwise a promise that never settles hangs the
// whole `bun test` run at 100% CPU instead of failing the test.
describe("a matcher blocked on a promise that never settles fails with the test timeout", () => {
  // Every hanging test costs this much wall clock. The outputs below come out the same however
  // slowly a fixture gets to its matcher, except where noted.
  const TIMEOUT_MS = 200;
  // soon() is pending when a matcher starts waiting for it and settles on a later turn of the event
  // loop. A timer rather than setImmediate: immediates queued alongside the one a matcher is blocked
  // in are not run until that matcher returns.
  const prelude = `
    import { describe, expect, test, beforeEach } from "bun:test";
    const never = () => new Promise(() => {});
    const soon = () => new Promise(resolve => setTimeout(resolve, 0, "settled"));
    const timeout = ${TIMEOUT_MS};
  `;

  async function runTestFile(source: string, env: Record<string, string | undefined> = bunEnv) {
    using dir = tempDir("blocked-matcher", { "blocked.test.ts": prelude + source });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./blocked.test.ts"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      exitCode,
      stdout: normalizeBunSnapshot(stdout, String(dir)),
      // Debug builds report one more stack frame than release builds for errors thrown inside async
      // test bodies; the code frame above each error already says where it was thrown.
      stderr: normalizeBunSnapshot(stderr, String(dir)).replace(/\n\s+at .*\(file:NN:NN\)/g, ""),
    };
  }

  // Each blocked test below is sequential on purpose: when a matcher does hang, the runner's own
  // timeout of the test in this file is what kills the hung `bun test` child.
  test("reached from the test body", async () => {
    const result = await runTestFile(`
      expect.extend({ toSettle() { return never(); } });

      // The shape from #14950: the promise can only settle after the matcher returns.
      test("resolved after the matcher call", () => {
        let resolve;
        expect(new Promise(r => (resolve = r))).resolves.toBe(25);
        console.log("unreachable: resolve(25)");
        resolve(25);
      }, { timeout });
      test("resolves", async () => {
        await expect(never()).resolves.toBe("settled");
        console.log("unreachable: resolves");
      }, { timeout });
      test("rejects", async () => {
        await expect(never()).rejects.toThrow();
        console.log("unreachable: rejects");
      }, { timeout });
      test("toThrow on an async function", () => {
        expect(async () => { await never(); }).toThrow();
        console.log("unreachable: toThrow");
      }, { timeout });
      test("async custom matcher", () => {
        expect(1).toSettle();
        console.log("unreachable: custom matcher");
      }, { timeout });
      test("asymmetric resolvesTo", () => {
        expect(never()).toEqual(expect.resolvesTo.anything());
        console.log("unreachable: resolvesTo");
      }, { timeout });
      // Roomier timeout: the inner matcher is reached through a timer that has to fire first.
      test("nested inside the test's own blocked matcher", async () => {
        const outer = new Promise(resolve => setTimeout(() => {
          expect(never()).resolves.toBe("settled");
          console.log("unreachable: inner matcher");
          resolve("settled");
        }, 0));
        await expect(outer).resolves.toBe("settled");
        console.log("unreachable: outer matcher");
      }, { timeout: timeout * 5 });
      test("the next test runs", async () => {
        await expect(soon()).resolves.toBe("settled");
      });
    `);
    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "stderr": 
      "blocked.test.ts:
       7 |       expect.extend({ toSettle() { return never(); } });
       8 | 
       9 |       // The shape from #14950: the promise can only settle after the matcher returns.
      10 |       test("resolved after the matcher call", () => {
      11 |         let resolve;
      12 |         expect(new Promise(r => (resolve = r))).resolves.toBe(25);
                                                                    ^
      error: expect(received).resolves.toBe(expected)

      Expected promise that resolves
      Received promise that was still pending when the test timed out: Promise { <pending> }
      (fail) resolved after the matcher call
        ^ this test timed out after 200ms.
      12 |         expect(new Promise(r => (resolve = r))).resolves.toBe(25);
      13 |         console.log("unreachable: resolve(25)");
      14 |         resolve(25);
      15 |       }, { timeout });
      16 |       test("resolves", async () => {
      17 |         await expect(never()).resolves.toBe("settled");
                                                  ^
      error: expect(received).resolves.toBe(expected)

      Expected promise that resolves
      Received promise that was still pending when the test timed out: Promise { <pending> }
      (fail) resolves
        ^ this test timed out after 200ms.
      16 |       test("resolves", async () => {
      17 |         await expect(never()).resolves.toBe("settled");
      18 |         console.log("unreachable: resolves");
      19 |       }, { timeout });
      20 |       test("rejects", async () => {
      21 |         await expect(never()).rejects.toThrow();
                                                 ^
      error: expect(received).rejects.toThrow(expected)

      Expected promise that rejects
      Received promise that was still pending when the test timed out: Promise { <pending> }
      (fail) rejects
        ^ this test timed out after 200ms.
      20 |       test("rejects", async () => {
      21 |         await expect(never()).rejects.toThrow();
      22 |         console.log("unreachable: rejects");
      23 |       }, { timeout });
      24 |       test("toThrow on an async function", () => {
      25 |         expect(async () => { await never(); }).toThrow();
                                                          ^
      error: Received function returned a promise that was still pending when the test timed out
      (fail) toThrow on an async function
        ^ this test timed out after 200ms.
      24 |       test("toThrow on an async function", () => {
      25 |         expect(async () => { await never(); }).toThrow();
      26 |         console.log("unreachable: toThrow");
      27 |       }, { timeout });
      28 |       test("async custom matcher", () => {
      29 |         expect(1).toSettle();
                             ^
      error: Matcher \`toSettle\` returned a promise that was still pending when the test timed out
      (fail) async custom matcher
        ^ this test timed out after 200ms.
      28 |       test("async custom matcher", () => {
      29 |         expect(1).toSettle();
      30 |         console.log("unreachable: custom matcher");
      31 |       }, { timeout });
      32 |       test("asymmetric resolvesTo", () => {
      33 |         expect(never()).toEqual(expect.resolvesTo.anything());
                                   ^
      error: expect(received).toEqual(expected)

      Expected: promise resolved to Anything
      Received: Promise {}
      (fail) asymmetric resolvesTo
        ^ this test timed out after 200ms.
      34 |         console.log("unreachable: resolvesTo");
      35 |       }, { timeout });
      36 |       // Roomier timeout: the inner matcher is reached through a timer that has to fire first.
      37 |       test("nested inside the test's own blocked matcher", async () => {
      38 |         const outer = new Promise(resolve => setTimeout(() => {
      39 |           expect(never()).resolves.toBe("settled");
                                              ^
      error: expect(received).resolves.toBe(expected)

      Expected promise that resolves
      Received promise that was still pending when the test timed out: Promise { <pending> }
      38 |         const outer = new Promise(resolve => setTimeout(() => {
      39 |           expect(never()).resolves.toBe("settled");
      40 |           console.log("unreachable: inner matcher");
      41 |           resolve("settled");
      42 |         }, 0));
      43 |         await expect(outer).resolves.toBe("settled");
                                                ^
      error: expect(received).resolves.toBe(expected)

      Expected promise that resolves
      Received promise that was still pending when the test timed out: Promise { <pending> }
      (fail) nested inside the test's own blocked matcher
        ^ this test timed out after 1000ms.
      (pass) the next test runs

       1 pass
       7 fail
       5 expect() calls
      Ran 8 tests across 1 file."
      ,
        "stdout": "bun test <version> (<revision>)",
      }
    `);
  });

  test("reached from a continuation of the test body", async () => {
    const result = await runTestFile(`
      test("resolves after an await", async () => {
        await soon();
        await expect(never()).resolves.toBe("settled");
        console.log("unreachable: resolves after an await");
      }, { timeout });
      test("the next test runs", () => {});
    `);
    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "stderr": 
      "blocked.test.ts:
      4 |     const soon = () => new Promise(resolve => setTimeout(resolve, 0, "settled"));
      5 |     const timeout = 200;
      6 | 
      7 |       test("resolves after an await", async () => {
      8 |         await soon();
      9 |         await expect(never()).resolves.toBe("settled");
                                                 ^
      error: expect(received).resolves.toBe(expected)

      Expected promise that resolves
      Received promise that was still pending when the test timed out: Promise { <pending> }
      (fail) resolves after an await
        ^ this test timed out after 200ms.
      (pass) the next test runs

       1 pass
       1 fail
      Ran 2 tests across 1 file."
      ,
        "stdout": "bun test <version> (<revision>)",
      }
    `);
  });

  // The test overruns its timeout synchronously, so by the time its continuation reaches the
  // matcher the runner has already given the test up, run the rest of the file and finished it:
  // the wait gives up at once, and its error can only be reported as a late one.
  test("reached from a continuation of a test the runner already gave up on", async () => {
    const result = await runTestFile(`
      test("resolves after an await", async () => {
        Bun.sleepSync(timeout + 10);
        const settled = soon();
        Bun.sleepSync(10);
        await settled;
        await expect(never()).resolves.toBe("settled");
        console.log("unreachable: resolves after an await");
      }, { timeout });
      test("the next test runs", () => {});
    `);
    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "stderr": 
      "blocked.test.ts:
      (fail) resolves after an await
        ^ this test timed out after 200ms.
      (pass) the next test runs

      # Unhandled error between tests
      -------------------------------
       7 |       test("resolves after an await", async () => {
       8 |         Bun.sleepSync(timeout + 10);
       9 |         const settled = soon();
      10 |         Bun.sleepSync(10);
      11 |         await settled;
      12 |         await expect(never()).resolves.toBe("settled");
                                                  ^
      error: expect(received).resolves.toBe(expected)

      Expected promise that resolves
      Received promise that was still pending when the test ended: Promise { <pending> }
      -------------------------------


       1 pass
       1 fail
       1 error
      Ran 2 tests across 1 file."
      ,
        "stdout": "bun test <version> (<revision>)",
      }
    `);
  });

  test("reached from a hook", async () => {
    const result = await runTestFile(`
      describe("hook", () => {
        beforeEach(async () => {
          await expect(never()).resolves.toBe("settled");
          console.log("unreachable: beforeEach");
        }, timeout);
        test("test of the hook", () => {
          console.log("unreachable: test of the hook");
        });
      });
      test("the next test runs", () => {});
    `);
    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "stderr": 
      "blocked.test.ts:
      4 |     const soon = () => new Promise(resolve => setTimeout(resolve, 0, "settled"));
      5 |     const timeout = 200;
      6 | 
      7 |       describe("hook", () => {
      8 |         beforeEach(async () => {
      9 |           await expect(never()).resolves.toBe("settled");
                                                   ^
      error: expect(received).resolves.toBe(expected)

      Expected promise that resolves
      Received promise that was still pending when the test timed out: Promise { <pending> }
      (fail) hook > test of the hook
        ^ a beforeEach/afterEach hook timed out for this test.
      (pass) the next test runs

       1 pass
       1 fail
      Ran 2 tests across 1 file."
      ,
        "stdout": "bun test <version> (<revision>)",
      }
    `);
  });

  // Inside a concurrent group the runner cannot tell which test a continuation belongs to, so the
  // matcher gives up once every test still executing in the group has timed out (here, once the
  // sibling is done, only the blocked test), or once the group is over.
  test("reached from a continuation inside a concurrent group", async () => {
    const result = await runTestFile(`
      test.concurrent("resolves after an await", async () => {
        await soon();
        await expect(never()).resolves.toBe("settled");
        console.log("unreachable: resolves after an await");
      }, { timeout });
      test.concurrent("sibling of the blocked test", () => {});
      test("the next test runs", () => {});
    `);
    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "stderr": 
      "blocked.test.ts:
      (pass) sibling of the blocked test
      4 |     const soon = () => new Promise(resolve => setTimeout(resolve, 0, "settled"));
      5 |     const timeout = 200;
      6 | 
      7 |       test.concurrent("resolves after an await", async () => {
      8 |         await soon();
      9 |         await expect(never()).resolves.toBe("settled");
                                                 ^
      error: expect(received).resolves.toBe(expected)

      Expected promise that resolves
      Received promise that was still pending when the test timed out: Promise { <pending> }
      (fail) resolves after an await
        ^ this test timed out after 200ms.
      (pass) the next test runs

       2 pass
       1 fail
      Ran 3 tests across 1 file."
      ,
        "stdout": "bun test <version> (<revision>)",
      }
    `);
  });

  // The sibling's own matcher is blocked on the stack underneath the hanging one, so the runner
  // cannot give either test up; the hanging matcher gives up once every test still executing in
  // the group has timed out, and the sibling's matcher, unblocked, gives up right after it. (A
  // sibling promise that a timer settles meanwhile is platform-dependent: on Windows a timer already
  // in the heap does not fire inside a tick nested in another timer's callback, see #40023.)
  test("reached from a continuation while a concurrent sibling is blocked in a matcher", async () => {
    const result = await runTestFile(`
      test.concurrent("resolves after an await", async () => {
        await soon();
        await expect(never()).resolves.toBe("settled");
        console.log("unreachable: resolves after an await");
      }, { timeout });
      test.concurrent("sibling blocked in a matcher", async () => {
        await expect(never()).resolves.toBe("settled");
        console.log("unreachable: sibling");
      }, { timeout });
      test("the next test runs", () => {});
    `);
    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "stderr": 
      "blocked.test.ts:
      4 |     const soon = () => new Promise(resolve => setTimeout(resolve, 0, "settled"));
      5 |     const timeout = 200;
      6 | 
      7 |       test.concurrent("resolves after an await", async () => {
      8 |         await soon();
      9 |         await expect(never()).resolves.toBe("settled");
                                                 ^
      error: expect(received).resolves.toBe(expected)

      Expected promise that resolves
      Received promise that was still pending when the test timed out: Promise { <pending> }
       8 |         await soon();
       9 |         await expect(never()).resolves.toBe("settled");
      10 |         console.log("unreachable: resolves after an await");
      11 |       }, { timeout });
      12 |       test.concurrent("sibling blocked in a matcher", async () => {
      13 |         await expect(never()).resolves.toBe("settled");
                                                  ^
      error: expect(received).resolves.toBe(expected)

      Expected promise that resolves
      Received promise that was still pending when the test timed out: Promise { <pending> }
      (fail) sibling blocked in a matcher
        ^ this test timed out after 200ms.
      (fail) resolves after an await
        ^ this test timed out after 200ms.
      (pass) the next test runs

       1 pass
       2 fail
      Ran 3 tests across 1 file."
      ,
        "stdout": "bun test <version> (<revision>)",
      }
    `);
  });

  // The failure lands on the attempt that timed out, not on the run: the retry's own result decides.
  test("a test that passes on retry after a blocked attempt passes", async () => {
    const result = await runTestFile(`
      let attempt = 0;
      test("passes on retry", async () => {
        attempt++;
        await soon();
        await expect(attempt === 1 ? never() : soon()).resolves.toBe("settled");
      }, { retry: 1, timeout });
      test("the next test runs", () => {});
    `);
    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": 
      "blocked.test.ts:
       6 | 
       7 |       let attempt = 0;
       8 |       test("passes on retry", async () => {
       9 |         attempt++;
      10 |         await soon();
      11 |         await expect(attempt === 1 ? never() : soon()).resolves.toBe("settled");
                                                                           ^
      error: expect(received).resolves.toBe(expected)

      Expected promise that resolves
      Received promise that was still pending when the test timed out: Promise { <pending> }
      (pass) passes on retry (attempt 2)
      (pass) the next test runs

       2 pass
       0 fail
       1 expect() calls
      Ran 2 tests across 1 file."
      ,
        "stdout": "bun test <version> (<revision>)",
      }
    `);
  });

  // A wait the test never awaited outlives the test. While the file runs, the promise can still
  // settle and the matcher runs as before; at the end of the file nothing else can settle it, so the
  // wait gives up, and says why (the test ended, nothing timed out). The leaks are immediates: a wait
  // reached from a timer callback runs inside the timer drain, where on Windows no other timer fires
  // (#40023), and the third test's timer has to.
  test("a wait the test did not await ends with the file", async () => {
    const result = await runTestFile(`
      const later = () => new Promise(resolve => setTimeout(resolve, timeout, "settled"));
      test("leaks a wait that settles while the file runs", () => {
        setImmediate(async () => {
          await expect(later()).resolves.toBe("settled");
          console.log("leaked matcher settled");
        });
      });
      test("leaks a wait that never settles", () => {
        setImmediate(async () => {
          await expect(never()).resolves.toBe("settled");
          console.log("unreachable: leaked matcher");
        });
      });
      test("outlives the first leaked wait", async () => {
        await new Promise(resolve => setTimeout(resolve, timeout * 2));
      });
    `);
    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "stderr": 
      "blocked.test.ts:
      (pass) leaks a wait that settles while the file runs
      (pass) leaks a wait that never settles
      (pass) outlives the first leaked wait

      # Unhandled error between tests
      -------------------------------
      11 |           console.log("leaked matcher settled");
      12 |         });
      13 |       });
      14 |       test("leaks a wait that never settles", () => {
      15 |         setImmediate(async () => {
      16 |           await expect(never()).resolves.toBe("settled");
                                                    ^
      error: expect(received).resolves.toBe(expected)

      Expected promise that resolves
      Received promise that was still pending when the test ended: Promise { <pending> }
      -------------------------------


       3 pass
       0 fail
       1 error
       1 expect() calls
      Ran 3 tests across 1 file."
      ,
        "stdout": 
      "bun test <version> (<revision>)
      leaked matcher settled"
      ,
      }
    `);
  });

  // The matcher owns the promise it gave up on: a rejection that arrives later is not an unhandled
  // rejection of whatever test runs by then.
  test("a rejection that arrives after the matcher gave up is not reported", async () => {
    const result = await runTestFile(`
      test("toThrow on an async function that rejects late", () => {
        expect(async () => {
          await new Promise(resolve => setTimeout(resolve, timeout * 2));
          throw new Error("late");
        }).toThrow("late");
        console.log("unreachable: toThrow");
      }, { timeout });
      test("the next test runs while the late rejection arrives", async () => {
        await new Promise(resolve => setTimeout(resolve, timeout * 2));
      });
    `);
    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "stderr": 
      "blocked.test.ts:
       6 | 
       7 |       test("toThrow on an async function that rejects late", () => {
       8 |         expect(async () => {
       9 |           await new Promise(resolve => setTimeout(resolve, timeout * 2));
      10 |           throw new Error("late");
      11 |         }).toThrow("late");
                      ^
      error: Received function returned a promise that was still pending when the test timed out
      (fail) toThrow on an async function that rejects late
        ^ this test timed out after 200ms.
      (pass) the next test runs while the late rejection arrives

       1 pass
       1 fail
       1 expect() calls
      Ran 2 tests across 1 file."
      ,
        "stdout": "bun test <version> (<revision>)",
      }
    `);
  });

  // The file's timeout timer is armed for the first test and only ever moves sooner, so it is still
  // armed for that deadline when the second test, with a longer timeout, blocks. It fires under the
  // blocked matcher, which disarms it, and the runner that would re-arm it is blocked behind the
  // test body. With the server keeping the loop alive and no other timer due, the wait's poll would
  // park for good; the wait arms the timer for its own deadline. The GC idle timer is disabled
  // because it would otherwise wake the loop once a second and hide this.
  test("wakes at the deadline when an earlier test's timer fires under the wait", async () => {
    const result = await runTestFile(
      `
      import { afterAll } from "bun:test";
      const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
      afterAll(() => server.stop(true));
      test("a test with a shorter timeout", () => {}, { timeout });
      test("blocked with a longer timeout", () => {
        expect(never()).resolves.toBe("settled");
        console.log("unreachable: resolves");
      }, { timeout: timeout * 3 });
      test("the next test runs", () => {});
    `,
      { ...bunEnv, BUN_GC_TIMER_DISABLE: "1" },
    );
    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "stderr": 
      "blocked.test.ts:
      (pass) a test with a shorter timeout
       7 |       import { afterAll } from "bun:test";
       8 |       const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
       9 |       afterAll(() => server.stop(true));
      10 |       test("a test with a shorter timeout", () => {}, { timeout });
      11 |       test("blocked with a longer timeout", () => {
      12 |         expect(never()).resolves.toBe("settled");
                                            ^
      error: expect(received).resolves.toBe(expected)

      Expected promise that resolves
      Received promise that was still pending when the test timed out: Promise { <pending> }
      (fail) blocked with a longer timeout
        ^ this test timed out after 600ms.
      (pass) the next test runs

       2 pass
       1 fail
      Ran 3 tests across 1 file."
      ,
        "stdout": "bun test <version> (<revision>)",
      }
    `);
  });

  test("a promise that does settle is still waited for", async () => {
    const result = await runTestFile(`
      beforeEach(async () => {
        await expect(soon()).resolves.toBe("settled");
      });
      describe("in a describe callback", async () => {
        await expect(soon()).resolves.toBe("settled");
        test("registered after the wait", () => {});
      });
      test("already settled", async () => {
        await expect(Promise.resolve("settled")).resolves.toBe("settled");
        await expect(Promise.reject(new Error("settled"))).rejects.toThrow("settled");
      });
      test("in a test without a timeout", async () => {
        await expect(soon()).resolves.toBe("settled");
      }, { timeout: 0 });
      test("after an await", async () => {
        await soon();
        await expect(soon()).resolves.toBe("settled");
      });
      test("inside the test's own blocked matcher", async () => {
        const outer = new Promise(resolve => setTimeout(() => {
          expect(soon()).resolves.toBe("settled");
          resolve("settled");
        }, 0));
        await expect(outer).resolves.toBe("settled");
      });
      test.concurrent("after an await in a concurrent group", async () => {
        await soon();
        await expect(soon()).resolves.toBe("settled");
      });
      test.concurrent("while a concurrent sibling is blocked in a matcher", async () => {
        await soon();
        await expect(soon()).resolves.toBe("settled");
      });
      test.concurrent("sibling blocked in a matcher", async () => {
        await expect(soon()).resolves.toBe("settled");
      });
    `);
    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": 
      "blocked.test.ts:
      (pass) in a describe callback > registered after the wait
      (pass) already settled
      (pass) in a test without a timeout
      (pass) after an await
      (pass) inside the test's own blocked matcher
      (pass) sibling blocked in a matcher
      (pass) after an await in a concurrent group
      (pass) while a concurrent sibling is blocked in a matcher

       8 pass
       0 fail
       18 expect() calls
      Ran 8 tests across 1 file."
      ,
        "stdout": "bun test <version> (<revision>)",
      }
    `);
  });
});
