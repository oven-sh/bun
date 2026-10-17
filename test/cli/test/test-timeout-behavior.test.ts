import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isFlaky, isLinux, isWindows, tempDir } from "harness";
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

// Not on Windows: a timeout ends a child there with TerminateProcess, which no child can refuse.
//
// The children are `sh` scripts: `sh` has set its traps a few milliseconds after it is spawned.
// Each one ends by itself, so a build that does not kill it leaves nothing behind for long.
//
// Every case starts a `bun test`. A debug build starts so slowly that all of them at once starve
// each other and the two tests above, so it runs them one at a time.
(isDebug ? describe : describe.concurrent).skipIf(isWindows)("a child that does not exit on SIGTERM", () => {
  // About 30 seconds.
  const spin = "i=0; while [ $i -lt 3000 ]; do sleep 0.01; i=$((i+1)); done";
  const children = {
    ignoresSigterm: `trap '' TERM; : > ready; exec sleep 30`,
    handlesSigterm: `trap 'echo SIGTERM >> signals' TERM; : > ready; ${spin}`,
    exitsOnSigterm: `trap 'exit 7' TERM; : > ready; ${spin}`,
    // More than a pipe holds, so the child can only exit while the test process reads.
    writesOnSigterm: `trap 'head -c 200000 /dev/zero; exit 0' TERM; : > ready; ${spin}`,
    // Ignores SIGTERM, and shows that it is alive when it gets SIGUSR1.
    answersSigusr1: `trap '' TERM; trap ': > answer' USR1; : > ready-shared; ${spin}`,
    // Past the timeout of the test that spawns it, and the grace period after it.
    ignoresSigtermFor3s: `trap '' TERM; sleep 3`,
    hasAChild: `trap '' TERM; sleep 30 & : > ready; wait`,
  };

  const helpers = /* ts */ `
    import { afterAll, beforeAll, expect, test } from "bun:test";
    import { spawnSync } from "node:child_process";
    import { existsSync, readFileSync } from "node:fs";

    const ignore = { stdin: "ignore", stdout: "ignore", stderr: "ignore" } as const;

    // Synchronous on purpose: the test's deadline cannot fire before this returns, so the
    // timeout finds a child that has set its traps.
    function waitUntilReady(file = "ready") {
      for (let i = 0; !existsSync(file); i++) {
        if (i === 20_000) throw new Error("the child did not start");
        Bun.sleepSync(1);
      }
    }
  `;

  async function runTestFile(source: string, args: string[] = [], env = bunEnv) {
    using dir = tempDir("test-timeout-sigkill", { "kill.test.ts": helpers + source });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args, "./kill.test.ts"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = proc.stderr.text();
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    // A child that inherited stderr and is still running keeps the pipe open. A zombie does not,
    // so this also holds where nothing reaps the child after `bun test` is gone.
    const { promise: stillOpen, resolve } = Promise.withResolvers<undefined>();
    const timer = setTimeout(resolve, 3000);
    const closed = await Promise.race([stderr, stillOpen]);
    clearTimeout(timer);
    return { combined: stdout + (closed ?? ""), exitCode, outlivedBy: closed === undefined ? "a child" : "nothing" };
  }

  test("a timeout that ends the run: the test's child is killed before `bun test` exits", async () => {
    const { combined, exitCode, outlivedBy } = await runTestFile(/* ts */ `
      test("times out", async () => {
        Bun.spawn({ cmd: ["sh", "-c", ${JSON.stringify(children.ignoresSigterm)}], ...ignore, stderr: "inherit" });
        waitUntilReady();
        await new Promise(() => {});
      }, 20);
    `);

    expect(outlivedBy).toBe("nothing");
    expect(combined).toContain("killed 1 dangling process");
    expect(combined).toContain("(fail) times out");
    expect(exitCode).toBe(1);
  });

  test("--bail after a timeout: the test's child is killed before `bun test` exits", async () => {
    const { combined, exitCode, outlivedBy } = await runTestFile(
      /* ts */ `
        test("times out", async () => {
          Bun.spawn({ cmd: ["sh", "-c", ${JSON.stringify(children.ignoresSigterm)}], ...ignore, stderr: "inherit" });
          waitUntilReady();
          await new Promise(() => {});
        }, 20);
        test("does not run", () => {});
      `,
      ["--bail"],
    );

    expect(outlivedBy).toBe("nothing");
    expect(combined).toContain("Bailed out after 1 failure");
    expect(combined).not.toContain("does not run");
    expect(exitCode).toBe(1);
  });

  // In that mode Bun ends its whole process tree when it exits. SIGKILL to the wrapper before
  // that would leave its child outside the tree.
  test.skipIf(!isLinux)("no-orphans mode: a child that has a child of its own is left to the exit sweep", async () => {
    const { combined, exitCode, outlivedBy } = await runTestFile(
      /* ts */ `
        test("times out", async () => {
          Bun.spawn({ cmd: ["sh", "-c", ${JSON.stringify(children.hasAChild)}], ...ignore, stderr: "inherit" });
          waitUntilReady();
          await new Promise(() => {});
        }, 20);
      `,
      [],
      { ...bunEnv, BUN_FEATURE_FLAG_NO_ORPHANS: "1" },
    );

    expect(outlivedBy).toBe("nothing");
    expect(combined).toContain("(fail) times out");
    expect(exitCode).toBe(1);
  });

  // The second test of these files has a timeout below this file's default, so that a child
  // which is not killed fails that test and not the one here.
  test("a timeout in the middle of the run: the child gets one SIGTERM, then SIGKILL", async () => {
    const { combined, exitCode } = await runTestFile(/* ts */ `
      let child: Bun.Subprocess;
      afterAll(() => child.kill("SIGKILL"));

      test("times out", async () => {
        child = Bun.spawn({ cmd: ["sh", "-c", ${JSON.stringify(children.handlesSigterm)}], ...ignore });
        waitUntilReady();
        await new Promise(() => {});
      }, 20);

      test("the child was killed", async () => {
        await child.exited;
        expect({ signalCode: child.signalCode, signals: readFileSync("signals", "utf8") }).toEqual({
          signalCode: "SIGKILL",
          signals: "SIGTERM\\n",
        });
      }, 2000);
    `);

    expect(combined).toContain("killed 1 dangling process");
    expect(combined).toContain("(fail) times out");
    expect(combined).toContain("(pass) the child was killed");
    expect(exitCode).toBe(1);
  });

  test("a child that exits on SIGTERM keeps its exit code", async () => {
    const { combined, exitCode } = await runTestFile(/* ts */ `
      let child: Bun.Subprocess;
      afterAll(() => child.kill("SIGKILL"));

      test("times out", async () => {
        child = Bun.spawn({ cmd: ["sh", "-c", ${JSON.stringify(children.exitsOnSigterm)}], ...ignore });
        waitUntilReady();
        await new Promise(() => {});
      }, 20);

      test("the child exited by itself", async () => {
        expect({ exitCode: await child.exited, signalCode: child.signalCode }).toEqual({ exitCode: 7, signalCode: null });
      }, 2000);
    `);

    expect(combined).toContain("killed 1 dangling process");
    expect(combined).toContain("(pass) the child exited by itself");
    expect(exitCode).toBe(1);
  });

  test("a child that needs the test process to read its output can still exit on SIGTERM", async () => {
    const { combined, exitCode } = await runTestFile(/* ts */ `
      let child: Bun.Subprocess<"ignore", "pipe", "ignore">;
      afterAll(() => child.kill("SIGKILL"));

      test("times out", async () => {
        child = Bun.spawn({
          cmd: ["sh", "-c", ${JSON.stringify(children.writesOnSigterm)}],
          stdin: "ignore",
          stdout: "pipe",
          stderr: "ignore",
        });
        waitUntilReady();
        await new Promise(() => {});
      }, 20);

      test("the child exited by itself", async () => {
        const [output, exitCode] = await Promise.all([child.stdout.bytes(), child.exited]);
        expect({ bytes: output.length, exitCode, signalCode: child.signalCode }).toEqual({
          bytes: 200000,
          exitCode: 0,
          signalCode: null,
        });
      }, 2000);
    `);

    expect(combined).toContain("(pass) the child exited by itself");
    expect(exitCode).toBe(1);
  });

  test("a beforeAll child that ignores SIGTERM is not sent SIGKILL by the timeout of a test", async () => {
    const { combined, exitCode } = await runTestFile(/* ts */ `
      let shared: Bun.Subprocess;
      let own: Bun.Subprocess;
      afterAll(() => {
        shared.kill("SIGKILL");
        own.kill("SIGKILL");
      });

      beforeAll(() => {
        shared = Bun.spawn({ cmd: ["sh", "-c", ${JSON.stringify(children.answersSigusr1)}], ...ignore });
        waitUntilReady("ready-shared");
      });

      test("times out", async () => {
        own = Bun.spawn({ cmd: ["sh", "-c", ${JSON.stringify(children.ignoresSigterm)}], ...ignore });
        waitUntilReady();
        await new Promise(() => {});
      }, 20);

      test("only the child of the test was killed", async () => {
        await own.exited;
        shared.kill("SIGUSR1");
        for (let i = 0; i < 500 && !existsSync("answer"); i++) await Bun.sleep(10);
        expect({ own: own.signalCode, sharedAnswered: existsSync("answer") }).toEqual({
          own: "SIGKILL",
          sharedAnswered: true,
        });
      }, 4000);
    `);

    expect(combined).toContain("killed 2 dangling processes");
    expect(combined).toContain("(pass) only the child of the test was killed");
    expect(exitCode).toBe(1);
  });

  test("the stale timer of an earlier test does not signal anything during a test with no timeout", async () => {
    const { combined, exitCode } = await runTestFile(/* ts */ `
      let child: Bun.Subprocess;
      afterAll(() => child.kill("SIGKILL"));

      beforeAll(() => {
        child = Bun.spawn({ cmd: ["sh", "-c", ${JSON.stringify(children.handlesSigterm)}], ...ignore });
        waitUntilReady();
      });

      test("has a deadline and is done at once", () => {}, 30);

      test("has no timeout", async () => {
        // Until that deadline has passed: nothing tells a test that the timer of the file fired.
        await Bun.sleep(120);
      }, 0);

      test("the child was not signalled", () => {
        expect({ exitCode: child.exitCode, signalled: existsSync("signals") }).toEqual({ exitCode: null, signalled: false });
      });
    `);

    expect(combined).not.toContain("dangling process");
    expect(combined).toContain("(pass) the child was not signalled");
    expect(exitCode).toBe(0);
  });

  test("a test that returns after its deadline and passes keeps its child", async () => {
    const { combined, exitCode } = await runTestFile(/* ts */ `
      let child: Bun.Subprocess;
      afterAll(() => child.kill("SIGKILL"));

      test("returns late", async () => {
        const start = performance.now();
        await new Promise(resolve => setImmediate(resolve));
        child = Bun.spawn({ cmd: ["sh", "-c", ${JSON.stringify(children.handlesSigterm)}], ...ignore });
        waitUntilReady();
        while (performance.now() - start < 80) Bun.sleepSync(5);
      }, 40);

      test("the child is still running", () => {
        expect(child.exitCode).toBe(null);
      });
    `);

    expect(combined).not.toContain("dangling process");
    expect(combined).toContain("(pass) returns late");
    expect(combined).toContain("(pass) the child is still running");
    expect(exitCode).toBe(0);
  });

  test.each([
    ["Bun.spawnSync", `test("times out", () => { report(Bun.spawnSync({ cmd, ...ignore }).signalCode); }, 300);`],
    [
      "child_process.spawnSync",
      `test("times out", () => { report(spawnSync(cmd[0], cmd.slice(1), { stdio: "ignore" }).signal); }, 300);`,
    ],
    [
      "Bun.spawnSync after its own timeout",
      `test("times out", () => { report(Bun.spawnSync({ cmd, timeout: 50, ...ignore }).signalCode); }, 300);`,
    ],
    // The runner signals nothing for a group of concurrent tests, so only the wait itself can end the child.
    [
      "Bun.spawnSync in a group of concurrent tests",
      `test.concurrent("times out", () => { report(Bun.spawnSync({ cmd, ...ignore }).signalCode); }, 300);
       test.concurrent("runs in the same group", () => {});`,
    ],
  ])("%s: the timeout of the test ends the wait", async (_, timesOut) => {
    const { combined, exitCode } = await runTestFile(/* ts */ `
      const cmd = ["sh", "-c", ${JSON.stringify(children.ignoresSigtermFor3s)}];
      const report = (signal: unknown) => console.log("the child ended on " + signal);
      ${timesOut}
    `);

    expect(combined).toContain("the child ended on SIGKILL");
    expect(combined).toContain("(fail) times out");
    expect(exitCode).toBe(1);
  });

  // The deadline that `spawnSync` sees there is the one of the other test.
  test("Bun.spawnSync in a test with no timeout is not ended by the timeout of another test", async () => {
    const { combined, exitCode } = await runTestFile(/* ts */ `
      test.concurrent("times out", async () => {
        await new Promise(() => {});
      }, 100);

      test.concurrent("has no timeout", async () => {
        await new Promise(resolve => setImmediate(resolve));
        const { exitCode } = Bun.spawnSync({ cmd: ["sh", "-c", "trap '' TERM; sleep 1; exit 7"], ...ignore });
        console.log("the child ended with " + exitCode);
      }, 0);
    `);

    expect(combined).toContain("the child ended with 7");
    expect(combined).toContain("(fail) times out");
    expect(combined).toContain("(pass) has no timeout");
    expect(exitCode).toBe(1);
  });

  // As in node: without a test timeout, `timeout` sends `killSignal` once and waits for the child.
  test("spawnSync's own timeout alone does not send SIGKILL", async () => {
    const { combined, exitCode } = await runTestFile(/* ts */ `
      test("waits for the child", () => {
        const { exitCode, exitedDueToTimeout } = Bun.spawnSync({
          cmd: ["sh", "-c", "trap '' TERM; sleep 1; exit 7"],
          timeout: 50,
          ...ignore,
        });
        expect({ exitCode, exitedDueToTimeout }).toEqual({ exitCode: 7, exitedDueToTimeout: true });
      });
    `);

    expect(combined).toContain("(pass) waits for the child");
    expect(exitCode).toBe(0);
  });
});
