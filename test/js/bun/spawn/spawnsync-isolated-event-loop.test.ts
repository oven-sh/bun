import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows } from "harness";

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

  // A GC that runs while spawnSync blocks finalizes objects whose polls live on
  // the main loop. If those polls are released against the isolated loop, its
  // poll count reaches zero while the next spawnSync still has live polls, and
  // that spawnSync spins without polling until its timeout.
  // BUN_INTERNAL_SPAWN_SYNC_GC (debug builds) forces such a GC.
  test.skipIf(!isDebug || isWindows)(
    "finalizers that run inside spawnSync do not stall the next spawnSync",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          // Three writers on stderr (a pipe here), each with a poll registered
          // on the main loop, with nothing left that references them.
          function leakWriters() {
            for (let i = 0; i < 3; i++) {
              const writer = Bun.stderr.writer();
              writer.write("");
              writer.flush();
            }
          }
          leakWriters();

          // The GC at the end of this call finalizes the three writers.
          Bun.spawnSync({ cmd: ["echo", "first"], stdout: "pipe", stderr: "ignore" });

          // pidfd + stdout + stderr: three polls, the same count the three
          // writers released.
          const result = Bun.spawnSync({
            cmd: ["echo", "second"],
            stdout: "pipe",
            stderr: "pipe",
            timeout: 5000,
          });
          console.log(
            JSON.stringify({
              stdout: result.stdout.toString(),
              exitedDueToTimeout: result.exitedDueToTimeout,
              exitCode: result.exitCode,
            }),
          );
        `,
        ],
        env: { ...bunEnv, BUN_INTERNAL_SPAWN_SYNC_GC: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });

      // stderr is drained, not asserted: the child's JSON and exit code carry the signal.
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim()).toBe(JSON.stringify({ stdout: "second\n", exitedDueToTimeout: false, exitCode: 0 }));
      expect(exitCode).toBe(0);
    },
  );
});
