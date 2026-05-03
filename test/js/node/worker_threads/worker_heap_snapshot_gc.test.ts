import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";
import { join } from "node:path";

// The getHeapSnapshot() round-trip must never let the worker thread touch
// the parent VM's HandleSet. Before the fix this crashed ~30% of the time
// in release with a segfault at 0x10 inside the "Sh" (Strong Handles)
// marking constraint — a parent-VM Strong<JSPromise> was captured by value
// in a lambda that ran on the worker thread, and Strong<T>'s copy/dtor
// mutated HandleSet::m_strongList without the parent VM's lock while the
// collector was iterating it.
//
// The race window is a handful of instructions after each snapshot
// completes, so in the (much slower) debug build a short pass is just a
// functional check; release CI is where this guards against regressions.
test(
  "worker.getHeapSnapshot() does not race the parent VM's Strong Handles list under GC",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "heap-snapshot-gc-race-fixture.js")],
      env: { ...bunEnv, ITERS: isDebug ? "5" : "300" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // One assertion so a crash shows stdout/stderr/signal together.
    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "ok\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  },
  isDebug ? 60_000 : 30_000,
);
