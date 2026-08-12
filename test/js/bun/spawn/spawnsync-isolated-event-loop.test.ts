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

  // While spawnSync waits, the VM's "current" uws loop is spawnSync's private
  // loop. Event-loop refs that were taken on the main loop (JS timers, fs.watch
  // and every other KeepAlive, registered FilePolls) and then released during
  // that wait used to be subtracted from the private loop instead, so its
  // num_polls could read 0 while a child's pidfd was still registered. Once that
  // happens us_loop_run_bun_tick returns without polling and spawnSync spins
  // forever, never observing the exit (seen in CI as `bun test --parallel`
  // workers stuck in spawnSync of a local bun child until the batch is killed).
  //
  // The test runner's timeout path is the one place that runs JS inside a
  // spawnSync wait: when a test whose callback is no longer on the stack times
  // out inside spawnSync, the runner carries on with the following tests right
  // there. Test `a` gets the runner into that state, `b` releases four main-loop
  // refs while the private loop is current, and `c` runs a spawnSync that needs
  // the private loop to actually poll.
  //
  // Arithmetic on an unfixed build: `a`'s pipeless spawnSync holds one poll on
  // the private loop (the child's pidfd), `b` wrongly subtracts 4 (1 for the
  // last JS timer going away, 3 for the watchers), `c` adds 3 (pidfd + two
  // pipes) => 0, so `c` spins without ever reading the child's output or
  // noticing its exit until a timeout (bun test's per-test timeout, or the
  // `timeout` option) fires inside the spin; closing the two pipe readers then
  // makes the count non-zero, the loop finally polls, and `c` comes back with
  // empty stdout after several seconds and fails. Fixed, the refs come off the
  // main loop and `c` completes normally.
  test.skipIf(isWindows)("refs released during a spawnSync wait come off the loop they were taken on", async () => {
    using dir = tempDir("spawnsync-loop-refs", {
      "loop-refs.test.ts": `
        import { expect, test } from "bun:test";
        import { watch } from "node:fs";

        const cmd = (code: string) => [process.execPath, "-e", code];
        let timer: ReturnType<typeof setTimeout>;
        const watchers: ReturnType<typeof watch>[] = [];
        let aIsInsideSpawnSync = false;

        // The per-test timeout is the mechanism here: it has to fire while
        // spawnSync is waiting and after the callback has left the stack.
        test("a", async () => {
          timer = setTimeout(() => {}, 1e9);
          for (let i = 0; i < 3; i++) watchers.push(watch(import.meta.dir));
          await Bun.sleep(1);
          aIsInsideSpawnSync = true;
          Bun.spawnSync({ cmd: cmd("setTimeout(() => {}, 1e9)"), env: process.env, stdout: "ignore", stderr: "ignore" });
          aIsInsideSpawnSync = false;
        }, 1000);

        test("b", () => {
          expect(aIsInsideSpawnSync).toBe(true);
          clearTimeout(timer);
          for (const w of watchers) w.unref();
        });

        test("c", () => {
          expect(aIsInsideSpawnSync).toBe(true);
          const result = Bun.spawnSync({
            cmd: cmd("console.log('from c')"),
            env: process.env,
            stdout: "pipe",
            stderr: "pipe",
            timeout: 10_000,
          });
          expect({
            exitedDueToTimeout: result.exitedDueToTimeout,
            exitCode: result.exitCode,
            stdout: result.stdout.toString(),
          }).toEqual({ exitedDueToTimeout: false, exitCode: 0, stdout: "from c\\n" });
        });
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
    const output = stdout + stderr;

    // `a` is the deliberate casualty; `b` and `c` are the assertions.
    expect(output).toContain("(fail) a");
    expect(output).toContain("(pass) b");
    expect(output).toContain("(pass) c");
    expect(output).toContain(" 2 pass");
    expect(output).toContain(" 1 fail");
    expect(exitCode).toBe(1);
  });
});
