// Temporary: runs what scripts/build/tmp-rust-tests.ts has built. Removed before the merge.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isCI, isWindows } from "harness";
import { dirname, join } from "node:path";

const programs = [["bun_errno", "--skip", "errno_mapping"], ["bun_iocp"], ["bun_sys", "windows"], ["bun_threading"]];

test.skipIf(!isWindows || !isCI).each(programs)("%s", async (crate, ...args) => {
  await using proc = Bun.spawn({
    cmd: [join(dirname(bunExe()), "rust-tests", crate + ".exe"), ...args],
    env: bunEnv,
    stdio: ["ignore", "pipe", "inherit"],
    timeout: 40_000,
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  console.log(stdout);
  expect(stdout).toMatch(/^test result: ok\. [1-9]\d* passed; 0 failed/m);
  expect(exitCode).toBe(0);
});
