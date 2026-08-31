import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
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
});
