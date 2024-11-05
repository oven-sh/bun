//#FILE: test-buffer-tostring-rangeerror.js
//#SHA1: c5bd04a7b4f3b7ecfb3898262dd73da29a9ad162
//-----------------
"use strict";

// This test ensures that Node.js throws an Error when trying to convert a
// large buffer into a string.
// Regression test for https://github.com/nodejs/node/issues/649.

const {
  SlowBuffer,
  constants: { MAX_STRING_LENGTH },
} = require("buffer");

const len = MAX_STRING_LENGTH + 1;
const errorMatcher = expect.objectContaining({
  code: "ERR_STRING_TOO_LONG",
  name: "Error",
  message: `Cannot create a string longer than 2147483647 characters`,
});

test("Buffer toString with large buffer throws RangeError", () => {
  expect(() => Buffer(len).toString("utf8")).toThrow(errorMatcher);
  expect(() => SlowBuffer(len).toString("utf8")).toThrow(errorMatcher);
  expect(() => Buffer.alloc(len).toString("utf8")).toThrow(errorMatcher);
  expect(() => Buffer.allocUnsafe(len).toString("utf8")).toThrow(errorMatcher);
  expect(() => Buffer.allocUnsafeSlow(len).toString("utf8")).toThrow(errorMatcher);
});

//<#END_FILE: test-buffer-tostring-rangeerror.js
