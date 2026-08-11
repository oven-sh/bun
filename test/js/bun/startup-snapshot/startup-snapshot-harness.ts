import { test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, tempDir } from "harness";
import { join } from "path";

// Snapshot round-trip: the fixture snapshots itself at idle, a fresh process restores it and continues.
export const env = { ...bunEnv, MIMALLOC_DETERMINISTIC_HINT: "1", BUN_STARTUP_SNAPSHOT_JIT_ADDR: "0x3c0000000" };
export const buildEnv = env;
export const restoreEnv = { ...env, MIMALLOC_HINT_FLOOR: "0x21000000000", BUN_STARTUP_SNAPSHOT_VERBOSE: "1" }; // a restoring process keeps its own early heap above where snapshot regions get mapped
// Support is a property of the build under test (platform, ASAN, and on macOS whether mimalloc is the process allocator); a
// build that lacks it says so as soon as it is asked to take one.
export const hasSnapshots = (() => {
  if (!isLinux && !isMacOS) return false;
  using dir = tempDir("bun-snapshot-probe", {});
  const probe = Bun.spawnSync({
    cmd: [bunExe(), "-e", ""],
    env: { ...bunEnv, BUN_STARTUP_SNAPSHOT_OUT: join(String(dir), "probe.snapshot") },
    stderr: "pipe",
    stdout: "pipe",
  });
  return !probe.stderr.toString().includes("not available in this build");
})();

// Every test here is a build + restore round-trip of a fixture (about a second in a release build, an order of magnitude more
// under ASAN; two of them additionally drive a terminal), so they share one generous ceiling instead of each picking its own.
const ROUND_TRIP_TIMEOUT_MS = 60_000;
export function withSnapshots(alsoRequires = true) {
  const t = test.skipIf(!hasSnapshots || !alsoRequires);
  return (name: string, fn: () => void | Promise<void>) => t(name, fn, ROUND_TRIP_TIMEOUT_MS);
}
export const snapshotTest = withSnapshots();
