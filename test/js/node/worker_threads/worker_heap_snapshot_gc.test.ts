import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { join } from "node:path";

// The getHeapSnapshot() round-trip must never let the worker thread touch
// the parent VM's HandleSet. Before the fix this crashed with a segfault at
// 0x10 inside the "Sh" (Strong Handles) marking constraint — a parent-VM
// Strong<JSPromise> was captured by value in a lambda that ran on the worker
// thread, and Strong<T>'s copy/dtor mutated HandleSet::m_strongList without
// the parent VM's lock while the collector was iterating it.
//
// The race window is a handful of instructions after each snapshot
// completes, so no single run is guaranteed to hit it; we run the fixture
// repeatedly in release and fail if any attempt crashes. Debug and ASAN
// builds are several times slower per heap snapshot, so they get a reduced
// workload as a functional check — plain release CI is where this guards
// against regressions.
test(
  "worker.getHeapSnapshot() does not race the parent VM's Strong Handles list under GC",
  async () => {
    const slow = isDebug || isASAN;
    const attempts = slow ? 1 : 15;
    const iters = isDebug ? "5" : slow ? "100" : "300";
    const fixture = join(import.meta.dir, "heap-snapshot-gc-race-fixture.js");

    for (let i = 0; i < attempts; i++) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), fixture],
        env: { ...bunEnv, ITERS: iters },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // One assertion so a crash shows stdout/stderr/signal together.
      expect({ attempt: i, stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
        attempt: i,
        stdout: "ok\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    }
  },
  isDebug || isASAN ? 60_000 : 120_000,
);
