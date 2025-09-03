import { spawn } from "child_process";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for issue #13911
// https://github.com/oven-sh/bun/issues/13911
// Bun would fail silently when spawning processes with inherited stdio in Docker containers

test("parallel spawn with inherited stdio should handle errors properly", async () => {
  // Test that parallel spawns with inherited stdio work correctly
  const results = await Promise.allSettled([
    new Promise((resolve, reject) => {
      const proc = spawn(bunExe(), ["--version"], {
        stdio: "inherit",
        env: bunEnv,
      });
      proc.on("close", code => {
        if (code === 0) resolve(code);
        else reject(new Error(`Exit code ${code}`));
      });
      proc.on("error", reject);
    }),
    new Promise((resolve, reject) => {
      const proc = spawn(bunExe(), ["--version"], {
        stdio: "inherit", 
        env: bunEnv,
      });
      proc.on("close", code => {
        if (code === 0) resolve(code);
        else reject(new Error(`Exit code ${code}`));
      });
      proc.on("error", reject);
    }),
    new Promise((resolve, reject) => {
      const proc = spawn(bunExe(), ["--version"], {
        stdio: "inherit",
        env: bunEnv,
      });
      proc.on("close", code => {
        if (code === 0) resolve(code);
        else reject(new Error(`Exit code ${code}`));
      });
      proc.on("error", reject);
    }),
  ]);

  // All should succeed
  expect(results.every(r => r.status === "fulfilled")).toBe(true);
});

test("spawn with inherited stdio should properly report ENOENT errors", async () => {
  // Test that errors are properly propagated when command doesn't exist
  let errorReceived = false;
  let errorCode: string | undefined;

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("nonexistent-command-that-should-not-exist-12345", [], {
      stdio: "inherit",
      env: bunEnv,
    });

    proc.on("error", err => {
      errorReceived = true;
      errorCode = (err as any).code;
      resolve();
    });

    proc.on("close", code => {
      if (!errorReceived) {
        reject(new Error(`Process closed with code ${code} but no error event was emitted`));
      }
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      if (!errorReceived) {
        reject(new Error("Timeout: No error received for nonexistent command"));
      }
    }, 5000);
  });

  expect(errorReceived).toBe(true);
  expect(errorCode).toBe("ENOENT");
});

test("spawn with inherited stdio should handle exit codes correctly", async () => {
  // Test that exit codes are properly propagated
  const exitCode = await new Promise<number>((resolve, reject) => {
    const proc = spawn(bunExe(), ["-e", "process.exit(42)"], {
      stdio: "inherit",
      env: bunEnv,
    });

    proc.on("close", code => {
      resolve(code!);
    });

    proc.on("error", reject);
  });

  expect(exitCode).toBe(42);
});

test("multiple parallel spawns with mixed success/failure", async () => {
  // This simulates what qwik build does - running multiple commands in parallel
  const commands: [string, string[]][] = [
    [bunExe(), ["--version"]],
    ["nonexistent-cmd-xyz-123", []],
    [bunExe(), ["-e", "console.log('test')"]],
  ];

  const results = await Promise.allSettled(
    commands.map(([cmd, args]) => {
      return new Promise<string>((resolve, reject) => {
        const proc = spawn(cmd, args, {
          stdio: "inherit",
          env: bunEnv,
        });

        proc.on("close", code => {
          if (code === 0) {
            resolve("success");
          } else {
            reject(new Error(`Exit code ${code}`));
          }
        });

        proc.on("error", err => {
          reject(err);
        });
      });
    }),
  );

  // First command should succeed
  expect(results[0].status).toBe("fulfilled");
  
  // Second command should fail with ENOENT
  expect(results[1].status).toBe("rejected");
  const error = (results[1] as PromiseRejectedResult).reason;
  expect(error.code).toBe("ENOENT");
  
  // Third command should succeed
  expect(results[2].status).toBe("fulfilled");
});

test("spawn with inherit stdio using shell", async () => {
  // Test shell spawns which are common in build tools
  const result = await new Promise<number>((resolve, reject) => {
    const proc = spawn("sh", ["-c", "echo 'test output' && exit 0"], {
      stdio: "inherit",
      env: bunEnv,
    });

    proc.on("close", code => {
      resolve(code!);
    });

    proc.on("error", reject);
  });

  expect(result).toBe(0);
});

// Test that simulates the exact qwik build scenario
test("simulate qwik build parallel execution pattern", async () => {
  // Qwik runs these commands in parallel with inherited stdio
  const buildCommands = [
    ["echo", ["build.types"]],
    ["echo", ["build.client"]], 
    ["echo", ["build.server"]],
    ["echo", ["lint"]],
  ];

  let successCount = 0;
  let errorCount = 0;

  await Promise.all(
    buildCommands.map(([cmd, args]) => {
      return new Promise<void>((resolve, reject) => {
        const proc = spawn(cmd, args, {
          stdio: "inherit",
          shell: false,
        });

        proc.on("close", code => {
          if (code === 0) {
            successCount++;
            resolve();
          } else {
            errorCount++;
            reject(new Error(`Command failed with code ${code}`));
          }
        });

        proc.on("error", err => {
          errorCount++;
          reject(err);
        });
      });
    }),
  );

  expect(successCount).toBe(4);
  expect(errorCount).toBe(0);
});