import { expect, test } from "bun:test";
import { bunExe, isMacOS, runCommandMaxRSS } from "harness";

const MiB = 1024 * 1024;

test("runCommandMaxRSS measures the command, not the test runner", async () => {
  // Make this process large. On Linux a child of this process reports at
  // least this much as its maxRSS, because ru_maxrss survives exec. The peak
  // stays that high even if the buffer is collected.
  const ballast = Buffer.alloc(256 * MiB, 1);
  const runnerRSS = process.memoryUsage.rss();
  // On macOS rss is phys_footprint. It leaves out a page that the allocator
  // released with MADV_FREE_REUSABLE and wrote again before the kernel took it
  // back. A `bun test --parallel` worker ran other files in this process, so
  // the ballast can sit on such pages and rss is then below its size.
  if (!isMacOS) expect(runnerRSS).toBeGreaterThan(ballast.length);

  const idle = await runCommandMaxRSS({ cmd: [bunExe(), "-e", "0"] });
  expect(idle).toMatchObject({ stdout: "", stderr: "", exitCode: 0, signalCode: null });
  expect(idle.maxRSS).toBeLessThan(Math.max(runnerRSS, ballast.length));

  const busy = await runCommandMaxRSS({
    cmd: [bunExe(), "-e", `console.log(Buffer.alloc(${256 * MiB}, 1).length)`],
  });
  expect(busy).toMatchObject({ stdout: `${256 * MiB}\n`, stderr: "", exitCode: 0, signalCode: null });
  expect(busy.maxRSS - idle.maxRSS).toBeGreaterThan(128 * MiB);
});
