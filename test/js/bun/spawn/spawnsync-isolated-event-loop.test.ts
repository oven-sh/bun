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

  // A GC that runs while spawnSync blocks finalizes objects whose polls live on
  // the main loop. If those polls are released against the isolated loop, its
  // poll count reaches zero while the next spawnSync still has live polls, and
  // that spawnSync spins without polling until its timeout.
  // BUN_JSC_slowPathAllocsBetweenGCs runs a full synchronous GC every few
  // slow-path allocations. A warmed-up spawnSync allocates nothing before it
  // installs the isolated loop, so the GC that frees the writers runs inside it.
  // The fixture also reports how many writers were collected by the time the
  // probe call returned. They are held by a global until the drop right before
  // that call, so a change that keeps them alive past the call, or stops the
  // GC from running in it, fails this test instead of passing it.
  // (bun:internal-for-testing or node:fs would give fd and sink counts, but
  // loading either module under this GC setting costs a debug build 5s to 15s.)
  test.skipIf(isWindows)("finalizers that run inside spawnSync do not stall the next spawnSync", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        // Three writers on stderr (a pipe here), each with a poll registered
        // on the main loop. They hang off globalThis: a binding that is only
        // written after the await below is dead at the suspension, and the
        // writers would already be collected in the warm-up call.
        globalThis.writers = [];
        const refs = [];
        for (let i = 0; i < 3; i++) {
          const writer = Bun.stderr.writer();
          writer.write("");
          writer.flush();
          globalThis.writers.push(writer);
          refs.push(new WeakRef(writer));
        }
        // A WeakRef keeps its target alive until the end of the job that
        // created it.
        await Bun.sleep(0);
        const first = { cmd: ["echo", "first"], stdout: "pipe", stderr: "ignore", timeout: 2000 };
        // pidfd + stdout + stderr: three polls, the same count the three
        // writers release. The child outlives the parent's poll registration,
        // so the parent has to poll for its exit.
        const second = { cmd: ["sh", "-c", "sleep 0.3; echo second"], stdout: "pipe", stderr: "pipe", timeout: 2000 };

        // Warm up while the writers are still reachable: lazy structures and
        // Bun.spawnSync itself are created here, on the main loop.
        Bun.spawnSync(first);
        globalThis.writers = null;
        // The first allocations after the drop are this call's result, built
        // while the isolated loop is installed: the GC they trigger frees the
        // writers there. Nothing may run between the drop and the call.
        Bun.spawnSync(first);
        // Read the refs before anything allocates: a GC here would change the answer.
        let collectedDuringCall = 0;
        for (let i = 0; i < refs.length; i++) if (refs[i].deref() === undefined) collectedDuringCall++;

        const result = Bun.spawnSync(second);
        console.log(
          JSON.stringify({
            collectedDuringCall,
            stdout: result.stdout.toString(),
            exitedDueToTimeout: result.exitedDueToTimeout,
            exitCode: result.exitCode,
          }),
        );
      `,
      ],
      env: { ...bunEnv, BUN_JSC_slowPathAllocsBetweenGCs: "5" },
      stdout: "pipe",
      stderr: "pipe",
    });

    // stderr is drained, not asserted: the child's JSON and exit code carry the signal.
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe(
      JSON.stringify({ collectedDuringCall: 3, stdout: "second\n", exitedDueToTimeout: false, exitCode: 0 }),
    );
    expect(exitCode).toBe(0);
  });
});
