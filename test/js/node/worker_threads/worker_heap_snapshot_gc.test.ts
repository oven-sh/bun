import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isIntelMacOS, isWindows } from "harness";
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
// Skipped on Windows and Intel (x64) macOS: this branch's always-on per-worker
// stdio path adds per-spawn overhead that a 15x300-snapshot stress exceeds on
// those builders. The race it guards is platform-agnostic and still covered on
// Linux and Apple-Silicon macOS.
test.skipIf(isWindows || isIntelMacOS)(
  "worker.getHeapSnapshot() does not race the parent VM's Strong Handles list under GC",
  async () => {
    const slow = isDebug || isASAN;
    const attempts = slow ? 1 : 15;
    const iters = isDebug ? 5 : slow ? 100 : 300;
    // The first SNAPSHOT_ITERS round-trips use getHeapSnapshot(); the rest use
    // getHeapStatistics(), which shares the same registerCrossVMRequest path
    // and lambda structure but is ~400x cheaper per call, so the 15x300
    // race-window count is unchanged without 4500 full worker-heap GCs.
    const snapshotIters = slow ? iters : 20;
    const fixture = join(import.meta.dir, "heap-snapshot-gc-race-fixture.js");
    // The fixture additionally parses its first snapshot/stats and reports the
    // top-level keys, so this also guards the V8 heap-snapshot and
    // getHeapStatistics() shapes.
    const expected: Record<string, unknown> = {
      iters,
      snapshotIters,
      snapshotKeys: "edges,locations,nodes,samples,snapshot,strings,trace_function_infos,trace_tree",
    };
    if (snapshotIters < iters) {
      expected.heapStatsKeys =
        "does_zap_garbage,external_memory,heap_size_limit,malloced_memory,number_of_detached_contexts," +
        "number_of_native_contexts,peak_malloced_memory,total_allocated_bytes,total_available_size," +
        "total_global_handles_size,total_heap_size,total_heap_size_executable,total_physical_size," +
        "used_global_handles_size,used_heap_size";
    }
    const expectedStdout = JSON.stringify(expected) + "\n";

    // The attempts are independent processes with no shared state, so run them
    // all concurrently; the race being guarded is intra-process.
    const results = await Promise.all(
      Array.from({ length: attempts }, async (_, i) => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), fixture],
          env: { ...bunEnv, ITERS: String(iters), SNAPSHOT_ITERS: String(snapshotIters) },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { attempt: i, stdout, stderr, exitCode, signalCode: proc.signalCode };
      }),
    );
    for (const result of results) {
      // One assertion per attempt so a crash shows stdout/stderr/signal together.
      expect(result).toEqual({
        attempt: result.attempt,
        stdout: expectedStdout,
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    }
  },
  isDebug || isASAN ? 60_000 : 120_000,
);
