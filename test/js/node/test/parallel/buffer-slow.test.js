//#FILE: test-buffer-slow.js
//#SHA1: fadf639fe26752f00488a41a29f1977f95fc1c79
//-----------------
"use strict";

const buffer = require("buffer");
const SlowBuffer = buffer.SlowBuffer;

const ones = [1, 1, 1, 1];

test("SlowBuffer should create a Buffer", () => {
  let sb = SlowBuffer(4);
  expect(sb).toBeInstanceOf(Buffer);
  expect(sb.length).toBe(4);
  sb.fill(1);
  for (const [key, value] of sb.entries()) {
    expect(value).toBe(ones[key]);
  }

  // underlying ArrayBuffer should have the same length
  expect(sb.buffer.byteLength).toBe(4);
});

test("SlowBuffer should work without new", () => {
  let sb = SlowBuffer(4);
  expect(sb).toBeInstanceOf(Buffer);
  expect(sb.length).toBe(4);
  sb.fill(1);
  for (const [key, value] of sb.entries()) {
    expect(value).toBe(ones[key]);
  }
});

test("SlowBuffer should work with edge cases", () => {
  expect(SlowBuffer(0).length).toBe(0);
});

test("SlowBuffer should throw with invalid length type", () => {
  const bufferInvalidTypeMsg = expect.objectContaining({
    code: "ERR_INVALID_ARG_TYPE",
    name: "TypeError",
    message: expect.any(String),
  });

  expect(() => SlowBuffer()).toThrow(bufferInvalidTypeMsg);
  expect(() => SlowBuffer({})).toThrow(bufferInvalidTypeMsg);
  expect(() => SlowBuffer("6")).toThrow(bufferInvalidTypeMsg);
  expect(() => SlowBuffer(true)).toThrow(bufferInvalidTypeMsg);
});

test("SlowBuffer should throw with invalid length value", () => {
  const bufferMaxSizeMsg = expect.objectContaining({
    code: "ERR_OUT_OF_RANGE",
    name: "RangeError",
    message: expect.any(String),
  });

  expect(() => SlowBuffer(NaN)).toThrow(bufferMaxSizeMsg);
  expect(() => SlowBuffer(Infinity)).toThrow(bufferMaxSizeMsg);
  expect(() => SlowBuffer(-1)).toThrow(bufferMaxSizeMsg);
  expect(() => SlowBuffer(buffer.kMaxLength + 1)).toThrow(bufferMaxSizeMsg);
});

//<#END_FILE: test-buffer-slow.js
