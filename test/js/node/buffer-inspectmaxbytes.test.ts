import { expect, test } from "bun:test";
import buffer, { INSPECT_MAX_BYTES } from "node:buffer";
import util from "node:util";

test("buffer.INSPECT_MAX_BYTES is a number and not a custom getter/setter", () => {
  const originalINSPECT_MAX_BYTES = INSPECT_MAX_BYTES;
  expect(INSPECT_MAX_BYTES).toBeNumber();
  expect(buffer.INSPECT_MAX_BYTES).toBeNumber();
  buffer.INSPECT_MAX_BYTES = 1000;
  expect(buffer.INSPECT_MAX_BYTES).toBe(1000);
  expect(INSPECT_MAX_BYTES).toBe(originalINSPECT_MAX_BYTES);
  buffer.INSPECT_MAX_BYTES = originalINSPECT_MAX_BYTES;
  expect(INSPECT_MAX_BYTES).toBe(originalINSPECT_MAX_BYTES);
});

test("util.inspect(Buffer) with INSPECT_MAX_BYTES = 0 matches Node.js formatting", () => {
  const original = buffer.INSPECT_MAX_BYTES;
  try {
    const b = Buffer.from([1, 2]);

    buffer.INSPECT_MAX_BYTES = 0;
    expect(util.inspect(b)).toBe("<Buffer  ... 2 more bytes>");
    expect(util.inspect(Buffer.from([1]))).toBe("<Buffer  ... 1 more byte>");
    expect(util.inspect(Buffer.alloc(0))).toBe("<Buffer >");

    buffer.INSPECT_MAX_BYTES = 1;
    expect(util.inspect(b)).toBe("<Buffer 01 ... 1 more byte>");

    buffer.INSPECT_MAX_BYTES = 2;
    expect(util.inspect(b)).toBe("<Buffer 01 02>");
  } finally {
    buffer.INSPECT_MAX_BYTES = original;
  }
});
