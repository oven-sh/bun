//#FILE: test-buffer-parent-property.js
//#SHA1: 1496dde41464d188eecd053b64a320c71f62bd7d
//-----------------
"use strict";

// Fix for https://github.com/nodejs/node/issues/8266
//
// Zero length Buffer objects should expose the `buffer` property of the
// TypedArrays, via the `parent` property.

test("Buffer parent property", () => {
  // If the length of the buffer object is zero
  expect(Buffer.alloc(0).parent).toBeInstanceOf(ArrayBuffer);

  // If the length of the buffer object is equal to the underlying ArrayBuffer
  expect(Buffer.alloc(Buffer.poolSize).parent).toBeInstanceOf(ArrayBuffer);

  // Same as the previous test, but with user created buffer
  const arrayBuffer = new ArrayBuffer(0);
  expect(Buffer.from(arrayBuffer).parent).toBe(arrayBuffer);
  expect(Buffer.from(arrayBuffer).buffer).toBe(arrayBuffer);
  expect(Buffer.from(arrayBuffer).parent).toBe(arrayBuffer);
  expect(Buffer.from(arrayBuffer).buffer).toBe(arrayBuffer);
});

//<#END_FILE: test-buffer-parent-property.js
