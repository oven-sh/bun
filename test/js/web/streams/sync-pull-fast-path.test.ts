import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A JS pull() that returns undefined used to go through promiseResolvedWith + performPromiseThen,
// allocating a wrapper JSPromise per chunk. callPullIfNeeded now queues the fulfilled handler
// directly, so only reader.read()'s own result promise remains per chunk.
describe.each(["default", "bytes"] as const)("pull() sync fast path (%s controller)", kind => {
  test("no wrapper promise allocated per chunk", async () => {
    const src = `
      const { heapStats } = require("bun:jsc");
      const READS = 4000;
      async function drain() {
        let i = 0;
        const rs = new ReadableStream({
          ${kind === "bytes" ? 'type: "bytes",' : ""}
          pull(c) {
            if (i++ < READS) c.enqueue(new Uint8Array(1));
            else c.close();
          },
        });
        const reader = rs.getReader();
        while (!(await reader.read()).done) {}
      }
      await drain();
      Bun.gc(true);
      const before = heapStats().objectTypeCounts.Promise || 0;
      await drain();
      const after = heapStats().objectTypeCounts.Promise || 0;
      console.log(JSON.stringify({ delta: after - before, reads: READS }));
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const { delta, reads } = JSON.parse(stdout.trim());
    // Old path: ~2*reads (wrapper + its resolve-chain). Fast path: ~1*reads (read()'s own).
    expect({ belowThreshold: delta < reads * 1.5, stderr, exitCode }).toEqual({
      belowThreshold: true,
      stderr: "",
      exitCode: 0,
    });
  });

  test("many-chunk Response(stream).arrayBuffer() does not overflow the stack", async () => {
    const N = 20000;
    const src = `
      let i = 0;
      const stream = new ReadableStream({
        ${kind === "bytes" ? 'type: "bytes",' : ""}
        pull(c) {
          if (i++ < ${N}) c.enqueue(new Uint8Array([1]));
          else c.close();
        },
      });
      console.log((await new Response(stream).arrayBuffer()).byteLength);
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: String(N), stderr: "", exitCode: 0 });
  });

  // callPullIfNeeded must not spin synchronously: a pull() that always enqueues would pin
  // a sync re-pull loop at 100% CPU and never return from read(). The microtask-deferred
  // re-pull lets read() resolve, then cancel() stops the fill and the process exits.
  test("re-pull after a sync enqueue is not a synchronous loop", async () => {
    const src = `
      const rs = new ReadableStream({
        ${kind === "bytes" ? 'type: "bytes",' : ""}
        pull(c) { c.enqueue(new Uint8Array(1)); },
      });
      const reader = rs.getReader();
      const { done } = await reader.read();
      await reader.cancel();
      console.log(done ? "bad" : "ok");
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
  });
});

// writableStreamDefaultControllerProcessWrite wrapped each sink write() return in a new
// JSPromise + performPromiseThen. The sync fast path queues onWSSinkWriteFulfilled directly,
// so only writer.write()'s own request promise remains per chunk.
test("writer.write() with a sync sink does not allocate a wrapper promise per chunk", async () => {
  const src = `
    const { heapStats } = require("bun:jsc");
    const WRITES = 4000;
    async function drain() {
      const ws = new WritableStream({ write() {} });
      const writer = ws.getWriter();
      for (let i = 0; i < WRITES; i++) await writer.write(i);
      await writer.close();
    }
    await drain();
    Bun.gc(true);
    const before = heapStats().objectTypeCounts.Promise || 0;
    await drain();
    const after = heapStats().objectTypeCounts.Promise || 0;
    console.log(JSON.stringify({ delta: after - before, writes: WRITES }));
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const { delta, writes } = JSON.parse(stdout.trim());
  // Only writer.write()'s own request promise (~1/write); the old path also allocated the
  // sink-write wrapper and a fresh readyPromise on each backpressure flip (~3/write).
  expect({ belowThreshold: delta < writes * 1.5, stderr, exitCode }).toEqual({
    belowThreshold: true,
    stderr: "",
    exitCode: 0,
  });
});

// node:stream's Readable.fromWeb() and Duplex.fromWeb() read through a read request of their own kind, which delivers
// the chunk to the node stream: no promise, no {value, done} object and no closure per chunk. With reader.read() and
// a reaction on its promise, each chunk cost 2 promises and 2 functions. Their writes still make a promise each.
test.each([
  ["Readable.fromWeb", "Readable.fromWeb(web)"],
  ["Duplex.fromWeb", "Duplex.fromWeb({ readable: web, writable: new WritableStream() })"],
])("a read of %s allocates no promise and no function per chunk", async (_, adapter) => {
  const src = `
    const { heapStats } = require("bun:jsc");
    const { Readable, Duplex } = require("node:stream");
    const READS = 2000;
    const chunk = new Uint8Array(1);
    function drain() {
      let i = 0;
      const web = new ReadableStream({
        pull(c) {
          if (i++ < READS) c.enqueue(chunk);
          else c.close();
        },
      });
      const stream = ${adapter};
      return new Promise(resolve => stream.on("data", () => {}).on("end", resolve));
    }
    await drain();
    const before = heapStats().objectTypeCounts;
    await drain();
    const after = heapStats().objectTypeCounts;
    const perChunk = name => Math.round((((after[name] || 0) - (before[name] || 0)) / READS) * 10) / 10;
    console.log(JSON.stringify({ Promise: perChunk("Promise"), Function: perChunk("Function") }));
  `;
  // Without a collection between the two counts, the difference is what the second drain allocated.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: { ...bunEnv, BUN_JSC_useGC: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ perChunk: stdout.trim() === "" ? stdout : JSON.parse(stdout), stderr, exitCode }).toEqual({
    perChunk: { Promise: 0, Function: 0 },
    stderr: "",
    exitCode: 0,
  });
});
