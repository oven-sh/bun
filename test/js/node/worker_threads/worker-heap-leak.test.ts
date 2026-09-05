import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

// Allocator heaps that APIs park on the Worker's thread (Bun.TOML.parse and friends, the module
// loader) must die with the Worker's VM; see the fixture for details. The fixture starts four Workers,
// which takes well over the default per-test timeout on debug and ASAN builds.
test("a Worker that used per-thread allocator heaps does not leak them when it exits", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "worker-heap-leak-fixture.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ workers: 3, leaked: 0 });
  expect(exitCode).toBe(0);
}, 60_000);
