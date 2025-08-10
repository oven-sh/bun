import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { join } from "path";
import { bunExe, tempDirWithFiles } from "harness";

describe("--autokill", () => {
  test("kills child processes on normal exit", async () => {
    const dir = tempDirWithFiles("autokill-test", {
      "parent.js": `
        const { spawn } = require('child_process');
        
        // Track child PIDs
        const childPids = [];
        
        // Spawn long-running child processes
        for (let i = 0; i < 3; i++) {
          const child = spawn('sleep', ['10']);
          childPids.push(child.pid);
        }
        
        // Output the PIDs for the test to verify
        console.log(JSON.stringify(childPids));
        
        // Exit after a short delay
        setTimeout(() => {
          process.exit(0);
        }, 100);
      `,
    });

    // Run without autokill first
    const withoutAutokill = spawn({
      cmd: [bunExe(), "parent.js"],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await withoutAutokill.stdout.text();
    await withoutAutokill.exited;
    
    const pids = JSON.parse(output.trim());
    expect(pids).toBeArray();
    expect(pids.length).toBe(3);

    // Wait a bit and check if processes are still running
    await Bun.sleep(200);
    
    // Check if any of the processes are still alive
    let aliveCount = 0;
    for (const pid of pids) {
      try {
        // kill(pid, 0) checks if process exists without killing it
        process.kill(pid, 0);
        aliveCount++;
        // Clean up the orphaned process
        process.kill(pid, "SIGKILL");
      } catch {
        // Process doesn't exist, which is what we want with autokill
      }
    }
    
    // Without autokill, processes should still be running
    expect(aliveCount).toBeGreaterThan(0);

    // Now test WITH autokill
    const withAutokill = spawn({
      cmd: [bunExe(), "--autokill", "parent.js"],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output2 = await withAutokill.stdout.text();
    await withAutokill.exited;
    
    const pids2 = JSON.parse(output2.trim());
    expect(pids2).toBeArray();
    expect(pids2.length).toBe(3);

    // Wait a bit and check if processes were killed
    await Bun.sleep(200);
    
    let aliveCount2 = 0;
    for (const pid of pids2) {
      try {
        process.kill(pid, 0);
        aliveCount2++;
        // Clean up if somehow still alive
        process.kill(pid, "SIGKILL");
      } catch {
        // Process doesn't exist - this is expected with autokill
      }
    }
    
    // With autokill, all child processes should be dead
    expect(aliveCount2).toBe(0);
  });

  test("kills nested child processes recursively", async () => {
    const dir = tempDirWithFiles("autokill-nested", {
      "parent.js": `
        const { spawn } = require('child_process');
        
        // Spawn a shell that stays alive with its children
        const shell = spawn('sh', ['-c', \`
          sleep 10 &
          GRANDCHILD=$!
          echo "CHILD:$$"
          echo "GRANDCHILD:$GRANDCHILD"
          wait
        \`]);
        
        shell.stdout.on('data', (data) => {
          process.stdout.write(data.toString());
        });
        
        setTimeout(() => {
          process.exit(0);
        }, 100);
      `,
    });

    const proc = spawn({
      cmd: [bunExe(), "--autokill", "parent.js"],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await proc.stdout.text();
    await proc.exited;
    
    // Parse PIDs from output
    const lines = output.trim().split('\n');
    const childPid = parseInt(lines.find(l => l.startsWith('CHILD:'))?.replace('CHILD:', '')?.trim() || '0');
    const grandchildPid = parseInt(lines.find(l => l.startsWith('GRANDCHILD:'))?.replace('GRANDCHILD:', '')?.trim() || '0');
    
    expect(childPid).toBeGreaterThan(0);
    expect(grandchildPid).toBeGreaterThan(0);

    // Wait a bit and verify both shell and grandchild sleep are killed
    await Bun.sleep(300);
    
    // Check if grandchild (sleep process) is dead
    let grandchildAlive = false;
    try {
      process.kill(grandchildPid, 0);
      grandchildAlive = true;
      process.kill(grandchildPid, "SIGKILL");
    } catch {
      // Expected - process should be dead
    }
    
    expect(grandchildAlive).toBe(false);
  });

  test("kills processes on abnormal exit", async () => {
    const dir = tempDirWithFiles("autokill-crash", {
      "crash.js": `
        const { spawn } = require('child_process');
        
        const child = spawn('sleep', ['10']);
        console.log(child.pid);
        
        // Cause an uncaught exception
        setTimeout(() => {
          throw new Error("Intentional crash");
        }, 100);
      `,
    });

    const proc = spawn({
      cmd: [bunExe(), "--autokill", "crash.js"],
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await proc.stdout.text();
    await proc.exited;
    
    const pid = parseInt(output.trim());
    expect(pid).toBeGreaterThan(0);

    // Wait a bit and verify the child was killed despite the crash
    await Bun.sleep(200);
    
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
      process.kill(pid, "SIGKILL");
    } catch {
      // Expected - process should be dead
    }
    
    expect(alive).toBe(false);
  });

  test("does not kill processes without --autokill flag", async () => {
    const dir = tempDirWithFiles("no-autokill", {
      "parent.js": `
        const { spawn } = require('child_process');
        
        const child = spawn('sleep', ['5']);
        console.log(child.pid);
        
        setTimeout(() => {
          process.exit(0);
        }, 100);
      `,
    });

    const proc = spawn({
      cmd: [bunExe(), "parent.js"], // No --autokill flag
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await proc.stdout.text();
    await proc.exited;
    
    const pid = parseInt(output.trim());
    expect(pid).toBeGreaterThan(0);

    // Wait a bit and verify the child is still running
    await Bun.sleep(200);
    
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
      // Clean up
      process.kill(pid, "SIGKILL");
    } catch {
      // Process is dead
    }
    
    // Without autokill, the child should still be alive
    expect(alive).toBe(true);
  });

  if (process.platform === "darwin") {
    test("works with various process types", async () => {
      const dir = tempDirWithFiles("autokill-various", {
        "various.js": `
          const { spawn, exec } = require('child_process');
          
          const pids = [];
          
          // Test with different process types
          const sleep = spawn('sleep', ['10']);
          pids.push(sleep.pid);
          
          const sh = spawn('sh', ['-c', 'sleep 10']);
          pids.push(sh.pid);
          
          exec('sleep 10', (err, stdout, stderr) => {});
          
          console.log(JSON.stringify(pids));
          
          setTimeout(() => {
            process.exit(0);
          }, 100);
        `,
      });

      const proc = spawn({
        cmd: [bunExe(), "--autokill", "various.js"],
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const output = await proc.stdout.text();
      await proc.exited;
      
      const pids = JSON.parse(output.trim());
      expect(pids.length).toBeGreaterThanOrEqual(2);

      // Wait and verify all are killed
      await Bun.sleep(200);
      
      let aliveCount = 0;
      for (const pid of pids) {
        if (pid) {
          try {
            process.kill(pid, 0);
            aliveCount++;
            process.kill(pid, "SIGKILL");
          } catch {
            // Expected - dead
          }
        }
      }
      
      expect(aliveCount).toBe(0);
    });
  }
});