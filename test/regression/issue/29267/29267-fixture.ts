import { AsyncLocalStorage } from "node:async_hooks";
import { heapStats } from "bun:jsc";

const als = new AsyncLocalStorage<{ payload: Buffer; responses: unknown[] }>();
const N = 500;

// Next.js cloneResponse accesses `.body` on a Response constructed from a
// buffered body and stashes the Response in the request-scoped ALS store.
// Distilled to the edges that matter for the retention cycle:
async function request(i: number) {
  const store = {
    // Stand-in for the per-request RSC cache / request store.
    payload: Buffer.alloc(50 * 1024),
    responses: [] as unknown[],
  };
  await als.run(store, async () => {
    const res = new Response(Buffer.alloc(10 * 1024, 65 + (i % 26)));
    void res.body;
    store.responses.push(res);
    await Promise.resolve();
  });
}

for (let b = 0; b < N; b += 100) {
  await Promise.all(Array.from({ length: 100 }, (_, j) => request(b + j)));
}

Bun.gc(true);
Bun.gc(true);
const st = heapStats();
console.log(
  JSON.stringify({
    N,
    protectedRS: st.protectedObjectTypeCounts.ReadableStream ?? 0,
    readableStream: st.objectTypeCounts.ReadableStream ?? 0,
    response: st.objectTypeCounts.Response ?? 0,
    heapMB: Number((st.heapSize / 1048576).toFixed(1)),
  }),
);
