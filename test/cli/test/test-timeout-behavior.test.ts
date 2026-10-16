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
// The children are `sh` scripts. `sh` has set its traps a few milliseconds after it is spawned,
// and a test that times out inside `spawnSync` cannot wait for a ready line from its child.
//
// Every case starts a `bun test`. A debug build starts so slowly that ten at once starve each
// other and the two tests above, so it runs them one at a time.
(isDebug ? describe : describe.concurrent).skipIf(isWindows)("a child that does not exit on SIGTERM", () => {
  // About 30 seconds. Every child ends by itself, so a build that does not kill it leaves nothing behind.
  const spin = "i=0; while [ $i -lt 3000 ]; do sleep 0.01; i=$((i+1)); done";
  const children = {
    handlesSigterm: `trap 'echo SIGTERM >> signals' TERM; : > ready; ${spin}`,
    ignoresSigterm: `trap '' TERM; : > ready; exec sleep 30`,
    exitsOnSigterm: `trap 'echo done > cleanup; exit 0' TERM; : > ready; ${spin}`,
    exitsOnSigint: `trap '' TERM; trap 'echo SIGINT >> signals; exit 0' INT; ${spin}`,
    // Three seconds is past the timeout of every test that spawns it, and the grace period.
    outlivesSigterm: `trap '' TERM; sleep 3; : > survived`,
  };

  const helpers = /* ts */ `
    import { afterAll, expect, test } from "bun:test";
    import { spawn } from "node:child_process";
    import { once } from "node:events";
    import { existsSync, readFileSync } from "node:fs";

    const ignore = { stdin: "ignore", stdout: "ignore", stderr: "ignore" } as const;

    // Synchronous on purpose: the test's deadline cannot fire before this returns, so the
    // timeout finds a child that has set its trap.
    function waitUntilReady() {
      for (let i = 0; !existsSync("ready"); i++) {
        if (i === 20_000) throw new Error("the child did not start");
        Bun.sleepSync(1);
      }
    }
  `;

  async function runTestFiles(sources: Record<string, string>, args: string[] = []) {
    const files = Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, helpers + source]));
    using dir = tempDir("test-timeout-sigterm", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", ...args, ...Object.keys(files).map(name => `./${name}`)],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { combined: stdout + stderr, exitCode };
  }
  const runTestFile = (source: string) => runTestFiles({ "kill.test.ts": source });

  // The second test of each file has a timeout below this file's default, so that a child
  // which survives fails that test and not the one here.
  test("Bun.spawn: the child gets one SIGTERM, then SIGKILL", async () => {
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

  test("child_process.spawn: a child that ignores SIGTERM gets SIGKILL", async () => {
    const { combined, exitCode } = await runTestFile(/* ts */ `
      let child: ReturnType<typeof spawn>;
      let exit: Promise<unknown[]>;
      afterAll(() => child.kill("SIGKILL"));

      test("times out", async () => {
        child = spawn("sh", ["-c", ${JSON.stringify(children.ignoresSigterm)}], { stdio: "ignore" });
        exit = once(child, "exit");
        waitUntilReady();
        await new Promise(() => {});
      }, 20);

      test("the child was killed", async () => {
        expect(await exit).toEqual([null, "SIGKILL"]);
      }, 2000);
    `);

    expect(combined).toContain("killed 1 dangling process");
    expect(combined).toContain("(fail) times out");
    expect(combined).toContain("(pass) the child was killed");
    expect(exitCode).toBe(1);
  });

  test("a child that exits on SIGTERM is not sent SIGKILL", async () => {
    const { combined, exitCode } = await runTestFile(/* ts */ `
      let child: Bun.Subprocess;
      afterAll(() => child.kill("SIGKILL"));

      test("times out", async () => {
        child = Bun.spawn({ cmd: ["sh", "-c", ${JSON.stringify(children.exitsOnSigterm)}], ...ignore });
        waitUntilReady();
        await new Promise(() => {});
      }, 20);

      test("the child exited by itself", async () => {
        expect({
          exitCode: await child.exited,
          signalCode: child.signalCode,
          cleanup: readFileSync("cleanup", "utf8"),
        }).toEqual({ exitCode: 0, signalCode: null, cleanup: "done\\n" });
      }, 2000);
    `);

    expect(combined).toContain("killed 1 dangling process");
    expect(combined).toContain("(fail) times out");
    expect(combined).toContain("(pass) the child exited by itself");
    expect(exitCode).toBe(1);
  });

  // The child writes `survived` when `spawnSync` waited for it to end by itself.
  const spawnSyncFile = (timesOut: string) => /* ts */ `
    const cmd = ["sh", "-c", ${JSON.stringify(children.outlivesSigterm)}];
    ${timesOut}
    test("the child did not outlive the timeout", () => {
      expect(existsSync("survived")).toBe(false);
    });
  `;

  test("spawnSync: the timeout ends the wait", async () => {
    const { combined, exitCode } = await runTestFile(
      spawnSyncFile(/* ts */ `
        test("times out", () => {
          Bun.spawnSync({ cmd, ...ignore });
        }, 300);
      `),
    );

    expect(combined).toContain("killed 1 dangling process");
    expect(combined).toContain("(fail) times out");
    expect(combined).toContain("(pass) the child did not outlive the timeout");
    expect(exitCode).toBe(1);
  });

  // The runner kills no tracked process for a group of concurrent tests, so only the `spawnSync` wait can end the child.
  test("spawnSync in a group of concurrent tests: the timeout ends the wait", async () => {
    const { combined, exitCode } = await runTestFile(
      spawnSyncFile(/* ts */ `
        test.concurrent("times out", () => {
          Bun.spawnSync({ cmd, ...ignore });
        }, 300);
        test.concurrent("runs in the same group", () => {});
      `),
    );

    expect(combined).not.toContain("dangling process");
    expect(combined).toContain("(fail) times out");
    expect(combined).toContain("(pass) runs in the same group");
    expect(combined).toContain("(pass) the child did not outlive the timeout");
    expect(exitCode).toBe(1);
  });

  test("spawnSync: the test's timeout ends the wait after spawnSync's own timeout", async () => {
    const { combined, exitCode } = await runTestFile(
      spawnSyncFile(/* ts */ `
        test("times out", () => {
          Bun.spawnSync({ cmd, timeout: 50, ...ignore });
        }, 300);
      `),
    );

    expect(combined).toContain("killed 1 dangling process");
    expect(combined).toContain("(fail) times out");
    expect(combined).toContain("(pass) the child did not outlive the timeout");
    expect(exitCode).toBe(1);
  });

  test("spawnSync: the child gets killSignal before the wait for it to exit", async () => {
    const { combined, exitCode } = await runTestFile(/* ts */ `
      test("times out", () => {
        Bun.spawnSync({ cmd: ["sh", "-c", ${JSON.stringify(children.exitsOnSigint)}], killSignal: "SIGINT", ...ignore });
      }, 500);

      test("the child exited on SIGINT", () => {
        expect(readFileSync("signals", "utf8")).toBe("SIGINT\\n");
      });
    `);

    expect(combined).toContain("killed 1 dangling process");
    expect(combined).toContain("(fail) times out");
    expect(combined).toContain("(pass) the child exited on SIGINT");
    expect(exitCode).toBe(1);
  });

  test("--isolate: a child that a file leaves behind is killed before the next file", async () => {
    const { combined, exitCode } = await runTestFiles(
      {
        "a-leak.test.ts": /* ts */ `
          import { writeFileSync } from "node:fs";

          test("leaves a child that ignores SIGTERM", () => {
            const child = Bun.spawn({ cmd: ["sh", "-c", ${JSON.stringify(children.ignoresSigterm)}], ...ignore });
            writeFileSync("pid", String(child.pid));
            waitUntilReady();
          });
        `,
        "b-check.test.ts": /* ts */ `
          const isAlive = (pid: number) => {
            try {
              process.kill(pid, 0);
              return true;
            } catch {
              return false;
            }
          };

          test("the child was killed", async () => {
            const pid = Number(readFileSync("pid", "utf8"));
            // It is dead by now; allow a moment for the event loop to reap it.
            for (let i = 0; i < 50 && isAlive(pid); i++) await Bun.sleep(20);
            expect(isAlive(pid)).toBe(false);
          });
        `,
      },
      ["--isolate"],
    );

    expect(combined).toContain("(pass) leaves a child that ignores SIGTERM");
    expect(combined).toContain("(pass) the child was killed");
    expect(exitCode).toBe(0);
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
