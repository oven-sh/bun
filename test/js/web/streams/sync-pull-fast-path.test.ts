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

// Only a result that cannot be a thenable may skip the wrapper. Web IDL converts what a
// Promise-returning callback returns into "a new promise resolved with" it, and the stream reacts to
// that new promise. Adopting a native promise takes two more microtasks than reacting to it
// directly, and the source/sink observes them: they decide whether its own jobs run before or after
// the stream calls it again.
describe("a promise returned from pull(), write() or close() is adopted, not reacted to directly", () => {
  // `now` counts passes through the microtask queue.
  function microtaskClock() {
    let now = 0;
    let running = true;
    (function tick() {
      now++;
      if (running) queueMicrotask(tick);
    })();
    return {
      get now() {
        return now;
      },
      stop() {
        running = false;
      },
    };
  }
  const distances = (calledAt: number[]) => calledAt.slice(1).map((at, i) => at - calledAt[i]);
  // The callback is called at tick T and its promise settles `awaits` ticks later (at once with no
  // await). The adoption job runs at T+1, the adopted promise settles one tick after the later of
  // the two, and the stream's reaction (the next call) runs one tick after that.
  const expectedDistance = (awaits: number) => Math.max(awaits, 1) + 2;

  describe.each(["default", "bytes"] as const)("%s controller", kind => {
    test.each([0, 1, 2])("async pull() with %d await(s)", async awaits => {
      const clock = microtaskClock();
      const calledAt: number[] = [];
      const { promise: done, resolve } = Promise.withResolvers<void>();
      new ReadableStream(
        {
          type: kind === "bytes" ? "bytes" : undefined,
          async pull(c) {
            calledAt.push(clock.now);
            for (let i = 0; i < awaits; i++) await null;
            c.enqueue(new Uint8Array(1));
            if (calledAt.length === 4) {
              c.close();
              resolve();
            }
          },
        },
        { highWaterMark: 10 },
      );
      await done;
      clock.stop();
      const d = expectedDistance(awaits);
      expect(distances(calledAt)).toEqual([d, d, d]);
    });
  });

  test.each([0, 1, 2])("async write() with %d await(s)", async awaits => {
    const clock = microtaskClock();
    const calledAt: number[] = [];
    const writer = new WritableStream(
      {
        async write() {
          calledAt.push(clock.now);
          for (let i = 0; i < awaits; i++) await null;
        },
      },
      { highWaterMark: 10 },
    ).getWriter();
    await writer.ready;
    writer.write(1);
    writer.write(2);
    writer.write(3);
    await writer.write(4);
    clock.stop();
    const d = expectedDistance(awaits);
    expect(distances(calledAt)).toEqual([d, d, d]);
  });

  test.each([0, 1, 2])("async close() with %d await(s)", async awaits => {
    const clock = microtaskClock();
    const writer = new WritableStream({
      async close() {
        for (let i = 0; i < awaits; i++) await null;
      },
    }).getWriter();
    await writer.ready;
    // writer.close() calls the sink's close() at once. The stream's reaction settles the promise
    // that writer.close() returned, and this then() callback runs one tick after that.
    const before = clock.now;
    const settledAfter = await writer.close().then(() => clock.now - before);
    clock.stop();
    expect(settledAfter).toBe(expectedDistance(awaits) + 1);
  });

  // With the default highWaterMark of 1 the pipe reads again once the write of "a" has finished. A
  // pull() that is called again too early enqueues "b" before that read exists, so "b" sits in the
  // source's queue, and error() resets the queue / the abort shuts the pipe down before it is read.
  test.each([
    ["controller.error()", {}, { result: "rejected: boom", sink: ["a", "b", "abort: boom"] }],
    ["controller.error() with preventAbort", { preventAbort: true }, { result: "rejected: boom", sink: ["a", "b"] }],
    ["signal.abort()", { abort: true }, { result: "rejected: sig", sink: ["a", "b", "abort: sig"] }],
  ] as const)("pipeTo() writes the chunk an async pull() enqueues right before %s", async (_, options, expected) => {
    const ac = new AbortController();
    const sink: string[] = [];
    let pulls = 0;
    const readable = new ReadableStream({
      async pull(c) {
        await null;
        if (++pulls === 1) return c.enqueue("a");
        c.enqueue("b");
        if ("abort" in options) ac.abort(new Error("sig"));
        else c.error(new Error("boom"));
      },
    });
    const writable = new WritableStream({
      write(chunk) {
        sink.push(chunk);
      },
      abort(reason) {
        sink.push("abort: " + reason.message);
      },
    });
    const result = await readable.pipeTo(writable, { signal: ac.signal, preventAbort: "preventAbort" in options }).then(
      () => "resolved",
      e => "rejected: " + e.message,
    );
    expect({ result, sink }).toEqual(expected);
  });
});
