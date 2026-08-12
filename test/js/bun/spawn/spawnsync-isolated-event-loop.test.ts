import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

describe.concurrent("spawnSync isolated event loop", () => {
  test("JavaScript timers should not fire during spawnSync", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let timerFired = false;

        // Set a timer that should NOT fire during spawnSync
        const interval = setInterval(() => {
          timerFired = true;
          console.log("TIMER_FIRED");
          process.exit(1);
        }, 1);

        // Run a subprocess synchronously
        const result = Bun.spawnSync({
          cmd: ["${bunExe()}", "-e", "Bun.sleepSync(16)"],
          env: process.env,
        });

        clearInterval(interval);

        console.log("SUCCESS: Timer did not fire during spawnSync");
        process.exit(0);
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toContain("SUCCESS");
    expect(stdout).not.toContain("TIMER_FIRED");
    expect(stdout).not.toContain("FAIL");
    expect(exitCode).toBe(0);
  });

  test("microtasks should not drain during spawnSync", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        queueMicrotask(() => {
          console.log("MICROTASK_FIRED");
          process.exit(1);  
        });

        // Run a subprocess synchronously
        const result = Bun.spawnSync({
          cmd: ["${bunExe()}", "-e", "42"],
          env: process.env,
        });

        console.log("SUCCESS: Timer did not fire during spawnSync");
        process.exit(0);
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toContain("SUCCESS");
    expect(stdout).not.toContain("MICROTASK_FIRED");
    expect(stdout).not.toContain("FAIL");
    expect(exitCode).toBe(0);
  });

  test("stdin/stdout from main process should not be affected by spawnSync", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        // Write to stdout before spawnSync
        console.log("BEFORE");

        // Run a subprocess synchronously
        const result = Bun.spawnSync({
          cmd: ["echo", "SUBPROCESS"],
          env: process.env,
        });

        // Write to stdout after spawnSync
        console.log("AFTER");

        // Verify subprocess output
        const subprocessOut = new TextDecoder().decode(result.stdout);
        if (!subprocessOut.includes("SUBPROCESS")) {
          console.log("FAIL: Subprocess output missing");
          process.exit(1);
        }

        console.log("SUCCESS");
        process.exit(0);
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toContain("BEFORE");
    expect(stdout).toContain("AFTER");
    expect(stdout).toContain("SUCCESS");
    expect(exitCode).toBe(0);
  });

  test("multiple spawnSync calls should each use isolated event loop", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let timerCount = 0;

        // Set timers that should NOT fire during spawnSync
        setTimeout(() => { timerCount++; }, 10);
        setTimeout(() => { timerCount++; }, 20);
        setTimeout(() => { timerCount++; }, 30);

        // Run multiple subprocesses synchronously
        for (let i = 0; i < 3; i++) {
          const result = Bun.spawnSync({
            cmd: ["${bunExe()}", "-e", "Bun.sleepSync(50)"],
          });

          if (timerCount > 0) {
            console.log(\`FAIL: Timer fired during spawnSync iteration \${i}\`);
            process.exit(1);
          }
        }

        console.log("SUCCESS: No timers fired during any spawnSync call");
        process.exit();
      `,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toContain("SUCCESS");
    expect(stdout).not.toContain("FAIL");
    expect(exitCode).toBe(0);
  });
});

