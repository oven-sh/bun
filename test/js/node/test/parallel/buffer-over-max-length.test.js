//#FILE: test-buffer-over-max-length.js
//#SHA1: 797cb237a889a5f09d34b2554a46eb4c545f885e
//-----------------
"use strict";

const buffer = require("buffer");
const SlowBuffer = buffer.SlowBuffer;

const kMaxLength = buffer.kMaxLength;
const bufferMaxSizeMsg = expect.objectContaining({
  code: "ERR_OUT_OF_RANGE",
  name: "RangeError",
  message: expect.stringContaining(`The value of "size" is out of range.`),
});

test("Buffer creation with over max length", () => {
  expect(() => Buffer(kMaxLength + 1)).toThrow(bufferMaxSizeMsg);
  expect(() => SlowBuffer(kMaxLength + 1)).toThrow(bufferMaxSizeMsg);
  expect(() => Buffer.alloc(kMaxLength + 1)).toThrow(bufferMaxSizeMsg);
  expect(() => Buffer.allocUnsafe(kMaxLength + 1)).toThrow(bufferMaxSizeMsg);
  expect(() => Buffer.allocUnsafeSlow(kMaxLength + 1)).toThrow(bufferMaxSizeMsg);
});

//<#END_FILE: test-buffer-over-max-length.js
