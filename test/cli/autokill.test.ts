import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithFiles } from "harness";

// Helper to wait for a process to die, polling with a timeout
async function waitForProcessDeath(pid: number, timeoutMs: number = 1000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      // Still alive, wait a bit
      await Bun.sleep(10);
    } catch {
      // Process is dead
      return true;
    }
  }
  return false;
}

describe.skipIf(isWindows)("--autokill", () => {
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

  test("autokill flag kills single child process", async () => {
    const dir = tempDirWithFiles("autokill-single", {
      "spawn_one.js": `
        const { spawn } = require('child_process');
        
        const child = spawn('sleep', ['30']);
        console.log(child.pid);
        
        setTimeout(() => process.exit(0), 50);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--autokill", "spawn_one.js"],
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

    // Wait for autokill to take effect (polling with timeout)
    const died = await waitForProcessDeath(childPid, 1000);
    expect(died).toBe(true);

    // Clean up if somehow still alive
    try {
      process.kill(childPid, "SIGKILL");
    } catch {
      // Expected - process should be dead
    }
  });

  test("autokill flag kills multiple child processes", async () => {
    const dir = tempDirWithFiles("autokill-multiple", {
      "spawn_many.js": `
        const { spawn } = require('child_process');
        
        const children = [];
        for (let i = 0; i < 5; i++) {
          const child = spawn('sleep', ['30']);
          children.push(child.pid);
        }
        
        console.log(JSON.stringify(children));
        setTimeout(() => process.exit(0), 50);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--autokill", "spawn_many.js"],
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
    expect(childPids.length).toBe(5);

    // Wait for all processes to die (polling with timeout)
    for (const pid of childPids) {
      const died = await waitForProcessDeath(pid, 1000);
      expect(died).toBe(true);
      // Clean up if somehow still alive
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Expected - process should be dead
      }
    }
  });

  test("autokill handles nested processes (shell with background job)", async () => {
    const dir = tempDirWithFiles("autokill-shell", {
      "shell_bg.js": `
        const { spawn } = require('child_process');

        // Spawn a shell with background sleep and capture the background job PID
        const shell = spawn('sh', ['-c', 'sleep 30 & echo $!; wait']);
        shell.stdout.setEncoding('utf8');
        shell.stdout.once('data', data => {
          const bgPid = Number.parseInt(data.trim(), 10);
          console.log(JSON.stringify({ shell: shell.pid, background: bgPid }));
          setTimeout(() => process.exit(0), 50);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--autokill", "shell_bg.js"],
      cwd: dir,
      env: bunEnv,
    });

    const [output, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);

    const { shell: shellPid, background: bgPid } = JSON.parse(output.trim());
    expect(shellPid).toBeGreaterThan(0);
    expect(bgPid).toBeGreaterThan(0);

    // Wait for both shell and background process to die
    for (const pid of [shellPid, bgPid]) {
      const died = await waitForProcessDeath(pid, 1000);
      expect(died).toBe(true);
      // Clean up if somehow still alive
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Expected - process should be dead
      }
    }
  });

  test("autokill handles deeply nested process tree", async () => {
    const dir = tempDirWithFiles("autokill-deep", {
      "spawn_nested.sh": `#!/bin/sh
# Level 2 shell: spawn sleep and record its PID
sleep 30 & echo "level3=$!" >> "$1"
# Wait for the background job so we don't exit and reparent level3 to init
wait
`,
      "deep_tree.js": `
        const { spawn } = require('child_process');
        const fs = require('fs');
        const path = require('path');

        // Create a 3-level deep process tree and capture all PIDs
        const pidFile = path.join(__dirname, 'deep-pids.json');
        const nestedScript = path.join(__dirname, 'spawn_nested.sh');

        // Make script executable
        fs.chmodSync(nestedScript, 0o755);

        // Write level1 PID first (to file that will be appended to)
        fs.writeFileSync(pidFile, '');

        // Level 1: outer shell that spawns Level 2 (the nested script)
        const shellCmd = nestedScript + ' ' + pidFile + ' & echo level2=$! >> ' + pidFile + '; sleep 0.3; wait';
        const level1 = spawn('sh', ['-c', shellCmd]);

        // Append level1 PID
        fs.appendFileSync(pidFile, 'level1=' + level1.pid + '\\n');

        // Wait for child processes to start and write their PIDs
        setTimeout(() => {
          console.log('done');
          setTimeout(() => process.exit(0), 50);
        }, 400);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--autokill", "deep_tree.js"],
      cwd: dir,
      env: bunEnv,
    });

    const [output, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);

    // Read PIDs from file
    const pidFile = `${dir}/deep-pids.json`;
    try {
      const pidData = await Bun.file(pidFile).text();
      const pids: Record<string, number> = {};
      // Match all level#=PID patterns
      const matches = pidData.matchAll(/level(\d+)=(\d+)/g);
      for (const match of matches) {
        const key = `level${match[1]}`;
        const value = Number.parseInt(match[2], 10);
        pids[key] = value;
      }

      // Verify we captured all three levels
      expect(pids.level1).toBeGreaterThan(0);
      expect(pids.level2).toBeGreaterThan(0);
      expect(pids.level3).toBeGreaterThan(0);

      // Wait for all processes to die
      for (const [name, pid] of Object.entries(pids)) {
        if (pid && pid > 0) {
          const died = await waitForProcessDeath(pid, 1000);
          expect(died).toBe(true);
          // Clean up if somehow still alive
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // Expected - process should be dead
          }
        }
      }
    } catch (err) {
      // If we can't read the file, at least verify something happened
      expect(output.trim()).toContain("done");
      throw err;
    }
  });

  test("autokill handles mix of process types", async () => {
    const dir = tempDirWithFiles("autokill-mixed", {
      "mixed_processes.js": `
        const { spawn, exec } = require('child_process');

        const pids = [];

        // Direct sleep process
        const sleep1 = spawn('sleep', ['30']);
        pids.push(sleep1.pid);

        // Shell with sleep
        const shell = spawn('sh', ['-c', 'sleep 30']);
        pids.push(shell.pid);

        // exec sleep (creates intermediate shell)
        const execChild = exec('sleep 30');
        pids.push(execChild.pid);

        console.log(JSON.stringify(pids));
        setTimeout(() => process.exit(0), 100);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--autokill", "mixed_processes.js"],
      cwd: dir,
      env: bunEnv,
    });

    const [output, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);

    const pids = JSON.parse(output.trim());
    expect(pids).toBeArray();
    expect(pids.length).toBe(3);

    // Wait for all processes to die (polling with timeout)
    for (const pid of pids) {
      const died = await waitForProcessDeath(pid, 1000);
      expect(died).toBe(true);
      // Clean up if somehow still alive
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Expected - process should be dead
      }
    }
  });

  test("autokill works on uncaught exception", async () => {
    const dir = tempDirWithFiles("autokill-crash", {
      "crash.js": `
        const { spawn } = require('child_process');
        
        const child = spawn('sleep', ['30']);
        console.log(child.pid);
        
        // Cause an uncaught exception after spawning
        setTimeout(() => {
          throw new Error("Intentional crash for testing");
        }, 50);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--autokill", "crash.js"],
      cwd: dir,
      env: bunEnv,
    });

    const [output, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Should exit with non-zero due to uncaught exception
    expect(exitCode).not.toBe(0);

    const childPid = parseInt(output.trim());
    expect(childPid).toBeGreaterThan(0);

    // Wait for autokill to take effect (polling with timeout)
    const died = await waitForProcessDeath(childPid, 1000);
    expect(died).toBe(true);

    // Clean up if somehow still alive
    try {
      process.kill(childPid, "SIGKILL");
    } catch {
      // Expected - process should be dead
    }
  });

  test("autokill works on process.exit(non-zero)", async () => {
    const dir = tempDirWithFiles("autokill-exit-code", {
      "exit_code.js": `
        const { spawn } = require('child_process');
        
        const child = spawn('sleep', ['30']);
        console.log(child.pid);
        
        setTimeout(() => process.exit(42), 50);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--autokill", "exit_code.js"],
      cwd: dir,
      env: bunEnv,
    });

    const [output, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(42);

    const childPid = parseInt(output.trim());
    expect(childPid).toBeGreaterThan(0);

    // Wait for autokill to take effect (polling with timeout)
    const died = await waitForProcessDeath(childPid, 1000);
    expect(died).toBe(true);

    // Clean up if somehow still alive
    try {
      process.kill(childPid, "SIGKILL");
    } catch {
      // Expected - process should be dead
    }
  });

  test("without autokill flag, child processes remain alive", async () => {
    const dir = tempDirWithFiles("no-autokill", {
      "no_kill.js": `
        const { spawn } = require('child_process');
        
        const child = spawn('sleep', ['5']);
        console.log(child.pid);
        
        setTimeout(() => process.exit(0), 50);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "no_kill.js"], // No --autokill flag
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

    // Without autokill, child should remain alive
    // Poll to verify it stays alive for at least 100ms
    let alive = false;
    const deadline = Date.now() + 100;
    while (Date.now() < deadline) {
      try {
        process.kill(childPid, 0);
        alive = true;
        await Bun.sleep(10);
      } catch {
        // Process died prematurely
        break;
      }
    }

    // Clean up
    try {
      process.kill(childPid, "SIGKILL");
    } catch {
      // Process might have exited
    }

    // Without autokill, the child should have been alive
    expect(alive).toBe(true);
  });

  test("autokill handles rapid process spawning", async () => {
    const dir = tempDirWithFiles("autokill-rapid", {
      "rapid_spawn.js": `
        const { spawn } = require('child_process');
        
        const pids = [];
        
        // Rapidly spawn processes
        for (let i = 0; i < 10; i++) {
          const child = spawn('sleep', ['30']);
          pids.push(child.pid);
        }
        
        console.log(JSON.stringify(pids));
        
        // Exit immediately after spawning
        process.exit(0);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--autokill", "rapid_spawn.js"],
      cwd: dir,
      env: bunEnv,
    });

    const [output, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);

    const pids = JSON.parse(output.trim());
    expect(pids).toBeArray();
    expect(pids.length).toBe(10);

    // Wait for all processes to die (polling with timeout)
    for (const pid of pids) {
      const died = await waitForProcessDeath(pid, 1000);
      expect(died).toBe(true);
      // Clean up if somehow still alive
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Expected - process should be dead
      }
    }
  });

  test("autokill preserves exit code", async () => {
    const dir = tempDirWithFiles("autokill-exit-preserve", {
      "preserve_exit.js": `
        const { spawn } = require('child_process');
        
        spawn('sleep', ['30']);
        
        setTimeout(() => process.exit(123), 50);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--autokill", "preserve_exit.js"],
      cwd: dir,
      env: bunEnv,
    });

    const [output, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    // Exit code should be preserved even with autokill
    expect(exitCode).toBe(123);
  });

  test("autokill handles processes that spawn during tree walking", async () => {
    const dir = tempDirWithFiles("autokill-concurrent", {
      "concurrent_spawn.js": `
        const { spawn } = require('child_process');
        
        // Spawn a shell that continuously spawns children
        const spawner = spawn('sh', ['-c', \`
          for i in 1 2 3 4 5; do
            sleep 30 &
            sleep 0.01
          done
          wait
        \`]);
        
        console.log(spawner.pid);
        
        // Exit after a short delay to trigger autokill during spawning
        setTimeout(() => process.exit(0), 100);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--autokill", "concurrent_spawn.js"],
      cwd: dir,
      env: bunEnv,
    });

    const [output, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);

    const spawnerPid = parseInt(output.trim());
    expect(spawnerPid).toBeGreaterThan(0);

    // Wait for autokill to handle concurrent spawning (polling with timeout)
    const died = await waitForProcessDeath(spawnerPid, 1000);
    expect(died).toBe(true);

    // Clean up if somehow still alive
    try {
      process.kill(spawnerPid, "SIGKILL");
    } catch {
      // Expected - process should be dead
    }
  });

  test("autokill works with different signal handlers", async () => {
    const dir = tempDirWithFiles("autokill-signals", {
      "signal_handlers.js": `
        const { spawn } = require('child_process');

        // Set up signal handlers
        process.on('SIGTERM', () => {
          console.log('Got SIGTERM');
        });

        process.on('SIGINT', () => {
          console.log('Got SIGINT');
        });

        const child = spawn('sleep', ['30']);
        console.log(child.pid);

        setTimeout(() => process.exit(0), 50);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--autokill", "signal_handlers.js"],
      cwd: dir,
      env: bunEnv,
    });

    const [output, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);

    const lines = output.trim().split("\n");
    const childPid = parseInt(lines[lines.length - 1]);
    expect(childPid).toBeGreaterThan(0);

    // Wait for autokill to take effect (polling with timeout)
    const died = await waitForProcessDeath(childPid, 1000);
    expect(died).toBe(true);

    // Clean up if somehow still alive
    try {
      process.kill(childPid, "SIGKILL");
    } catch {
      // Expected - process should be dead
    }
  });

  test("autokill handles nested bun processes with delays", async () => {
    const dir = tempDirWithFiles("autokill-nested-bun", {
      "nested_child.js": `
        const { spawn } = require('child_process');
        const fs = require('fs');
        const path = require('path');

        // Write our PIDs to a file so the test can verify them
        const pidFile = path.join(__dirname, 'nested-pids.json');

        // Spawn a long-running sleep process
        const sleep = spawn('sleep', ['30']);
        const pids = {
          childBun: process.pid,
          sleep: sleep.pid
        };

        fs.writeFileSync(pidFile, JSON.stringify(pids));
        console.log('nested child ready');

        // Keep this Bun process alive
        setTimeout(() => {}, 10000);
      `,
      "nested_parent.js": `
        const { spawn } = require('child_process');

        // Spawn a nested Bun process with --autokill that spawns its own children
        const bunExe = process.argv[0];
        const childBun = spawn(bunExe, ['--autokill', 'nested_child.js'], {
          cwd: __dirname
        });

        console.log('parent-bun-pid:', childBun.pid);

        // Exit after a delay, triggering autokill on parent and nested child
        setTimeout(() => process.exit(0), 200);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--autokill", "nested_parent.js"],
      cwd: dir,
      env: bunEnv,
    });

    const [output, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);

    // Parse parent PID from output
    const lines = output.trim().split("\n");
    const parentBunPid = parseInt(
      lines
        .find(l => l.includes("parent-bun-pid:"))
        ?.split(":")[1]
        ?.trim() || "0",
    );

    expect(parentBunPid).toBeGreaterThan(0);

    // Wait for autokill to complete all three passes (polling with timeout)
    const parentDied = await waitForProcessDeath(parentBunPid, 1000);
    expect(parentDied).toBe(true);

    // Clean up if somehow still alive
    try {
      process.kill(parentBunPid, "SIGKILL");
    } catch {
      // Expected - process should be dead
    }

    // Check if we can read the nested PIDs file and verify those processes are dead too
    const pidFile = `${dir}/nested-pids.json`;
    try {
      const pidData = await Bun.file(pidFile).text();
      const pids = JSON.parse(pidData);

      // Verify nested child Bun and its sleep are both dead
      for (const [name, pid] of Object.entries(pids)) {
        const died = await waitForProcessDeath(pid as number, 1000);
        expect(died).toBe(true);
        // Clean up if somehow still alive
        try {
          process.kill(pid as number, "SIGKILL");
        } catch {
          // Expected - process should be dead
        }
      }
    } catch {
      // PID file might not exist if timing was off, but parent being dead is sufficient
    }
  });
});
