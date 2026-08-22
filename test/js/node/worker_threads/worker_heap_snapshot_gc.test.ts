import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isIntelMacOS, isWindows } from "harness";
import { join } from "node:path";

// The getHeapSnapshot() round-trip must never let the worker thread touch
// the parent VM's HandleSet. Before the fix (#30185) this corrupted
// HandleSet::m_strongList — a parent-VM Strong<JSPromise> was captured by
// value in a lambda that ran on the worker thread, and Strong<T>'s copy/dtor
// mutated the list without the parent VM's lock while the collector was
// iterating it, faulting at 0x10 inside the "Sh" marking constraint (or
// livelocking on the torn list).
//
// This test used to run 15x300 iterations in release as a probabilistic
// crash guard. That sizing dated from when the GC controller ran a
// collection every ~16ms of event-loop activity, which is what made the
// parent's strong-handle scans overlap the worker's task teardown; #35356
// removed those per-tick collections, and with them the overlap: the
// original bug, reintroduced, survives 15x300 with no crashes (0 detections
// in 18k iterations, vs ~60% per process before #35356). With no scheduling
// coincidence left to amplify, the loop is kept as a functional check of the
// cross-VM round-trip under concurrent processes and explicit parent GCs:
// promises settle, every stream delivers a non-empty payload (parsed as JSON
// once per process), workers terminate cleanly.
//
// The ASAN lane keeps a larger iteration count: ASAN can catch ordinary
// memory bugs in the round-trip/stream machinery that the plain-release
// lanes cannot.
//
// Skipped on Windows and Intel (x64) macOS: the always-on per-worker stdio
// path adds per-spawn overhead that this stress exceeds on those builders.
// The code path is platform-agnostic and still covered on Linux and
// Apple-Silicon macOS.
test.skipIf(isWindows || isIntelMacOS)(
  "worker.getHeapSnapshot() does not race the parent VM's Strong Handles list under GC",
  async () => {
    const attempts = isDebug || isASAN ? 1 : 15;
    const iters = isDebug ? 5 : isASAN ? 100 : 25;
    const fixture = join(import.meta.dir, "heap-snapshot-gc-race-fixture.js");

    // The attempts are independent processes with no shared state, so run them
    // all concurrently; the behavior being exercised is intra-process.
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
      // One assertion per attempt so a failure shows stdout/stderr/signal
      // together. The "ok <count>" stdout proves the fixture ran every
      // iteration rather than exiting early.
      expect(result).toEqual({
        attempt: result.attempt,
        stdout: `ok ${iters}\n`,
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    }
  },
  // One explicit ceiling for every lane: the debug/ASAN run needs more than
  // the local 5s default (~20s), and a regression of the guarded race can
  // present as a livelock, so the timeout is the time-to-red for hangs. The
  // old 120s release arm was sized for the 15x300 workload.
  60_000,
);
