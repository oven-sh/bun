import { test, expect } from "bun:test";
import { spawn } from "bun";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

if (process.platform === "linux") {
  test("issue #9404", async () => {
    const proc = spawn({
      env: {
        ...bunEnv,
        BUN_GARBAGE_COLLECTOR_LEVEL: "1",
        BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1",
      },
      stderr: "inherit",
      cmd: [bunExe(), join(__dirname, "spawn_waiter_thread-fixture.js")],
    });

    setTimeout(() => {
      proc.kill();
    }, 1000);

    await proc.exited;

    const resourceUsage = proc.resourceUsage();
    
    // Assert we didn't use 100% of CPU time
    expect(resourceUsage?.cpuTime.total).toBeLessThan(750_000n);
  });
}
