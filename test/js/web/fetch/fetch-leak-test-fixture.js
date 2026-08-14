// Spawned by fetch-leak.test.ts ("fetch doesn't leak > fixture #1"). Fetches
// SERVER COUNT times without ever reading the bodies, which used to keep every
// Response reachable from the native side forever, then prints one JSON line
// with how many Response objects survived GC.
import { heapStats } from "bun:jsc";

const { SERVER } = process.env;
const COUNT = parseInt(process.env.COUNT, 10);
if (!SERVER || !Number.isSafeInteger(COUNT)) {
  throw new Error("SERVER and COUNT must be set: " + JSON.stringify({ SERVER, COUNT: process.env.COUNT }));
}
// A leak keeps all COUNT Responses alive. Unconsumed Responses are otherwise
// garbage as soon as fetch() has settled; the poll below normally ends with one
// survivor (the most recent Response, still visible to the conservative stack
// scan), so this only needs to be well under the size of the last batch.
const maxResponsesAlive = 5;

// Runs in its own frame so that none of the Responses are still on the stack
// when the survivors are counted below.
async function fetchWithoutReadingBodies() {
  let requests = 0;
  while (requests < COUNT) {
    const batch = [];
    for (let i = 0; i < Math.min(32, COUNT - requests); i++) batch.push(fetch(SERVER));
    for (const response of await Promise.all(batch)) {
      if (response.status !== 200) throw new Error(`unexpected status ${response.status}`);
      requests++;
    }
  }
  return requests;
}

const requests = await fetchWithoutReadingBodies();

// The last batch stays pinned until the native side releases it on a later
// event-loop turn, so poll instead of sleeping. Bounded so that a leak, which
// never gets under the limit, is reported instead of spinning here.
const deadline = Date.now() + 5_000;
let responsesAlive;
for (;;) {
  Bun.gc(true);
  responsesAlive = heapStats().objectTypeCounts.Response ?? 0;
  if (responsesAlive <= maxResponsesAlive || Date.now() >= deadline) break;
  await new Promise(resolve => setImmediate(resolve));
}

console.log(JSON.stringify({ requests, responsesAlive }));
if (responsesAlive > maxResponsesAlive) {
  throw new Error(`${responsesAlive} Response objects are still alive after ${requests} unconsumed fetches`);
}
