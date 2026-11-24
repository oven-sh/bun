// Runs alone: it judges by a clock.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The timer armed each tick one interval after the previous one fired. A tick that fired behind the callback of a program
// timer with its period was then due inside that timer's next callback, and behind every one after it: its collection
// began while the callback's async work still held its data, and only a full collection frees what an eden collection
// found alive (a 1 s job that holds 3.5 MB over an await: 11 full collections in 25 s where 1 is needed). A tick is now
// due one interval after the deadline of the one before it, whenever that one fired. The unit tests beside
// GarbageCollectionController::next_deadline have the arithmetic.
test("a tick of the idle GC timer that fires late does not make the next one late", async () => {
  const interval = 600;
  // The child finds the schedule with a FinalizationRegistry callback, which runs right behind a tick's collection. The
  // next tick is due 1 interval later. The child is busy from 0.8 to 1.3, so that tick fires at 1.3, and the one after it
  // is due at 2. Armed from the late fire, it came at 2.3. Each mark is printed at its time, in intervals after the first
  // tick. Without the concurrent collector a collection begins and ends at the tick that asked for it.
  const script = `
    const interval = ${interval};
    const spinUntil = t => { while (performance.now() < t); };
    // Something for a tick to collect.
    const litter = () => { globalThis.litter = Array.from({ length: 500 }, (_, i) => ({ i })); };
    // Ends a run in which no tick comes.
    setTimeout(() => process.exit(1), 8 * interval);
    // From a timer: the collection that follows the entry point has run by then, so the next one is a tick's.
    setTimeout(() => {
      globalThis.registry = new FinalizationRegistry(() => {
        const tick = performance.now();
        const at = (intervals, callback) => setTimeout(callback, tick + intervals * interval - performance.now());
        at(0.8, () => {
          litter();
          spinUntil(tick + 1.3 * interval);
          console.error("BUSY-END");
        });
        at(1.55, () => {
          console.error("LATE");
          litter();
        });
        at(2.2, () => {
          console.error("DONE");
          process.exit(0);
        });
      });
      registry.register({}, 0);
    }, 0);
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: {
      ...bunEnv,
      BUN_GC_TIMER_DISABLE: undefined,
      BUN_GC_TIMER_INTERVAL: String(interval),
      BUN_IDLE_GC_SECONDS: "0",
      BUN_GARBAGE_COLLECTOR_LEVEL: "0",
      BUN_JSC_useConcurrentGC: "0",
      BUN_JSC_logGC: "1",
    },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const collectionsBetween = (from: string, to: string) => {
    const start = stderr.indexOf(from);
    const end = stderr.indexOf(to);
    expect(start, stderr).toBeGreaterThanOrEqual(0);
    expect(end, stderr).toBeGreaterThan(start);
    return (stderr.slice(start, end).match(/=> (Eden|Full)Collection/g) ?? []).length;
  };
  expect({
    atTheLateTick: collectionsBetween("BUSY-END", "LATE"),
    atTheNextTick: collectionsBetween("LATE", "DONE"),
    exitCode,
  }).toEqual({ atTheLateTick: 1, atTheNextTick: 1, exitCode: 0 });
});
