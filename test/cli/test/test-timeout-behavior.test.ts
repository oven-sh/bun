import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isFlaky, isLinux, tempDir } from "harness";
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
      // Not the repo root or test/: their bunfig.toml preloads harness.ts into the fixture.
      cwd: import.meta.dir,
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
  const echoScript = "for await (const chunk of Bun.stdin.stream()) await Bun.write(Bun.stdout, chunk);";

  function spawnEcho() {
    return Bun.spawn({
      cmd: [process.execPath, "-e", echoScript],
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

// The inline files wait for echo round trips and for the runner to kill a child.
// The default timeout is raised so that a slow machine cannot fail those waits;
// every timeout under test is set per test.
async function runTestFile(source: string, args: string[] = [], preload?: string) {
  using dir = tempDir("test-timeout-kill", {
    "kill.test.ts": echoChildHelpers + source,
    ...(preload && { "preload.ts": echoChildHelpers + preload }),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--timeout=30000", ...(preload ? ["--preload=./preload.ts"] : []), ...args, "./kill.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { combined: stdout + stderr, exitCode };
}

// A debug build needs about half a second of CPU to start one bun process, and a
// case below starts up to six. Run together they starve each other past the
// default timeout, so a debug build runs them one at a time.
const testKill = test.concurrentIf(!isDebug);

// Under --isolate the runner also tracks the module-scope child; without it only
// the hooks and tests are tracked. Either way the timeout must not touch it.
testKill.each([[[]], [["--isolate"]]])(
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

testKill("a test that times out without a child of its own kills nothing", async () => {
  const { combined, exitCode } = await runTestFile(/* ts */ `
    import { afterAll, beforeAll, expect, test } from "bun:test";
    import { spawn, type ChildProcess } from "node:child_process";

    let fromBunSpawn: ReturnType<typeof spawnEcho>;
    let fromChildProcess: ChildProcess;
    afterAll(() => {
      fromBunSpawn.kill();
      fromChildProcess.kill();
    });

    beforeAll(() => {
      fromBunSpawn = spawnEcho();
      fromChildProcess = spawn(process.execPath, ["-e", echoScript], { stdio: ["pipe", "pipe", "ignore"] });
    });

    test("times out", async () => {
      await new Promise(() => {});
    }, 100);

    test("the beforeAll children are still running", async () => {
      const message = "node:child_process";
      // A child that was killed closes without an answer.
      const { promise: fromNode, resolve } = Promise.withResolvers<string>();
      let received = "";
      fromChildProcess.stdout!.on("data", chunk => {
        received += chunk;
        if (received.length >= message.length) resolve(received);
      });
      fromChildProcess.once("close", () => resolve(received));
      fromChildProcess.stdin!.once("error", () => resolve(received));
      fromChildProcess.stdin!.write(message);

      expect([await echo(fromBunSpawn, "Bun.spawn"), await fromNode]).toEqual(["Bun.spawn", message]);
    });
  `);

  expect(combined).not.toContain("dangling process");
  expect(combined).toContain("(fail) times out");
  expect(combined).toContain("(pass) the beforeAll children are still running");
  expect(combined).toContain(" 1 pass\n");
  expect(combined).toContain(" 1 fail\n");
  expect(exitCode).toBe(1);
});

// afterEach still runs after the test timed out, so the beforeEach child is its to stop.
testKill("a test timeout leaves the children of its beforeEach hooks to afterEach", async () => {
  const { combined, exitCode } = await runTestFile(/* ts */ `
    import { afterAll, afterEach, beforeEach, test } from "bun:test";

    let fromBeforeEach: ReturnType<typeof spawnEcho>;
    let fromTest: ReturnType<typeof spawnEcho>;
    afterAll(() => {
      fromBeforeEach.kill();
      fromTest.kill();
    });

    beforeEach(() => {
      fromBeforeEach = spawnEcho();
    });

    afterEach(async () => {
      console.log("beforeEach child answered in afterEach:", JSON.stringify(await echo(fromBeforeEach, "still here")));
    });

    test("times out", async () => {
      fromTest = spawnEcho();
      await new Promise(() => {});
    }, 100);
  `);

  expect(combined).toContain("killed 1 dangling process");
  expect(combined).not.toContain("dangling processes");
  expect(combined).toContain('beforeEach child answered in afterEach: "still here"');
  expect(combined).toContain("(fail) times out");
  expect(combined).toContain(" 0 pass\n");
  expect(combined).toContain(" 1 fail\n");
  expect(exitCode).toBe(1);
});

// A retry runs beforeEach again, which here reuses the child that the first attempt started.
// Every attempt times out, so no callback has to finish inside the short timeout.
testKill("a timed-out attempt does not kill a beforeEach child that the retry needs", async () => {
  const { combined, exitCode } = await runTestFile(/* ts */ `
    import { afterAll, beforeEach, test } from "bun:test";

    let fromBeforeEach: ReturnType<typeof spawnEcho> | undefined;
    afterAll(() => fromBeforeEach?.kill());

    beforeEach(async () => {
      fromBeforeEach ??= spawnEcho();
      console.log("beforeEach child answered:", JSON.stringify(await echo(fromBeforeEach, "still here")));
    });

    test("times out on every attempt", async () => {
      await new Promise(() => {});
    }, { retry: 1, timeout: 100 });
  `);

  expect(combined).not.toContain("dangling process");
  expect(combined.match(/beforeEach child answered: "still here"/g)).toHaveLength(2);
  expect(combined).toContain("(fail) times out on every attempt");
  expect(combined).toContain(" 0 pass\n");
  expect(combined).toContain(" 1 fail\n");
  expect(exitCode).toBe(1);
});

testKill("a beforeAll timeout only kills the children of that hook", async () => {
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

// An afterEach that times out was the cleanup of its test. What the test and its
// hooks started has no other cleanup, so it is killed too. The beforeAll child is not.
testKill("an afterEach timeout kills the children of its test, not of beforeAll", async () => {
  const { combined, exitCode } = await runTestFile(/* ts */ `
    import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

    let fromBeforeAll: ReturnType<typeof spawnEcho>;
    let fromBeforeEach: ReturnType<typeof spawnEcho>;
    let fromTest: ReturnType<typeof spawnEcho>;
    afterAll(() => fromBeforeAll.kill());

    beforeAll(() => {
      fromBeforeAll = spawnEcho();
    });

    describe("cleanup hangs", () => {
      beforeEach(() => {
        fromBeforeEach = spawnEcho();
      });

      afterEach(async () => {
        await new Promise(() => {});
      }, 100);

      test("spawns a child", () => {
        fromTest = spawnEcho();
      });
    });

    test("only the beforeAll child is still running", async () => {
      await Promise.all([fromBeforeEach.exited, fromTest.exited]);
      expect(await echo(fromBeforeAll, "beforeAll")).toBe("beforeAll");
    });
  `);

  expect(combined.match(/killed \d+ dangling process(?:es)?/g)).toEqual(["killed 2 dangling processes"]);
  expect(combined).toContain("(fail) cleanup hangs > spawns a child");
  expect(combined).toContain("(pass) only the beforeAll child is still running");
  expect(combined).toContain(" 1 pass\n");
  expect(combined).toContain(" 1 fail\n");
  expect(exitCode).toBe(1);
});

// The kill goes back to the start of the test, not of the attempt: the afterEach of
// the last attempt was the cleanup of what the earlier attempts left running.
testKill("an afterEach timeout on a retry kills the beforeEach child of the first attempt", async () => {
  const { combined, exitCode } = await runTestFile(/* ts */ `
    import { afterEach, beforeEach, describe, expect, test } from "bun:test";

    let fromFirstAttempt: ReturnType<typeof spawnEcho>;
    let attempts = 0;

    describe("retried", () => {
      beforeEach(() => {
        if (++attempts === 1) fromFirstAttempt = spawnEcho();
      });

      afterEach(async () => {
        if (attempts === 2) await new Promise(() => {});
      }, 100);

      test("fails on the first attempt", () => {
        expect(attempts).toBe(2);
      }, { retry: 1 });
    });

    test("the child of the first attempt was killed", async () => {
      await fromFirstAttempt.exited;
    });
  `);

  expect(combined.match(/killed \d+ dangling process(?:es)?/g)).toEqual(["killed 1 dangling process"]);
  expect(combined).toContain("(fail) retried > fails on the first attempt");
  expect(combined).toContain("(pass) the child of the first attempt was killed");
  expect(exitCode).toBe(1);
});

// The afterAll of a describe block was the cleanup of that block. The child of the
// file's beforeAll still has the file's afterAll.
testKill("an afterAll timeout in a describe block only kills the children of that block", async () => {
  const { combined, exitCode } = await runTestFile(/* ts */ `
    import { afterAll, beforeAll, describe, expect, test } from "bun:test";

    let fromFileBeforeAll: ReturnType<typeof spawnEcho>;
    let fromBlockBeforeAll: ReturnType<typeof spawnEcho>;
    let fromBlockTest: ReturnType<typeof spawnEcho>;
    afterAll(() => fromFileBeforeAll.kill());

    beforeAll(() => {
      fromFileBeforeAll = spawnEcho();
    });

    describe("block", () => {
      beforeAll(() => {
        fromBlockBeforeAll = spawnEcho();
      });

      afterAll(async () => {
        await new Promise(() => {});
      }, 100);

      test("spawns a child that outlives the test", () => {
        fromBlockTest = spawnEcho();
      });
    });

    test("only the child of the file's beforeAll is still running", async () => {
      await Promise.all([fromBlockBeforeAll.exited, fromBlockTest.exited]);
      expect(await echo(fromFileBeforeAll, "beforeAll")).toBe("beforeAll");
    });
  `);

  expect(combined.match(/killed \d+ dangling process(?:es)?/g)).toEqual(["killed 2 dangling processes"]);
  expect(combined).toContain("(pass) block > spawns a child that outlives the test");
  expect(combined).toContain("(pass) only the child of the file's beforeAll is still running");
  expect(exitCode).toBe(1);
});

// The same for a file: its afterAll leaves the child of a preload beforeAll to the
// preload afterAll. Nothing runs after that one, so it kills all that is left.
testKill("an afterAll timeout of a file kills the children of the file, and of a preload kills the rest", async () => {
  const { combined, exitCode } = await runTestFile(
    /* ts */ `
      import { afterAll, beforeAll, test } from "bun:test";

      beforeAll(() => {
        spawnEcho();
      });

      afterAll(async () => {
        await new Promise(() => {});
      }, 100);

      test("spawns a child that outlives the test", () => {
        spawnEcho();
      });
    `,
    [],
    /* ts */ `
      import { afterAll, beforeAll } from "bun:test";

      beforeAll(() => {
        spawnEcho();
      });

      afterAll(async () => {
        await new Promise(() => {});
      }, 100);
    `,
  );

  expect(combined.match(/killed \d+ dangling process(?:es)?/g)).toEqual([
    "killed 2 dangling processes",
    "killed 1 dangling process",
  ]);
  expect(combined).toContain("(pass) spawns a child that outlives the test");
  expect(exitCode).toBe(1);
});

// The wait loop of spawnSync sees the deadline pass and runs the same kill.
testKill.each([
  ["Bun.spawnSync", `Bun.spawnSync({ cmd: [process.execPath, "-e", "Bun.sleepSync(30000)"] })`],
  ["child_process.spawnSync", `spawnSync(process.execPath, ["-e", "Bun.sleepSync(30000)"])`],
])("a test that times out inside %s only gets that child killed", async (_api, blockInSpawnSync) => {
  const { combined, exitCode } = await runTestFile(/* ts */ `
    import { afterAll, beforeAll, expect, test } from "bun:test";
    import { spawnSync } from "node:child_process";

    let fromBeforeAll: ReturnType<typeof spawnEcho>;
    afterAll(() => fromBeforeAll.kill());

    beforeAll(() => {
      fromBeforeAll = spawnEcho();
    });

    test("blocks in spawnSync past its timeout", () => {
      ${blockInSpawnSync};
    }, 100);

    test("the beforeAll child is still running", async () => {
      expect(await echo(fromBeforeAll, "beforeAll")).toBe("beforeAll");
    });
  `);

  expect(combined).toContain("killed 1 dangling process");
  expect(combined).not.toContain("dangling processes");
  expect(combined).toContain("(fail) blocks in spawnSync past its timeout");
  expect(combined).toContain("(pass) the beforeAll child is still running");
  expect(combined).toContain(" 1 pass\n");
  expect(combined).toContain(" 1 fail\n");
  expect(exitCode).toBe(1);
});

// on_subprocess_exit swap-removes entries, so once a child from an earlier scope
// exits, the timed-out test's children are no longer the tail of the tracked set.
testKill("a test timeout kills all of its children after an earlier child exited", async () => {
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

// The timer fires after the callback returned and before the runner steps past the entry.
// The callback was not interrupted, so the entry passes and nothing is killed.
// Not concurrent: the callback has to reach the event loop before its deadline, and
// the cases above, run together, can hold it up for longer than that.
test("a callback that returns after its deadline keeps its children", async () => {
  const { combined, exitCode } = await runTestFile(/* ts */ `
    import { afterAll, beforeAll, expect, test } from "bun:test";

    const children: ReturnType<typeof spawnEcho>[] = [];
    afterAll(() => children.forEach(child => child.kill()));

    // Resumes from the event loop, then holds the thread until its deadline has passed.
    const timeout = 500;
    async function returnsLate() {
      const start = performance.now();
      await new Promise(resolve => setImmediate(resolve));
      children.push(spawnEcho());
      while (performance.now() - start < timeout + 50) Bun.sleepSync(10);
    }

    beforeAll(returnsLate, timeout);
    test("returns after its deadline", returnsLate, timeout);

    test("both children are still running", async () => {
      expect(await Promise.all([echo(children[0], "beforeAll"), echo(children[1], "test")])).toEqual(["beforeAll", "test"]);
    });
  `);

  expect(combined).not.toContain("dangling process");
  expect(combined).toContain("(pass) returns after its deadline");
  expect(combined).toContain("(pass) both children are still running");
  expect(combined).toContain(" 2 pass\n");
  expect(combined).toContain(" 0 fail\n");
  expect(exitCode).toBe(0);
});
