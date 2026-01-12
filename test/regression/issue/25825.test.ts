import { describe, expect, test } from "bun:test";
import { chmodSync } from "fs";
import { bunEnv, isWindows, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/25825
// Bug: When exec fails with EACCES (e.g., noexec mount or no execute permission),
// the spawn would silently fail with exit code 127 but return success (no error thrown).
// This was caused by a race condition in the vfork() path on Linux where the
// child's write to child_errno wasn't visible to the parent due to missing memory barrier.

describe("spawn exec failure should report EACCES error", () => {
  test.skipIf(isWindows)("spawning a non-executable script should throw EACCES", async () => {
    using dir = tempDir("issue-25825", {
      // Create a script file (we'll remove execute permissions)
      "script.sh": `#!/bin/sh\necho "hello"`,
    });

    const scriptPath = join(String(dir), "script.sh");

    // Remove execute permissions to simulate EACCES scenario
    chmodSync(scriptPath, 0o644);

    // This should throw an error, not silently fail
    let error: Error | undefined;
    try {
      await using proc = Bun.spawn({
        cmd: [scriptPath],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeDefined();
    expect(error!.message).toContain("EACCES");
  });

  test.skipIf(isWindows)("spawning a non-executable file via Bun.spawnSync should report EACCES", () => {
    using dir = tempDir("issue-25825-sync", {
      "script.sh": `#!/bin/sh\necho "hello"`,
    });

    const scriptPath = join(String(dir), "script.sh");
    chmodSync(scriptPath, 0o644);

    let error: Error | undefined;
    try {
      Bun.spawnSync({
        cmd: [scriptPath],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeDefined();
    expect(error!.message).toContain("EACCES");
  });

  test.skipIf(isWindows)("spawning via child_process.spawn should emit error for non-executable", async () => {
    const { spawn } = await import("child_process");

    using dir = tempDir("issue-25825-child-process", {
      "script.sh": `#!/bin/sh\necho "hello"`,
    });

    const scriptPath = join(String(dir), "script.sh");
    chmodSync(scriptPath, 0o644);

    const { promise, resolve } = Promise.withResolvers<{ error?: Error; code?: number | null }>();

    const child = spawn(scriptPath, [], {
      env: bunEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let errorEmitted: Error | undefined;
    child.on("error", err => {
      errorEmitted = err;
      resolve({ error: err });
    });
    child.on("exit", code => {
      resolve({ code });
    });

    const result = await promise;

    // Should emit an error event with EACCES, not silently exit
    expect(result.error).toBeDefined();
    expect(result.error!.message).toContain("EACCES");
  });
});
