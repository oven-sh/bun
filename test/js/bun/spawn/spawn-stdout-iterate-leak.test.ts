import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows } from "harness";
import { join } from "path";

// Regression test for FileReader.onPull: after `drain()` moves the
// internally buffered data into a local ByteList and the data is memcpy'd
// into the JS-provided pull buffer, that ByteList must be freed. The old
// code freed `this.buffered` instead — but `drain()` had already emptied
// it, so the moved allocation was orphaned on every such pull.
//
// The measurement runs in a subprocess so RSS is isolated from the test
// harness, and several equally-sized runs are sampled so steady-state
// allocator growth (which plateaus) is distinguished from a real leak
// (which keeps climbing). See spawn-stdout-iterate-leak.fixture.ts for how
// the exact code path is reached.

// The leak is in the posix poll-reader path; Windows pipes go through
// libuv with different buffering.
//
// On release builds without ASAN, mimalloc recycles the orphaned 32 KiB
// blocks into later allocations of the same size class, so RSS growth is
// sub-linear and too close to allocator noise to threshold reliably.
// Under ASAN each leaked block is quarantined behind poisoned redzones and
// cannot be reused, so the leak shows up as clean linear RSS growth
// (~148-162 MB unfixed). Debug builds always enable ASAN.
//
// Post-fix, the first-to-last delta is *not* zero: 5×1000 subprocess-spawn
// + event-loop-tick cycles grow and fragment the JSC heap and allocator
// arenas, and `process.memoryUsage.rss()` never shrinks back after
// `Bun.gc(true)` because freed memory isn't returned to the OS. Under ASAN
// redzones/quarantine inflate that residual further and it varies
// machine-to-machine, so the post-fix delta legitimately runs several tens
// of MB. The threshold below is therefore deliberately generous — it sits
// well above observed post-fix noise (~35 MB) yet still far below the
// >140 MB unfixed floor, so a regression is caught cleanly.
test.skipIf(isWindows || !(isDebug || isASAN))(
  "FileReader.onPull frees the drained buffer after memcpy",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "spawn-stdout-iterate-leak.fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");

    const { samples, delta } = JSON.parse(stdout.trim()) as { samples: number[]; delta: number };
    console.log(`RSS samples=[${samples.map(s => s.toFixed(1)).join(", ")}]MB delta=${delta.toFixed(1)}MB`);
    expect(exitCode).toBe(0);

    // Without the fix, each of the 4×1000 iterations between the first and
    // last sample orphans a ~32 KiB allocation, so RSS climbs another
    // >140 MB under ASAN. With the fix the samples plateau; the first-to-last
    // delta is steady-state allocator/GC/ASAN noise that can run several tens
    // of MB but stays far below the unfixed floor.
    expect(delta).toBeLessThan(96);
  },
  // Debug+ASAN event-loop ticks are slow (5×1000 cycles can exceed 5 min on
  // a loaded runner); release finishes in ~1s.
  600_000,
);
