import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A JS-backed ReadableStream whose pull() returns undefined (the common case) used to route
// every pull through promiseResolvedWith(result) + performPromiseThenWithContext, allocating a
// JSPromise (plus its PromiseReactions) per chunk on the read/pull hot loop. This test proves
// that overhead is gone by counting live Promise cells across a stretch of pull-driven reads.
test("pull() returning undefined does not allocate a wrapper promise per chunk", async () => {
  const src = `
    const { heapStats } = require("bun:jsc");

    const READS = 4000;
    const chunk = new Uint8Array(1);

    async function drain() {
      let i = 0;
      const rs = new ReadableStream({
        pull(c) {
          if (i++ < READS) c.enqueue(chunk);
          else c.close();
        },
      });
      const reader = rs.getReader();
      while (!(await reader.read()).done) {}
    }

    // Warm up the machinery and settle any one-off allocations.
    await drain();
    Bun.gc(true);

    const before = heapStats().objectTypeCounts.Promise || 0;
    await drain();
    const after = heapStats().objectTypeCounts.Promise || 0;

    // Without the fast path each of the READS pulls allocates a wrapper promise, so
    // (after - before) sits in the thousands until a GC. With the fast path the only
    // promises are the per-read ones the await already drains.
    console.log(JSON.stringify({ before, after, delta: after - before, reads: READS }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const { delta, reads } = JSON.parse(stdout.trim());
  // reader.read()'s own result promise is one per read and unavoidable; the old path
  // additionally allocated a wrapper promise (promiseResolvedWith) per pull plus its
  // resolve-chain promise, landing around 3*reads. Bound at 1.5*reads: fails on the
  // old path, passes on the fast path.
  expect(delta).toBeLessThan(reads * 1.5);
  expect(exitCode).toBe(0);
});

// Regression guard for the synchronous-re-pull recursion pitfall: a pump-based consumer
// (Response body collection) over a JS-source stream with many sync-pull chunks must not
// overflow the stack. The m_pullAgain re-pull is deferred as a microtask, so stack depth
// stays constant.
test("Response(stream).arrayBuffer() over many sync-pull chunks does not overflow", async () => {
  const N = 30000;
  const src = `
    let i = 0;
    const stream = new ReadableStream({
      pull(c) {
        if (i++ < ${N}) c.enqueue(new Uint8Array([1]));
        else c.close();
      },
    });
    const buf = await new Response(stream).arrayBuffer();
    console.log(buf.byteLength);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(String(N));
  expect(exitCode).toBe(0);
});
