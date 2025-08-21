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

    // Wait for autokill to take effect
    await Bun.sleep(200);

    // Verify child process is dead
    let alive = false;
    try {
      process.kill(childPid, 0);
      alive = true;
      process.kill(childPid, "SIGKILL");
    } catch {
      // Expected - process should be dead
    }

    expect(alive).toBe(false);
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

    // Wait for autokill to take effect
    await Bun.sleep(200);

    // Verify all child processes are dead
    let aliveCount = 0;
    for (const pid of childPids) {
      try {
        process.kill(pid, 0);
        aliveCount++;
        process.kill(pid, "SIGKILL");
      } catch {
        // Expected - process should be dead
      }
    }

    expect(aliveCount).toBe(0);
  });

  test("autokill handles nested processes (shell with background job)", async () => {
    const dir = tempDirWithFiles("autokill-shell", {
      "shell_bg.js": `
        const { spawn } = require('child_process');
        
        // Spawn a shell with background sleep
        const shell = spawn('sh', ['-c', 'sleep 30 &']);
        console.log(shell.pid);
        
        setTimeout(() => process.exit(0), 50);
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

  test("autokill handles deeply nested process tree", async () => {
    const dir = tempDirWithFiles("autokill-deep", {
      "deep_tree.js": `
        const { spawn } = require('child_process');
        
        // Create a 3-level deep process tree
        const level1 = spawn('sh', ['-c', 'sh -c "sleep 30" &']);
        console.log(level1.pid);
        
        setTimeout(() => process.exit(0), 100);
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
    
    const level1Pid = parseInt(output.trim());
    expect(level1Pid).toBeGreaterThan(0);

    // Wait for autokill to take effect
    await Bun.sleep(300);

    // Verify level1 process is dead
    let alive = false;
    try {
      process.kill(level1Pid, 0);
      alive = true;
      process.kill(level1Pid, "SIGKILL");
    } catch {
      // Expected - process should be dead
    }

    expect(alive).toBe(false);
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
        exec('sleep 30');
        
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
    expect(pids.length).toBe(2);

    // Wait for autokill to take effect
    await Bun.sleep(300);

    // Verify tracked processes are dead
    let aliveCount = 0;
    for (const pid of pids) {
      try {
        process.kill(pid, 0);
        aliveCount++;
        process.kill(pid, "SIGKILL");
      } catch {
        // Expected - process should be dead
      }
    }

    expect(aliveCount).toBe(0);
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

    // Wait for autokill to take effect
    await Bun.sleep(200);

    // Verify child was killed despite the crash
    let alive = false;
    try {
      process.kill(childPid, 0);
      alive = true;
      process.kill(childPid, "SIGKILL");
    } catch {
      // Expected - process should be dead
    }

    expect(alive).toBe(false);
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

    // Wait for autokill to take effect
    await Bun.sleep(200);

    // Verify child was killed
    let alive = false;
    try {
      process.kill(childPid, 0);
      alive = true;
      process.kill(childPid, "SIGKILL");
    } catch {
      // Expected - process should be dead
    }

    expect(alive).toBe(false);
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

    // Wait for autokill to take effect
    await Bun.sleep(300);

    // Verify all rapidly spawned processes are dead
    let aliveCount = 0;
    for (const pid of pids) {
      try {
        process.kill(pid, 0);
        aliveCount++;
        process.kill(pid, "SIGKILL");
      } catch {
        // Expected - process should be dead
      }
    }

    expect(aliveCount).toBe(0);
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

    // Wait longer for autokill to handle concurrent spawning
    await Bun.sleep(500);

    // Verify spawner process is dead
    let alive = false;
    try {
      process.kill(spawnerPid, 0);
      alive = true;
      process.kill(spawnerPid, "SIGKILL");
    } catch {
      // Expected - process should be dead
    }

    expect(alive).toBe(false);
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
    
    const lines = output.trim().split('\n');
    const childPid = parseInt(lines[lines.length - 1]);
    expect(childPid).toBeGreaterThan(0);

    // Wait for autokill to take effect
    await Bun.sleep(200);

    // Verify child was killed despite signal handlers
    let alive = false;
    try {
      process.kill(childPid, 0);
      alive = true;
      process.kill(childPid, "SIGKILL");
    } catch {
      // Expected - process should be dead
    }

    expect(alive).toBe(false);
  });
});