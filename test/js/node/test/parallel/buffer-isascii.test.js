//#FILE: test-buffer-isascii.js
//#SHA1: e49cbd0752feaa8042a90129dfb38610eb002ee6
//-----------------
"use strict";

const { isAscii, Buffer } = require("buffer");
const { TextEncoder } = require("util");

const encoder = new TextEncoder();

test("isAscii function", () => {
  expect(isAscii(encoder.encode("hello"))).toBe(true);
  expect(isAscii(encoder.encode("ğ"))).toBe(false);
  expect(isAscii(Buffer.from([]))).toBe(true);
});

test("isAscii with invalid inputs", () => {
  const invalidInputs = [undefined, "", "hello", false, true, 0, 1, 0n, 1n, Symbol(), () => {}, {}, [], null];

  invalidInputs.forEach(input => {
    expect(() => isAscii(input)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
      }),
    );
  });
});

test("isAscii with detached array buffer", () => {
  const arrayBuffer = new ArrayBuffer(1024);
  structuredClone(arrayBuffer, { transfer: [arrayBuffer] });

  expect(() => isAscii(arrayBuffer)).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_STATE",
    }),
  );
});

//<#END_FILE: test-buffer-isascii.js
