import { expect, test } from "bun:test";
import { bunEnv, bunExe, isFlaky, isLinux, tempDir } from "harness";
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

// Shared by the inline test files below. An echo child stays alive until it is
// killed, and `echo()` only gets its message back while the child is alive: a
// killed child never runs again, so its stdout just reports EOF.
const echoChildHelpers = /* ts */ `
  function spawnEcho() {
    return Bun.spawn({
      cmd: [process.execPath, "-e", "process.stdin.pipe(process.stdout)"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });
  }

  async function echo(child: ReturnType<typeof spawnEcho>, message: string) {
    child.stdin.write(message);
    await child.stdin.flush();
    const reader = child.stdout.getReader();
    let received = "";
    while (received.length < message.length) {
      const { value, done } = await reader.read();
      if (done) break;
      received += Buffer.from(value).toString();
    }
    reader.releaseLock();
    return received;
  }
`;

async function runTestFile(source: string, args: string[] = []) {
  using dir = tempDir("test-timeout-kill", { "kill.test.ts": echoChildHelpers + source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args, "./kill.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { combined: stdout + stderr, exitCode };
}

// Under --isolate the runner also tracks the module-scope child; without it only
// the hooks and tests are tracked. Either way the timeout must not touch it.
test.concurrent.each([[[]], [["--isolate"]]])(
  "a test timeout only kills the processes spawned by that test (args: %p)",
  async args => {
    const { combined, exitCode } = await runTestFile(
      /* ts */ `
        import { afterAll, beforeAll, expect, test } from "bun:test";

        const children: ReturnType<typeof spawnEcho>[] = [spawnEcho()];
        afterAll(() => children.forEach(child => child.kill()));

        beforeAll(() => {
          children.push(spawnEcho());
        });

        test("spawns a child that outlives the test", () => {
          children.push(spawnEcho());
        });

        test("times out", async () => {
          children.push(spawnEcho());
          await new Promise(() => {});
        }, 100);

        test("the other children are still running", async () => {
          const [fromModuleScope, fromBeforeAll, fromEarlierTest] = children;
          expect(
            await Promise.all([
              echo(fromModuleScope, "module scope"),
              echo(fromBeforeAll, "beforeAll"),
              echo(fromEarlierTest, "earlier test"),
            ]),
          ).toEqual(["module scope", "beforeAll", "earlier test"]);
        });
      `,
      args,
    );

    expect(combined).toContain("killed 1 dangling process");
    expect(combined).not.toContain("dangling processes");
    expect(combined).toContain("(pass) spawns a child that outlives the test");
    expect(combined).toContain("(fail) times out");
    expect(combined).toContain("(pass) the other children are still running");
    expect(combined).toContain(" 2 pass\n");
    expect(combined).toContain(" 1 fail\n");
    expect(exitCode).toBe(1);
  },
);

test.concurrent("a test timeout kills the children of its beforeEach hooks, not of beforeAll", async () => {
  const { combined, exitCode } = await runTestFile(/* ts */ `
    import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

    let fromBeforeAll: ReturnType<typeof spawnEcho>;
    let fromBeforeEach: ReturnType<typeof spawnEcho>;
    afterAll(() => {
      fromBeforeAll.kill();
      fromBeforeEach.kill();
    });

    beforeAll(() => {
      fromBeforeAll = spawnEcho();
    });

    describe("with a beforeEach", () => {
      beforeEach(() => {
        fromBeforeEach = spawnEcho();
      });

      test("times out", async () => {
        await new Promise(() => {});
      }, 100);
    });

    test("only the beforeEach child was killed", async () => {
      await fromBeforeEach.exited;
      expect(await echo(fromBeforeAll, "beforeAll")).toBe("beforeAll");
    });
  `);

  expect(combined).toContain("killed 1 dangling process");
  expect(combined).not.toContain("dangling processes");
  expect(combined).toContain("(fail) with a beforeEach > times out");
  expect(combined).toContain("(pass) only the beforeEach child was killed");
  expect(combined).toContain(" 1 pass\n");
  expect(combined).toContain(" 1 fail\n");
  expect(exitCode).toBe(1);
});

test.concurrent("a beforeAll timeout only kills the children of that hook", async () => {
  const { combined, exitCode } = await runTestFile(/* ts */ `
    import { afterAll, beforeAll, test } from "bun:test";

    let fromFirstHook: ReturnType<typeof spawnEcho>;
    let fromTimedOutHook: ReturnType<typeof spawnEcho>;

    beforeAll(() => {
      fromFirstHook = spawnEcho();
    });

    beforeAll(async () => {
      fromTimedOutHook = spawnEcho();
      await new Promise(() => {});
    }, 100);

    test("is skipped because beforeAll failed", () => {});

    afterAll(async () => {
      await fromTimedOutHook.exited;
      console.log("first hook's child answered:", JSON.stringify(await echo(fromFirstHook, "still here")));
      fromFirstHook.kill();
    });
  `);

  expect(combined).toContain("killed 1 dangling process");
  expect(combined).not.toContain("dangling processes");
  expect(combined).toContain('first hook\'s child answered: "still here"');
  expect(exitCode).toBe(1);
});

// on_subprocess_exit swap-removes entries, so once a child from an earlier scope
// exits, the timed-out test's children are no longer the tail of the tracked set.
test.concurrent("a test timeout kills all of its children after an earlier child exited", async () => {
  const { combined, exitCode } = await runTestFile(/* ts */ `
    import { afterAll, beforeAll, expect, test } from "bun:test";

    const children: ReturnType<typeof spawnEcho>[] = [];
    afterAll(() => children.forEach(child => child.kill()));

    beforeAll(() => {
      children.push(spawnEcho(), spawnEcho());
    });

    test("spawns a child that outlives the test", () => {
      children.push(spawnEcho());
    });

    test("times out after the first beforeAll child exited", async () => {
      children.push(spawnEcho(), spawnEcho());
      children[0].kill();
      await children[0].exited;
      await new Promise(() => {});
    }, 100);

    test("the second beforeAll child and the earlier test's child are still running", async () => {
      const [, secondFromBeforeAll, fromEarlierTest] = children;
      expect(await Promise.all([echo(secondFromBeforeAll, "beforeAll"), echo(fromEarlierTest, "earlier test")])).toEqual([
        "beforeAll",
        "earlier test",
      ]);
    });
  `);

  expect(combined).toContain("killed 2 dangling processes");
  expect(combined).toContain("(pass) the second beforeAll child and the earlier test's child are still running");
  expect(combined).toContain(" 2 pass\n");
  expect(combined).toContain(" 1 fail\n");
  expect(exitCode).toBe(1);
});

test.concurrent("a test that overruns its timeout without yielding still gets its children killed", async () => {
  const { combined, exitCode } = await runTestFile(/* ts */ `
    import { afterAll, test } from "bun:test";

    let child: ReturnType<typeof spawnEcho>;
    afterAll(() => child.kill());

    test("blocks past its timeout", () => {
      child = spawnEcho();
      Bun.sleepSync(150);
    }, 50);

    test("its child was killed", async () => {
      await child.exited;
    });
  `);

  expect(combined).toContain("killed 1 dangling process");
  expect(combined).not.toContain("dangling processes");
  expect(combined).toContain("(fail) blocks past its timeout");
  expect(combined).toContain("(pass) its child was killed");
  expect(combined).toContain(" 1 pass\n");
  expect(combined).toContain(" 1 fail\n");
  expect(exitCode).toBe(1);
});

test.concurrent("a test without a timeout keeps its processes when an earlier test's timer fires", async () => {
  const { combined, exitCode } = await runTestFile(/* ts */ `
    import { expect, test } from "bun:test";

    // Arms a 50ms timer for this test. The runner never disarms it, so it fires
    // while the next test is running.
    test("finishes immediately", () => {}, 50);

    test("has no timeout and spawns a child", async () => {
      const child = spawnEcho();
      try {
        // Nothing in this file can observe the stale timer firing, so wait on a
        // timer with a later deadline instead: the runner's timer and this one
        // are in the same heap and fire in deadline order, so the 50ms timer
        // (armed before this test started) has fired once this resolves.
        await Bun.sleep(100);
        expect(await echo(child, "still here")).toBe("still here");
      } finally {
        child.kill();
      }
    }, 0);
  `);

  expect(combined).not.toContain("dangling process");
  expect(combined).toContain("(pass) finishes immediately");
  expect(combined).toContain("(pass) has no timeout and spawns a child");
  expect(combined).toContain(" 2 pass\n");
  expect(exitCode).toBe(0);
});

// Consecutive test.concurrent tests share one group and one auto-kill scope, so
// the runner cannot tell which of them spawned a process. A timeout in such a
// group kills the scope once the group is done. These two files wait for the
// runner to kill a child, which can take a while on a slow machine, hence the
// generous default timeout; the timeouts under test are set per test.
const waitForKill = ["--timeout=30000"];

test.concurrent("test.concurrent: the children of timed-out tests are killed once the group is done", async () => {
  const { combined, exitCode } = await runTestFile(
    /* ts */ `
      import { afterAll, describe, expect, test } from "bun:test";

      const children: ReturnType<typeof spawnEcho>[] = [];
      afterAll(() => children.forEach(child => child.kill()));

      describe("hanging", () => {
        test.concurrent.each(["a", "b"])(
          "hangs %s",
          async () => {
            children.push(spawnEcho());
            await new Promise(() => {});
          },
          100,
        );
      });

      // Spawns from a continuation, well before its deadline.
      test.concurrent("hangs after returning to the event loop", async () => {
        await new Promise(resolve => setImmediate(resolve));
        children.push(spawnEcho());
        await new Promise(() => {});
      }, 500);

      test("the children were killed", async () => {
        expect(children).toHaveLength(3);
        await Promise.all(children.map(child => child.exited));
        expect(children.map(child => child.signalCode)).toEqual(["SIGTERM", "SIGTERM", "SIGTERM"]);
      });
    `,
    waitForKill,
  );

  expect(combined.match(/killed \d+ dangling process(?:es)?/g)).toEqual(["killed 3 dangling processes"]);
  expect(combined).toContain("(fail) hanging > hangs a");
  expect(combined).toContain("(fail) hanging > hangs b");
  expect(combined).toContain("(fail) hangs after returning to the event loop");
  expect(combined).toContain("(pass) the children were killed");
  expect(combined).toContain(" 1 pass\n");
  expect(combined).toContain(" 3 fail\n");
  expect(exitCode).toBe(1);
});

test.concurrent(
  "test.concurrent: nothing is killed while a sibling of the timed-out test is still running",
  async () => {
    const { combined, exitCode } = await runTestFile(
      /* ts */ `
      import { afterAll, expect, test } from "bun:test";

      const children: ReturnType<typeof spawnEcho>[] = [];
      afterAll(() => children.forEach(child => child.kill()));

      let fromTimedOut: ReturnType<typeof spawnEcho>;
      const timedOutStarted = Promise.withResolvers<void>();

      test.concurrent("times out", async () => {
        fromTimedOut = spawnEcho();
        children.push(fromTimedOut);
        timedOutStarted.resolve();
        await new Promise(() => {});
      }, 100);

      test.concurrent("sibling that keeps running", async () => {
        children.push(spawnEcho());
        await timedOutStarted.promise;
        // The 100ms deadline above was armed before this timer, so the runner has
        // handled that timeout by the time this resolves, with this test still running.
        await Bun.sleep(200);
        expect(await echo(fromTimedOut, "still here")).toBe("still here");
      });

      test("both children were killed once the group was done", async () => {
        await Promise.all(children.map(child => child.exited));
        expect(children.map(child => child.signalCode)).toEqual(["SIGTERM", "SIGTERM"]);
      });
    `,
      waitForKill,
    );

    expect(combined.match(/killed \d+ dangling process(?:es)?/g)).toEqual(["killed 2 dangling processes"]);
    expect(combined).toContain("(fail) times out");
    expect(combined).toContain("(pass) sibling that keeps running");
    expect(combined).toContain("(pass) both children were killed once the group was done");
    expect(combined).toContain(" 2 pass\n");
    expect(combined).toContain(" 1 fail\n");
    expect(exitCode).toBe(1);
  },
);
