// Diagnostic only: is a byte sent over loopback TCP readable on the peer as soon as send() returns?
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { release } from "node:os";
import { join } from "node:path";

test.skipIf(!isWindows)("zz diag: loopback peek right after send", async () => {
  const run = async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "zz-diag-loopback-peek-fixture.mjs"), "200000"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return stdout.trim() || stderr.trim().slice(-300);
  };
  const lines = [await run(), ...(await Promise.all([run(), run(), run(), run(), run(), run(), run(), run()]))];
  expect(`Windows ${release()}\n` + lines.join("\n")).toBe("");
});
