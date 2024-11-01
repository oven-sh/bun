//#FILE: test-buffer-no-negative-allocation.js
//#SHA1: c7f13ec857490bc5d1ffbf8da3fff19049c421f8
//-----------------
"use strict";

const { SlowBuffer } = require("buffer");

// Test that negative Buffer length inputs throw errors.

const msg = expect.objectContaining({
  code: "ERR_OUT_OF_RANGE",
  name: "RangeError",
  message: expect.any(String),
});

test("Buffer constructor throws on negative or NaN length", () => {
  expect(() => Buffer(-Buffer.poolSize)).toThrow(msg);
  expect(() => Buffer(-100)).toThrow(msg);
  expect(() => Buffer(-1)).toThrow(msg);
  expect(() => Buffer(NaN)).toThrow(msg);
});

test("Buffer.alloc throws on negative or NaN length", () => {
  expect(() => Buffer.alloc(-Buffer.poolSize)).toThrow(msg);
  expect(() => Buffer.alloc(-100)).toThrow(msg);
  expect(() => Buffer.alloc(-1)).toThrow(msg);
  expect(() => Buffer.alloc(NaN)).toThrow(msg);
});

test("Buffer.allocUnsafe throws on negative or NaN length", () => {
  expect(() => Buffer.allocUnsafe(-Buffer.poolSize)).toThrow(msg);
  expect(() => Buffer.allocUnsafe(-100)).toThrow(msg);
  expect(() => Buffer.allocUnsafe(-1)).toThrow(msg);
  expect(() => Buffer.allocUnsafe(NaN)).toThrow(msg);
});

test("Buffer.allocUnsafeSlow throws on negative or NaN length", () => {
  expect(() => Buffer.allocUnsafeSlow(-Buffer.poolSize)).toThrow(msg);
  expect(() => Buffer.allocUnsafeSlow(-100)).toThrow(msg);
  expect(() => Buffer.allocUnsafeSlow(-1)).toThrow(msg);
  expect(() => Buffer.allocUnsafeSlow(NaN)).toThrow(msg);
});

test("SlowBuffer throws on negative or NaN length", () => {
  expect(() => SlowBuffer(-Buffer.poolSize)).toThrow(msg);
  expect(() => SlowBuffer(-100)).toThrow(msg);
  expect(() => SlowBuffer(-1)).toThrow(msg);
  expect(() => SlowBuffer(NaN)).toThrow(msg);
});

//<#END_FILE: test-buffer-no-negative-allocation.js
