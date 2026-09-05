import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isIntelMacOS, isWindows } from "harness";
import { join } from "node:path";

// The getHeapSnapshot() round-trip must never let the worker thread touch the
// parent VM's Strong handle set (JSC::StrongSet). Before the fix (#30185) a
// parent-VM Strong<JSPromise> was captured by value in a lambda that ran on
// the worker thread, so the worker allocated and freed a parent-VM handle
// without the parent VM's lock. A parent-thread allocate or free that overlaps
// tears the allocator: the parent then faults in
// StrongSet::tryAllocateFromCurrent, trips a RELEASE_ASSERT on the used count
// (StrongBlock::decrementUsedCount) or block bookkeeping
// (StrongSet::didFreeSlot), or has two handles share one slot.
//
// The fixture makes that overlap likely instead of relying on volume: while
// each snapshot is in flight, the parent allocates and frees Strong handles
// as densely as JS can (see the fixture header). With the bug reintroduced on
// a release build, one round-trip corrupts the parent VM about half of the
// time and 100 of 100 processes crashed within 10 round-trips; the previous
// 15x300 idle-parent workload detected nothing in 9000 round-trips. Each
// attempt is an independent process, so the attempts run concurrently.
//
// This is the release-lane backstop for the getHeapSnapshot() site only. The
// deterministic guard for every cross-VM site, a lock-held assert in
// StrongSet::allocate/deallocate (#36958), is still to be ported.
//
// Skipped on Windows and Intel (x64) macOS, as before: the per-worker stdio
// path on those builders adds spawn overhead the original stress exceeded,
// and this workload has not been measured there. The race is platform
// agnostic and still covered on Linux and Apple Silicon macOS.
test.skipIf(isWindows || isIntelMacOS)(
  "worker.getHeapSnapshot() does not race the parent VM's Strong handle set",
  async () => {
    // A debug heap snapshot takes about 3s and the debug churn is less dense
    // (one debug+ASAN process caught the reintroduced bug in 7 of 16 runs of
    // 5 round-trips), so the debug lane is a functional check with some teeth.
    // Release and ASAN release run 5 processes of 10 round-trips each.
    const attempts = isDebug ? 1 : 5;
    const iters = isDebug ? 5 : 10;
    const fixture = join(import.meta.dir, "heap-snapshot-gc-race-fixture.js");

    const results = await Promise.all(
      Array.from({ length: attempts }, async (_, i) => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), fixture],
          env: { ...bunEnv, ITERS: String(iters) },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { attempt: i, stdout, stderr, exitCode, signalCode: proc.signalCode };
      }),
    );
    for (const result of results) {
      // One assertion per attempt so a failure shows stdout, stderr, exit code
      // and signal together. The fixture prints the summary line only after
      // every round-trip settled, the first payload parsed as a V8 heap
      // snapshot with a non-zero node count, and the worker was terminated.
      expect(result).toEqual({
        attempt: result.attempt,
        stdout: `ok snapshots=${iters} workerExitCode=1\n`,
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    }
  },
  // A regression can present as a hang on a torn free list, so the timeout is
  // the time-to-red for that case. The debug lane needs about 25s of it.
  60_000,
);
