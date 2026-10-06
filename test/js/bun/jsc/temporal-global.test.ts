import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Temporal ships enabled by default. BUN_JSC_useTemporal=0 is the opt-out;
// the BUN_JSC_* environment overrides are applied after the defaults block
// in ZigGlobalObject.cpp, so it can still turn the global back off.
test.concurrent("Temporal is exposed by default", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `process.stdout.write(typeof Temporal + " " + typeof Temporal.Now.instant)`],
    env: { ...bunEnv, BUN_JSC_useTemporal: undefined },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "object function", stderr: expect.any(String), exitCode: 0 });
});

test.concurrent("BUN_JSC_useTemporal=0 disables Temporal", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `process.stdout.write(typeof Temporal)`],
    env: { ...bunEnv, BUN_JSC_useTemporal: "0" },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "undefined", stderr: expect.any(String), exitCode: 0 });
});
