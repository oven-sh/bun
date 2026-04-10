// https://github.com/oven-sh/bun/issues/29123
// TransformStream: flush() must only fire after all pending async transform()
// calls have resolved. Prior to the fix, extra promise-capability wrappers in
// performTransform and sinkWriteAlgorithm added microtask hops that could let
// a queued close sentinel race ahead of the transform's completion.

import { expect, test } from "bun:test";

test("TransformStream: flush runs after async transform resolves (minimal)", async () => {
  let transformComplete = false;
  let flushTransformCompleteState: boolean | null = null;

  const ts = new TransformStream({
    async transform(chunk, controller) {
      // Multiple microtask boundaries — no wall-clock timer so the test
      // doesn't become flaky under load. Each await gives the close
      // sentinel a chance to race ahead of the transform's completion.
      await Promise.resolve();
      await new Promise<void>(r => queueMicrotask(r));
      await Promise.resolve();
      transformComplete = true;
      controller.enqueue(chunk);
    },
    flush() {
      flushTransformCompleteState = transformComplete;
    },
  });

  const writer = ts.writable.getWriter();
  const reader = ts.readable.getReader();

  writer.write("c1");
  writer.close();

  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }

  expect(flushTransformCompleteState).toBe(true);
});

test("TransformStream: flush runs after async transform resolves (many chunks)", async () => {
  const N = 10;
  let transformsFinished = 0;
  let flushState: number | null = null;

  const ts = new TransformStream({
    async transform(chunk, controller) {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      transformsFinished++;
      controller.enqueue(chunk);
    },
    flush() {
      flushState = transformsFinished;
    },
  });

  const writer = ts.writable.getWriter();
  const reader = ts.readable.getReader();

  const writes: Promise<void>[] = [];
  for (let i = 0; i < N; i++) writes.push(writer.write(i));
  writes.push(writer.close());

  const received: unknown[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received.push(value);
  }
  await Promise.all(writes);

  expect(received).toHaveLength(N);
  expect(flushState).toBe(N);
});

test("TransformStream: flush runs after async transform resolves (pipeThrough)", async () => {
  const N = 20;
  let transformsFinished = 0;
  let flushState: number | null = null;

  const source = new ReadableStream<number>({
    start(c) {
      for (let i = 0; i < N; i++) c.enqueue(i);
      c.close();
    },
  });

  const ts = new TransformStream<number, number>({
    async transform(chunk, controller) {
      // Multiple await boundaries to stress the microtask scheduling.
      await Promise.resolve();
      await new Promise(r => queueMicrotask(r));
      await Promise.resolve();
      transformsFinished++;
      controller.enqueue(chunk);
    },
    flush() {
      flushState = transformsFinished;
    },
  });

  const reader = source.pipeThrough(ts).getReader();
  const received: number[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received.push(value as number);
  }

  expect(received).toHaveLength(N);
  expect(flushState).toBe(N);
});

test("TransformStream: transform errors still propagate through write", async () => {
  const err = new Error("transform bang");
  const ts = new TransformStream({
    async transform() {
      await Promise.resolve();
      throw err;
    },
  });

  const writer = ts.writable.getWriter();
  const reader = ts.readable.getReader();

  // TransformStream starts with backpressure=true, so writer.write() can't
  // even reach the transform until a reader pulls. Drain concurrently.
  const readDone = (async () => {
    try {
      while (!(await reader.read()).done) {}
    } catch {
      // Reader surfaces the errored readable side; that's expected.
    }
  })();

  // The write promise should reject with the thrown error.
  await expect(async () => {
    await writer.write("x");
  }).toThrow(err);

  await readDone;
});

test("TransformStream: flush does not run if transform throws", async () => {
  const err = new Error("transform bang");
  let flushRan = false;

  const ts = new TransformStream({
    async transform() {
      await Promise.resolve();
      throw err;
    },
    flush() {
      flushRan = true;
    },
  });

  const writer = ts.writable.getWriter();
  const reader = ts.readable.getReader();

  // See test above — concurrent reader drains so the write isn't blocked on
  // backpressure.
  const readDone = (async () => {
    try {
      while (!(await reader.read()).done) {}
    } catch {}
  })();

  await expect(async () => {
    await writer.write("x");
  }).toThrow(err);
  // Closing an errored stream should reject, and flush should not run.
  await expect(async () => {
    await writer.close();
  }).toThrow();

  await readDone;
  expect(flushRan).toBe(false);
});