// While Bun.spawnSync waits, the VM's current uws loop is spawnSync's private
// loop. A ref taken on the main loop and released during the wait used to come
// off the private loop instead; once that loop's poll count reads 0 it is never
// polled again and spawnSync spins without ever seeing the child exit (CI
// workers stuck in spawnSync of a local bun child, #34069).
//
// JS only runs inside a spawnSync wait through the test runner's timeout path:
// when a test times out inside spawnSync after its callback left the stack, the
// runner carries on with the following tests right there. So in each fixture
// test `a` enters a spawnSync that its per-test timeout interrupts (bun test
// kills the dangling child, which lets the spawnSync return once its loop gets
// polled) and the following tests run inside the wait. That spawnSync holds
// exactly one poll on the private loop, so a single misdirected release in `b`
// makes `a` spin forever and this test time out. Not concurrent on purpose:
// bun test only kills a timed-out test's processes when the test is not in a
// concurrent group, and that is what cleans up a spinning inner `bun test`.
describe.skipIf(isWindows)("refs taken on the main loop and a spawnSync wait", () => {
  async function runFixture(setup: string, insideWait: string, extraTests = "") {
    using dir = tempDir("spawnsync-loop-refs", {
      "loop-refs.test.ts": `
        import { expect, test } from "bun:test";

        const cmd = (code: string) => [process.execPath, "-e", code];
        let aIsInsideSpawnSync = false;
        ${setup}

        test("a", async () => {
          await Bun.sleep(1);
          aIsInsideSpawnSync = true;
          Bun.spawnSync({ cmd: cmd("setTimeout(() => {}, 1e9)"), env: process.env, stdout: "ignore", stderr: "ignore" });
          aIsInsideSpawnSync = false;
        }, 1000);

        test("b", () => {
          expect(aIsInsideSpawnSync).toBe(true);
          ${insideWait}
        });

        ${extraTests}
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./loop-refs.test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { output: stdout + stderr, exitCode };
  }

  // One case per kind of ref, each released on its own. The child in the
  // FilePoll case exits by itself as a fallback, in case `b` never runs.
  test.each([
    ["a JS timer", `const timer = setTimeout(() => {}, 1e9);`, `clearTimeout(timer);`],
    [
      "a KeepAlive (Bun.serve)",
      `const server = Bun.serve({ port: 0, fetch: () => new Response() });`,
      `server.unref();`,
    ],
    [
      "a registered FilePoll (subprocess stdout)",
      `const child = Bun.spawn({ cmd: cmd("setTimeout(() => {}, 20_000)"), env: process.env, stdout: "pipe", stderr: "ignore" });`,
      `child.stdout.cancel(); child.kill();`,
    ],
    [
      "an event loop keep-alive ref (BroadcastChannel)",
      `const channel = new BroadcastChannel("spawnsync-loop-refs");`,
      `channel.unref();`,
    ],
  ])("%s released during the wait comes off the main loop", async (_, setup, release) => {
    const { output, exitCode } = await runFixture(setup, release);

    // `a` is the deliberate casualty; `b` passing and the process exiting are
    // the assertions.
    expect(output).toContain("(fail) a");
    expect(output).toContain("(pass) b");
    expect(output).toContain(" 1 pass");
    expect(output).toContain(" 1 fail");
    expect(exitCode).toBe(1);
  });

  // A spawnSync nested inside the wait (what the runner's timeout path does
  // whenever a following test spawns something) has to leave the main loop as
  // the current loop once the outer spawnSync returns too: the saved "previous
  // loop" used to be a single slot that the nested call overwrote. `c` starts
  // inside the wait like `b`, but its await can only complete once `a`'s
  // spawnSync has returned and the loop being polled is the main loop, where
  // the child's pidfd is registered.
  test("a spawnSync nested inside the wait restores the main loop afterwards", async () => {
    const { output, exitCode } = await runFixture(
      `const child = Bun.spawn({ cmd: cmd("setTimeout(() => {}, 20_000)"), env: process.env, stdout: "ignore", stderr: "ignore" });`,
      `
        const nested = Bun.spawnSync({ cmd: cmd("console.log('nested')"), env: process.env, stdout: "pipe", stderr: "pipe" });
        expect(nested.stdout.toString()).toBe("nested\\n");
      `,
      `
        test("c", async () => {
          child.kill();
          await child.exited;
          expect(aIsInsideSpawnSync).toBe(false);
        });
      `,
    );

    expect(output).toContain("(fail) a");
    expect(output).toContain("(pass) b");
    expect(output).toContain("(pass) c");
    expect(output).toContain(" 2 pass");
    expect(output).toContain(" 1 fail");
    expect(exitCode).toBe(1);
  });
});
