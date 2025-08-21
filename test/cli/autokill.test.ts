import { describe, expect, test } from "bun:test";
import { bunExe, bunEnv, tempDirWithFiles } from "harness";

describe("--autokill", () => {
  test("basic autokill flag works", async () => {
    const dir = tempDirWithFiles("autokill-basic", {
      "simple.js": `
        console.log("Hello from autokill test");
        process.exit(0);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--autokill", "simple.js"],
      cwd: dir,
      env: bunEnv,
    });

    const [output, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(output.trim()).toBe("Hello from autokill test");
  });

  test("autokill flag kills child processes", async () => {
    const dir = tempDirWithFiles("autokill-children", {
      "spawn_children.js": `
        const { spawn } = require('child_process');
        
        // Spawn long-running child processes
        const children = [];
        for (let i = 0; i < 2; i++) {
          const child = spawn('sleep', ['30']);
          children.push(child.pid);
        }
        
        // Output PIDs so test can verify they get killed
        console.log(JSON.stringify(children));
        
        // Exit quickly
        setTimeout(() => process.exit(0), 50);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--autokill", "spawn_children.js"],
      cwd: dir,
      env: bunEnv,
    });

    const [output, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    
    const childPids = JSON.parse(output.trim());
    expect(childPids).toBeArray();
    expect(childPids.length).toBe(2);

    // Wait for autokill to take effect
    await Bun.sleep(200);

    // Verify all child processes are dead
    let aliveCount = 0;
    for (const pid of childPids) {
      try {
        // This will throw if process doesn't exist
        process.kill(pid, 0);
        aliveCount++;
        // Clean up if somehow still alive
        process.kill(pid, "SIGKILL");
      } catch {
        // Expected - process should be dead
      }
    }

    expect(aliveCount).toBe(0);
  });

  test("without autokill flag, child processes remain alive", async () => {
    const dir = tempDirWithFiles("no-autokill", {
      "spawn_child.js": `
        const { spawn } = require('child_process');
        
        const child = spawn('sleep', ['5']);
        console.log(child.pid);
        
        // Exit quickly without waiting for child
        setTimeout(() => process.exit(0), 50);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "spawn_child.js"], // No --autokill flag
      cwd: dir,
      env: bunEnv,
    });

    const [output, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    
    const childPid = parseInt(output.trim());
    expect(childPid).toBeGreaterThan(0);

    // Without autokill, child should still be alive briefly
    await Bun.sleep(100);
    
    let alive = false;
    try {
      process.kill(childPid, 0);
      alive = true;
      // Clean up
      process.kill(childPid, "SIGKILL");
    } catch {
      // Process might have exited naturally
    }

    // Without autokill, the child should have been alive (at least initially)
    // Note: This is a bit racy but should be reliable enough for testing
    expect(alive).toBe(true);
  });

  test("autokill handles nested processes", async () => {
    const dir = tempDirWithFiles("autokill-nested", {
      "nested.js": `
        const { spawn } = require('child_process');
        
        // Spawn a shell that creates a grandchild
        const shell = spawn('sh', ['-c', 'sleep 30 & wait']);
        console.log(shell.pid);
        
        setTimeout(() => process.exit(0), 50);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--autokill", "nested.js"],
      cwd: dir,
      env: bunEnv,
    });

    const [output, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    
    const shellPid = parseInt(output.trim());
    expect(shellPid).toBeGreaterThan(0);

    // Wait for autokill to take effect
    await Bun.sleep(300);

    // Verify shell process is dead
    let shellAlive = false;
    try {
      process.kill(shellPid, 0);
      shellAlive = true;
      process.kill(shellPid, "SIGKILL");
    } catch {
      // Expected - process should be dead
    }

    expect(shellAlive).toBe(false);
  });
});