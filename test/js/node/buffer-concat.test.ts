import { expect, test } from "bun:test";

test("Buffer.concat throws OutOfMemoryError", () => {
  const bufferToUse = Buffer.allocUnsafe(1024 * 1024 * 64);
  const buffers = new Array(1024);
  for (let i = 0; i < buffers.length; i++) {
    buffers[i] = bufferToUse;
  }

  expect(() => Buffer.concat(buffers)).toThrow(/out of memory/i);
});

test("Bun.concatArrayBuffers throws OutOfMemoryError", () => {
  const bufferToUse = Buffer.allocUnsafe(1024 * 1024 * 64);
  const buffers = new Array(1024);
  for (let i = 0; i < buffers.length; i++) {
    buffers[i] = bufferToUse;
  }

  expect(() => Bun.concatArrayBuffers(buffers)).toThrow(/Failed to allocate/i);
});
