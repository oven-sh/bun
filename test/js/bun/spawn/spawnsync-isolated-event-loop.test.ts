import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";

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

  test("GC finishing inside spawnSync does not move the main loop's keep-alive count", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "spawnSync-keepalive-gc-fixture.js")],
      // collectContinuously makes a collection reliably end inside spawnSync.
      env: { ...bunEnv, BUN_JSC_collectContinuously: "1" },
      stderr: "inherit",
      stdout: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toBe("OK\n");
    expect(exitCode).toBe(0);
  });

  test("spawnSync under GC pressure with a worker and a server keeps the main loop balanced and exits", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "spawnSync-keepalive-stress-fixture.js")],
      env: { ...bunEnv, BUN_JSC_collectContinuously: "1" },
      stderr: "inherit",
      stdout: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toBe("OK\n");
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

  // What a garbage collection finalizes while spawnSync waits belongs to the thread's loop, not to the one spawnSync
  // waits on. Released there, three polls brought that loop's count to zero for the three polls of the next call
  // (process, stdout, stderr), which then never polled: it spun until its timeout and lost the child's output.
  // BUN_JSC_slowPathAllocsBetweenGCs collects every few slow-path allocations. maxBuffer is the last option spawnSync
  // reads, so the collection that follows the drop runs once it is past them. Bun.gc() leaves every free list empty,
  // so what it allocates from there on takes the slow path, whatever ran before.
  test.skipIf(isWindows)("what is finalized during spawnSync is released on the thread's loop", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        // stderr is a pipe here, so each writer registers a poll. On globalThis: a binding that is only
        // written after the await is dead across it.
        globalThis.writers = [];
        const refs = [];
        for (let i = 0; i < 3; i++) {
          const writer = Bun.stderr.writer();
          writer.write("");
          writer.flush();
          globalThis.writers.push(writer);
          refs.push(new WeakRef(writer));
        }
        // A WeakRef keeps its target alive until the job that made it ends.
        await Bun.sleep(0);
        Bun.spawnSync({
          cmd: ["true"],
          stdout: "pipe",
          stderr: "ignore",
          get maxBuffer() { Bun.gc(true); globalThis.writers = null; },
        });
        let collectedDuringCall = 0;
        for (const ref of refs) if (ref.deref() === undefined) collectedDuringCall++;
        // The child outlives the registration of its polls, so the call has to poll for it.
        const { stdout, exitedDueToTimeout } = Bun.spawnSync({
          cmd: ["sh", "-c", "sleep 0.1; echo polled"],
          stdout: "pipe",
          stderr: "pipe",
          timeout: 2000,
        });
        console.log(JSON.stringify({ collectedDuringCall, stdout: stdout.toString(), exitedDueToTimeout }));
      `,
      ],
      env: { ...bunEnv, BUN_JSC_slowPathAllocsBetweenGCs: "3" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({
      stdout: JSON.stringify({ collectedDuringCall: 3, stdout: "polled\n", exitedDueToTimeout: false }),
      exitCode: 0,
    });
  });
});
