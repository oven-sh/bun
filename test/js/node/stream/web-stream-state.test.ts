import { expect, test } from "bun:test";
import { isDisturbed, isErrored, isReadable, isWritable } from "node:stream";

test("node:stream observes ReadableStream state", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });

  expect(isReadable(stream)).toBe(true);
  expect(isErrored(stream)).toBe(false);
  expect(isDisturbed(stream)).toBe(false);

  controller.enqueue(new Uint8Array([1]));
  const reader = stream.getReader();
  await reader.read();
  expect(isReadable(stream)).toBe(true);
  expect(isDisturbed(stream)).toBe(true);

  controller.close();
  await reader.closed;
  expect(isReadable(stream)).toBe(false);
  expect(isErrored(stream)).toBe(false);
});

test("node:stream observes errored ReadableStreams", () => {
  let controller!: ReadableStreamDefaultController;
  const stream = new ReadableStream({
    start(value) {
      controller = value;
    },
  });

  controller.error(new Error("fixture stream error"));

  expect(isReadable(stream)).toBe(false);
  expect(isErrored(stream)).toBe(true);
});

const writableState = (stream: unknown) => ({ isWritable: isWritable(stream), isErrored: isErrored(stream) });

test("node:stream observes WritableStream state", async () => {
  const closeStarted = Promise.withResolvers<void>();
  const closeFinished = Promise.withResolvers<void>();
  const stream = new WritableStream({
    write() {},
    close() {
      closeStarted.resolve();
      return closeFinished.promise;
    },
  });
  expect(writableState(stream)).toEqual({ isWritable: true, isErrored: false });

  // A lock does not change the state. Node reports `state === "writable"` only.
  const writer = stream.getWriter();
  await writer.write("chunk");
  expect(writableState(stream)).toEqual({ isWritable: true, isErrored: false });

  // The stream stays "writable" until the sink's close() settles.
  const closed = writer.close();
  await closeStarted.promise;
  expect(writableState(stream)).toEqual({ isWritable: true, isErrored: false });

  closeFinished.resolve();
  await closed;
  expect(writableState(stream)).toEqual({ isWritable: false, isErrored: false });

  // A WritableStream has no readable side and no [[disturbed]] slot.
  expect(isReadable(stream)).toBe(null);
  expect(isDisturbed(stream)).toBe(false);
});

test("node:stream observes errored WritableStreams", async () => {
  let controller!: WritableStreamDefaultController;
  const stream = new WritableStream({
    start(value) {
      controller = value;
    },
  });

  // start() has not settled yet, so the stream waits in "erroring".
  controller.error(new Error("fixture stream error"));
  expect(writableState(stream)).toEqual({ isWritable: false, isErrored: false });

  await stream.getWriter().closed.catch(() => {});
  expect(writableState(stream)).toEqual({ isWritable: false, isErrored: true });
});

test("node:stream reports an erroring WritableStream as errored only after the in-flight write settles", async () => {
  const writeStarted = Promise.withResolvers<void>();
  const writeFinished = Promise.withResolvers<void>();
  const stream = new WritableStream({
    write() {
      writeStarted.resolve();
      return writeFinished.promise;
    },
  });
  const writer = stream.getWriter();
  const written = writer.write("chunk");
  await writeStarted.promise;
  expect(writableState(stream)).toEqual({ isWritable: true, isErrored: false });

  const aborted = writer.abort(new Error("fixture abort reason"));
  expect(writableState(stream)).toEqual({ isWritable: false, isErrored: false });

  writeFinished.resolve();
  await Promise.all([aborted, written]);
  expect(writableState(stream)).toEqual({ isWritable: false, isErrored: true });
});

test("node:stream observes the writable side of a TransformStream", () => {
  const transform = new TransformStream();
  expect(writableState(transform.writable)).toEqual({ isWritable: true, isErrored: false });
  // Node does not brand TransformStream itself.
  expect(writableState(transform)).toEqual({ isWritable: null, isErrored: false });
});

test("WritableStream.prototype state getters have the same shape as Node's", () => {
  for (const key of ["nodejs.stream.writable", "nodejs.stream.errored"]) {
    const descriptor = Object.getOwnPropertyDescriptor(WritableStream.prototype, Symbol.for(key));
    expect({ key, ...descriptor, get: typeof descriptor?.get }).toEqual({
      key,
      get: "function",
      set: undefined,
      enumerable: false,
      configurable: true,
    });
    expect(() => descriptor!.get!.call({})).toThrow(TypeError);
  }
});
