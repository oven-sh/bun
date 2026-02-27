import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/27490
// bmalloc SYSCALL macro was spinning at 100% CPU on madvise EAGAIN
// due to zero-delay tight loop with no backoff or retry cap.
//
// This test verifies that heavy allocation workloads complete without
// hanging. The original bug caused GC threads to spin indefinitely
// on madvise(MADV_DONTDUMP) returning EAGAIN under mmap_write_lock
// contention, freezing the process.
test("heavy allocation workload completes without hanging", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      // Simulate allocation-heavy workload that triggers GC pressure
      const arrays = [];
      for (let i = 0; i < 100; i++) {
        // Allocate and release large buffers to trigger GC decommit cycles
        for (let j = 0; j < 100; j++) {
          arrays.push(new ArrayBuffer(1024 * 64));
        }
        // Force some to be collected
        arrays.length = 0;
        Bun.gc(true);
      }
      console.log("OK");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("OK");
  expect(exitCode).toBe(0);
}, 30_000);
