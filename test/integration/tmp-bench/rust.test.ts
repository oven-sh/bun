// Temporary: runs what scripts/build/tmp-rust-tests.ts has built. Removed before the PR is ready.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isCI, isWindows } from "harness";
import { dirname, join } from "node:path";

test
  .skipIf(!isWindows || !isCI)
  .each([["bun_errno", "--skip", "errno_mapping"], ["bun_io", "source"],
  ["bun_iocp"], ["bun_sys", "windows"], ["bun_threading"]])(
  "%s",
  async (crate, ...args) => {
    await using proc = Bun.spawn({
      cmd: [join(dirname(bunExe()), "rust-tests", crate + ".exe"), ...args],
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit"],
    });
    expect(await proc.exited).toBe(0);
  },
  60_000,
);
