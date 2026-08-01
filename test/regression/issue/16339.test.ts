// Regression test for https://github.com/oven-sh/bun/issues/16339
//
// Accessing `response.body` / `request.body` on a buffer-backed body left a
// `readable_stream::Strong` GC root in `Body::Value::Locked.readable` instead of
// migrating it into the wrapper's `m_stream` WriteBarrier. The ReadableStream
// captures `asyncContext` on creation, so when the surrounding
// AsyncLocalStorage store transitively references the Response (Next.js's
// patch-fetch does this per unique fetch URL), the strong root makes the
// whole cycle uncollectable.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function collectHeapAfter(
  script: string,
): Promise<{ protected: number; totalStream: number; totalOwner: number }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).not.toBe("");
  const result = JSON.parse(stdout);
  expect(exitCode).toBe(0);
  return result;
}

const N = 100;
const report = `
  Bun.gc(true);
  await Bun.sleep(20);
  Bun.gc(true);
  const stats = require("bun:jsc").heapStats();
  process.stdout.write(JSON.stringify({
    protected: stats.protectedObjectTypeCounts.ReadableStream ?? 0,
    totalStream: stats.objectTypeCounts.ReadableStream ?? 0,
    totalOwner: stats.objectTypeCounts.Response ?? 0,
  }));
`;

test.concurrent(
  "Response.body on a buffer body does not pin a ReadableStream GC root through async context",
  async () => {
    const script = `
    const { AsyncLocalStorage } = require("node:async_hooks");
    const als = new AsyncLocalStorage();
    const buf = Buffer.alloc(200, "x");
    for (let i = 0; i < ${N}; i++) {
      const store = { data: null };
      als.run(store, () => {
        const res = new Response(buf);
        void res.body; // materialise the stream (captures asyncContext)
        store.data = res; // close the cycle through the ALS store
      });
    }
    ${report}
  `;
    const { protected: p, totalStream, totalOwner } = await collectHeapAfter(script);
    // Before the fix this reported exactly N strongly rooted ReadableStreams
    // (and N retained Responses); after the fix the wrapper's visitChildren owns
    // the stream and the whole cycle is collectable.
    expect(p).toBe(0);
    expect(totalStream).toBeLessThan(10);
    expect(totalOwner).toBeLessThan(10);
  },
);

test.concurrent(
  "Request.body on a buffer body does not pin a ReadableStream GC root through async context",
  async () => {
    const script = `
    const { AsyncLocalStorage } = require("node:async_hooks");
    const als = new AsyncLocalStorage();
    const buf = Buffer.alloc(200, "x");
    for (let i = 0; i < ${N}; i++) {
      const store = { data: null };
      als.run(store, () => {
        const req = new Request("http://x/", { method: "POST", body: buf });
        void req.body;
        store.data = req;
      });
    }
    Bun.gc(true);
    await Bun.sleep(20);
    Bun.gc(true);
    const stats = require("bun:jsc").heapStats();
    process.stdout.write(JSON.stringify({
      protected: stats.protectedObjectTypeCounts.ReadableStream ?? 0,
      totalStream: stats.objectTypeCounts.ReadableStream ?? 0,
      totalOwner: stats.objectTypeCounts.Request ?? 0,
    }));
  `;
    const { protected: p, totalStream, totalOwner } = await collectHeapAfter(script);
    expect(p).toBe(0);
    expect(totalStream).toBeLessThan(10);
    expect(totalOwner).toBeLessThan(10);
  },
);

test.concurrent("fetch response .body does not pin a ReadableStream GC root through async context", async () => {
  // This variant drives the Locked-body path (`locked_to_native_stream`);
  // each fetch involves a real server round-trip, so fewer iterations.
  const fetchN = 40;
  const script = `
    const { AsyncLocalStorage } = require("node:async_hooks");
    const als = new AsyncLocalStorage();
    const payload = Buffer.alloc(200, "x");
    await using server = Bun.serve({
      port: 0,
      fetch: () => new Response(payload, { headers: { "content-type": "text/plain" } }),
    });
    for (let i = 0; i < ${fetchN}; i++) {
      const store = { data: null };
      await als.run(store, async () => {
        const res = await fetch(server.url);
        const stream = res.body;
        for await (const _ of stream) {}
        store.data = res;
      });
    }
    ${report}
  `;
  const { protected: p, totalStream, totalOwner } = await collectHeapAfter(script);
  expect(p).toBe(0);
  expect(totalStream).toBeLessThan(10);
  expect(totalOwner).toBeLessThan(10);
});
