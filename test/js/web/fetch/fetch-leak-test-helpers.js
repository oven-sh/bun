// Shared by the fetch-leak-test-fixture-*.js children of fetch-leak.test.ts.
import { heapStats } from "bun:jsc";

// Every fixture's Response count settles at one survivor once the requests have
// been released (measured on release and debug+ASAN builds; it does not go away
// however long you wait), while a leak keeps roughly one Response per request,
// and the fewest requests any fixture checks after is fixture-5's batch of 10.
export const maxResponsesAlive = 5;

// Returns how many objects of each type in `limits` survive a GC, once every
// count is within its limit and has stopped falling (the same reading in two
// consecutive rounds), or throws once a count is still over its limit after five
// seconds. The objects of a settled fetch() stay reachable until the native side
// lets go of them on a later event-loop turn, and what they were holding on to
// only goes away in the GC pass after that (measured: a batch's promise count
// comes down in two or three steps), so a single reading right after the
// requests is meaningless; re-checking once per turn until two rounds agree gets
// the settled count without sleeping for a fixed time, and leaked objects are
// the ones that never come down.
export async function expectCollected(limits, context) {
  const types = Object.keys(limits);
  const deadline = Date.now() + 5_000;
  let previous;
  for (;;) {
    Bun.gc(true);
    const { objectTypeCounts } = heapStats();
    const counts = {};
    for (const type of types) counts[type] = objectTypeCounts[type] ?? 0;
    const within = types.every(type => counts[type] <= limits[type]);
    const settled = previous !== undefined && types.every(type => counts[type] === previous[type]);
    const timedOut = Date.now() >= deadline;
    if (within && (settled || timedOut)) return counts;
    if (timedOut) {
      const alive = types.map(type => `${counts[type]} ${type} objects (limit ${limits[type]})`);
      throw new Error(`still alive after ${context}: ${alive.join(", ")}`);
    }
    previous = counts;
    await new Promise(resolve => setImmediate(resolve));
  }
}
