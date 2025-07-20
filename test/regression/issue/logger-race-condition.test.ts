import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

test("package manager logger race condition fix", async () => {
  // This test verifies that the logger race condition is fixed
  // by attempting to trigger simultaneous package installation tasks
  // that would previously cause a segmentation fault
  
  const dir = tempDirWithFiles("logger-race-test", {
    "package.json": JSON.stringify({
      name: "test-race-condition",
      version: "1.0.0",
      dependencies: {
        // Multiple small packages to trigger concurrent tasks
        "is-array": "1.0.1",
        "is-string": "1.0.4", 
        "is-number": "7.0.0",
        "is-boolean": "1.0.1",
        "is-function": "1.0.1",
        "is-object": "1.0.1",
        "is-regexp": "1.0.0",
        "is-date": "1.0.1"
      }
    })
  });

  // Run install multiple times to increase chance of hitting race condition
  for (let i = 0; i < 3; i++) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: bunEnv,
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(), 
      proc.exited
    ]);

    // The main assertion is that bun doesn't crash with a segfault
    // If the race condition exists, this would likely fail
    expect(exitCode).toBe(0);
    
    // Clean up node_modules for next iteration
    await using rmProc = Bun.spawn({
      cmd: ["rm", "-rf", "node_modules"],
      cwd: dir
    });
    await rmProc.exited;
  }
}, { timeout: 30000 });