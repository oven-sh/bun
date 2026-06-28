// https://streams.spec.whatwg.org/#rs-asynciterator
import { expect, test } from "bun:test";

test("values() preventCancel keeps the remaining chunks readable after break", async () => {
  const stream = new ReadableStream({
    start(controller) {
      for (const value of [1, 2, 3, 4, 5]) controller.enqueue(value);
      controller.close();
    },
  });

  for await (const chunk of stream.values({ preventCancel: true })) {
    expect(chunk).toBe(1);
    break;
  }

  expect(stream.locked).toBe(false);

  const rest = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    rest.push(value);
  }
  expect(rest).toEqual([2, 3, 4, 5]);
});

// https://github.com/oven-sh/bun/issues/10431
test("a second iteration continues from where the first stopped with preventCancel", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    async start(controller) {
      for (const value of [1, 2, 3, 4, 5]) controller.enqueue(value);
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });

  const first = [];
  for await (const chunk of stream.values({ preventCancel: true })) {
    first.push(chunk);
    if (chunk === 3) break;
  }

  const rest = [];
  for await (const chunk of stream.values()) {
    rest.push(chunk);
  }

  expect(first).toEqual([1, 2, 3]);
  expect(rest).toEqual([4, 5]);
  expect(cancelled).toBe(false);
});

test("Symbol.asyncIterator is the values method", () => {
  expect(ReadableStream.prototype[Symbol.asyncIterator]).toBe(ReadableStream.prototype.values);

  const stream = new ReadableStream();
  expect(stream[Symbol.asyncIterator]).toBe(stream.values);
});

test("Symbol.asyncIterator accepts preventCancel", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue("a");
      controller.enqueue("b");
    },
    cancel() {
      cancelled = true;
    },
  });

  for await (const chunk of (stream as any)[Symbol.asyncIterator]({ preventCancel: true })) {
    break;
  }

  expect(cancelled).toBe(false);
  expect(stream.locked).toBe(false);
  expect(await stream.getReader().read()).toEqual({ value: "b", done: false });
});

test("for await over the stream cancels it on break by default", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue("hello");
      controller.enqueue("world");
    },
    cancel() {
      cancelled = true;
    },
  });

  for await (const chunk of stream) {
    break;
  }

  expect(cancelled).toBe(true);
  expect(stream.locked).toBe(false);
});

test("return() passes the reason to cancel", async () => {
  const { promise: cancelReason, resolve } = Promise.withResolvers();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue("a");
      controller.enqueue("b");
    },
    cancel(reason) {
      resolve(reason);
    },
  });

  const iterator = stream.values();
  expect(await iterator.next()).toEqual({ value: "a", done: false });
  expect(await iterator.return("the reason")).toEqual({ value: "the reason", done: true });
  expect(await cancelReason).toBe("the reason");
  expect(await iterator.next()).toEqual({ value: undefined, done: true });
  expect(stream.locked).toBe(false);
});

test("return() with preventCancel releases the lock without cancelling", async () => {
  let cancelCalls = 0;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue("a");
      controller.enqueue("b");
    },
    cancel() {
      cancelCalls++;
    },
  });

  const iterator = stream.values({ preventCancel: true });
  expect(await iterator.next()).toEqual({ value: "a", done: false });
  expect(await iterator.return("ignored")).toEqual({ value: "ignored", done: true });
  expect(cancelCalls).toBe(0);
  expect(stream.locked).toBe(false);
  expect(await stream.getReader().read()).toEqual({ value: "b", done: false });
});

test("values() locks the stream and throws if it is already locked", () => {
  const stream = new ReadableStream();
  stream.values();
  expect(stream.locked).toBe(true);
  expect(() => stream.values()).toThrow(TypeError);
});

test("values() rejects non-object options", () => {
  const stream = new ReadableStream();
  expect(() => stream.values(42 as any)).toThrow(TypeError);
  // null and undefined are valid per WebIDL dictionary conversion.
  stream.values(null as any);
  expect(stream.locked).toBe(true);
});

test("the lock is released when the stream errors during iteration", async () => {
  const error = new Error("boom");
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue("a");
    },
    pull(controller) {
      controller.error(error);
    },
  });

  const chunks = [];
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    expect.unreachable();
  } catch (e) {
    expect(e).toBe(error);
  }
  expect(chunks).toEqual(["a"]);
  expect(stream.locked).toBe(false);
});

test("interleaved next() and return() calls resolve in order", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(1);
      controller.enqueue(2);
      controller.enqueue(3);
      controller.close();
    },
  });

  const iterator = stream[Symbol.asyncIterator]();
  const results = await Promise.all([iterator.next(), iterator.next(), iterator.return(9), iterator.next()]);
  expect(results).toEqual([
    { value: 1, done: false },
    { value: 2, done: false },
    { value: 9, done: true },
    { value: undefined, done: true },
  ]);
});

test("next() and return() reject when called on the wrong receiver", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue("a");
      controller.close();
    },
  });

  const iterator = stream.values();
  await expect(iterator.next.call({})).rejects.toThrow(TypeError);
  await expect((iterator.return as Function).call({}, "x")).rejects.toThrow(TypeError);
  // The detached calls did not consume or cancel the stream.
  expect(await iterator.next()).toEqual({ value: "a", done: false });
});

test("full iteration releases the lock and does not call cancel", async () => {
  let cancelCalls = 0;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue("hello");
      controller.enqueue("world");
      controller.close();
    },
    cancel() {
      cancelCalls++;
    },
  });

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  expect(chunks).toEqual(["hello", "world"]);
  expect(cancelCalls).toBe(0);
  expect(stream.locked).toBe(false);
});
