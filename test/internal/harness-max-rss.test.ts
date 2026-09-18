import { expect, test } from "bun:test";
import { bunExe, runCommandMaxRSS } from "harness";

const MiB = 1024 * 1024;

test("runCommandMaxRSS measures the command, not the test runner", async () => {
  // Make this process large. On Linux a child of this process reports at
  // least this much as its maxRSS, because ru_maxrss survives exec. The peak
  // stays that high even if the buffer is collected.
  const ballast = Buffer.alloc(256 * MiB, 1);
  const runnerRSS = process.memoryUsage.rss();
  expect(runnerRSS).toBeGreaterThan(ballast.length);

  const idle = await runCommandMaxRSS({ cmd: [bunExe(), "-e", "0"] });
  expect(idle).toMatchObject({ stdout: "", stderr: "", exitCode: 0, signalCode: null });
  expect(idle.maxRSS).toBeLessThan(runnerRSS);

  const busy = await runCommandMaxRSS({
    cmd: [bunExe(), "-e", `console.log(Buffer.alloc(${256 * MiB}, 1).length)`],
  });
  expect(busy).toMatchObject({ stdout: `${256 * MiB}\n`, stderr: "", exitCode: 0, signalCode: null });
  expect(busy.maxRSS - idle.maxRSS).toBeGreaterThan(128 * MiB);
});
