import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows } from "harness";
import { join } from "node:path";

// Bun.spawnSync buffers the child's stdout/stderr natively and only then
// converts them to JS values. If a JS exception is already pending when the
// sync wait loop exits — e.g. a Worker termination request, or a bun:test
// timeout — spawnMaybeSync returns early. That early return used to skip
// subprocess.finalize(); with no JS wrapper for spawnSync there is no GC
// finalizer, so the Subprocess and its buffered output leaked.
//
// This test terminates a Worker while it is blocked in spawnSync and uses
// the BUN_DEBUG_Subprocess log scope to verify that every Subprocess is
// finalized and deinit'd. The log scope only exists in debug builds; the
// child is POSIX `sleep`.
test.skipIf(!isDebug || isWindows)(
  "spawnSync does not leak the Subprocess when a termination exception is pending",
  async () => {
    const iterations = 2;
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "spawnSync-terminate-leak-fixture.ts")],
      env: {
        ...bunEnv,
        // Keep other scopes quiet; enable only the Subprocess scope. Scoped
        // debug logs are written to the target process's stdout.
        BUN_DEBUG_Subprocess: "1",
        ITERATIONS: String(iterations),
        SLEEP_SECS: "2",
      },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const combined = stdout + stderr;
    const count = (re: RegExp) => (combined.match(re) ?? []).length;

    // One spawnSync per Worker iteration; each must be matched by a
    // finalize + deinit.
    const spawned = count(/\[subprocess\] spawn maxBuffer:/g);
    const finalized = count(/\[subprocess\] finalize\n/g);
    const deinited = count(/\[subprocess\] deinit\n/g);

    expect(combined).toContain(`spawned=${iterations}`);
    expect({ spawned, finalized, deinited }).toEqual({
      spawned: iterations,
      finalized: iterations,
      deinited: iterations,
    });
    expect(exitCode).toBe(0);
  },
  60_000,
);
