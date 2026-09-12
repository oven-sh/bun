import { expect, test } from "bun:test";
import { isDisturbed, isErrored, isReadable } from "node:stream";

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
