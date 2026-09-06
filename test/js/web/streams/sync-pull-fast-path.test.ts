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
