import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Upstream WebKit enabled Temporal by default; Bun overrides useTemporal to
// false in ZigGlobalObject.cpp until the remaining integration work lands.
// BUN_JSC_useTemporal=1 re-enables it for opt-in testing.
test("Temporal is not exposed by default", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `process.stdout.write(typeof Temporal)`],
    env: { ...bunEnv, BUN_JSC_useTemporal: undefined },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "undefined", stderr: expect.any(String), exitCode: 0 });
});

test("Temporal is exposed when BUN_JSC_useTemporal=1", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `process.stdout.write(typeof Temporal + " " + typeof Temporal.Now.instant)`],
    env: { ...bunEnv, BUN_JSC_useTemporal: "1" },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "object function", stderr: expect.any(String), exitCode: 0 });
});
