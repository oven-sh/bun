// Runs alone: it judges by a clock.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The timer armed each tick one interval after the previous one fired. A tick that fired behind the callback of a program
// timer with its period was then due inside that timer's next callback, and behind every one after it: its collection
// began while the callback's async work still held its data, and only a full collection frees what an eden collection
// found alive (a 1 s job that holds 3.5 MB over an await: 11 full collections in 25 s where 1 is needed). A tick is now
// due whole intervals after the deadline of the one before it, whenever that one fired. The unit tests beside
// GarbageCollectionController::next_deadline have the arithmetic.
test("a tick of the idle GC timer that fires late does not make the next one late", async () => {
  const interval = 500;
  // The child reads the time of each collection in a FinalizationRegistry callback, which runs right behind it. A
  // collection one interval after the one before it is a tick on its schedule, however long a collection takes. From
  // there the child is busy for 1.4 intervals, so the next tick fires 0.4 late, and the one after it is due 2 intervals
  // after the first. Armed from the late fire, it came at 2.4. The child prints when those two collections ran, in
  // intervals after the first. Without the concurrent collector a collection ends at the tick that asked for it.
  const script = `
    const interval = ${interval};
    const spinUntil = t => { while (performance.now() < t); };
    // Something for the next tick to collect. The registry calls back once the object is collected.
    const litter = () => {
      registry.register({}, 0);
      globalThis.litter = Array.from({ length: 500 }, (_, i) => ({ i }));
    };
    let previous = -Infinity, first, late;
    const seen = [];
    globalThis.registry = new FinalizationRegistry(() => {
      const now = performance.now();
      seen.push(Math.round(now));
      if (first === undefined) {
        litter();
        if (Math.abs(now - previous - interval) < 0.1 * interval) {
          first = now;
          spinUntil(first + 1.4 * interval);
        }
        previous = now;
      } else if (late === undefined) {
        late = now;
        litter();
      } else {
        console.log(((late - first) / interval).toFixed(2), ((now - first) / interval).toFixed(2));
        process.exit(0);
      }
    });
    // Ends a run that finds no schedule, or no tick after it.
    setTimeout(() => {
      console.error("gave up, collections at ms: " + seen.join(" "));
      process.exit(1);
    }, 8 * interval);
    // From a timer: the collection that follows the entry point has run by then, so the next one is a tick's.
    setTimeout(litter, 0);
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
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const [late, next] = stdout.trim().split(" ").map(Number);
  expect(
    {
      // At the end of the busy time, not a tick later.
      theLateTickCollects: late < 1.75,
      // At 2, or at 3: a tick more than half an interval late leaves the next point out.
      theNextTickIsOnSchedule: Math.abs(next - Math.round(next)) < 0.3,
      exitCode,
    },
    `the late tick and the next one, in intervals after the first: ${JSON.stringify(stdout)}\n${stderr}`,
  ).toEqual({ theLateTickCollects: true, theNextTickIsOnSchedule: true, exitCode: 0 });
});
