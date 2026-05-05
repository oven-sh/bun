import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The repeating GC timer's collectAsync() lets JSC pick Eden vs Full. At idle
// JSC keeps picking Eden because Heap::updateAllocationLimits ratchets
// m_maxHeapSize on every Eden GC, so the 1/3 Full-promotion ratio stays above
// the threshold instead of crossing it. Before #29280 this meant old-gen
// garbage was never reclaimed while idle. Now, after 30 stable fast ticks,
// the controller fires an explicit collectAsync(CollectionScope::Full).

const fixture = /* js */ `
import { heapSize, fullGC } from "bun:jsc";

// ~40 MB of JS-heap-resident data.
let data = [];
for (let i = 0; i < 5000; i++) data.push(new Array(1000).fill(i));

// fullGC() while still referenced promotes everything to old gen and sets
// m_maxHeapSize = proportionalHeapSize(~40 MB), which is large enough that
// the post-release edenToOldGenerationRatio stays >= 1/3 and JSC's own
// shouldDoFullCollection() heuristic never fires. This is the shape a
// long-running server reaches organically; we force it here so the test is
// deterministic.
fullGC();
fullGC();

data = null;

const initial = heapSize();
process.stdout.write(\`INITIAL=\${initial}\\n\`);

// Keep the event loop alive without allocating. With BUN_GC_TIMER_INTERVAL=20
// the controller ticks every 20ms; once it sees 30 non-growing ticks (~600ms)
// it requests an async Full GC and converges to the slow interval. 2.5s of
// pure idle gives ~4x headroom on slow/ASAN builds.
await Bun.sleep(2500);

// The Full GC is async — poll until its result is visible in heapSize().
// Without the idle Full GC the loop runs to completion with heap unchanged.
const threshold = initial / 4;
let final = heapSize();
for (let i = 0; i < 30 && final >= threshold; i++) {
  await Bun.sleep(100);
  final = heapSize();
}
process.stdout.write(\`FINAL=\${final}\\n\`);
`;

test("GC controller fires a Full GC at idle so old-gen garbage is reclaimed", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: {
      ...bunEnv,
      BUN_GC_TIMER_INTERVAL: "20",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");

  const initial = Number(/INITIAL=(\d+)/.exec(stdout)?.[1]);
  const final = Number(/FINAL=(\d+)/.exec(stdout)?.[1]);
  expect(initial).toBeGreaterThan(20 * 1024 * 1024);
  expect(Number.isFinite(final)).toBe(true);

  // Without the idle Full GC, the repeating timer only runs Eden collections
  // and `final` stays within a few hundred KB of `initial`. With it, the
  // ~40 MB of promoted arrays is reclaimed and the heap drops to ~1 MB.
  expect(final).toBeLessThan(initial / 4);

  expect(exitCode).toBe(0);
}, 30_000);
