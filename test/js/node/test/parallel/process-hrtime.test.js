//#FILE: test-process-hrtime.js
//#SHA1: 99ce31a994db014be4c3835d3a5d46ed3ec3a89e
//-----------------
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

"use strict";

test("process.hrtime() default behavior", () => {
  // The default behavior, return an Array "tuple" of numbers
  const tuple = process.hrtime();

  // Validate the default behavior
  validateTuple(tuple);
});

test("process.hrtime() with existing tuple", () => {
  const tuple = process.hrtime();
  // Validate that passing an existing tuple returns another valid tuple
  validateTuple(process.hrtime(tuple));
});

test("process.hrtime() with invalid arguments", () => {
  // Test that only an Array may be passed to process.hrtime()
  expect(() => {
    process.hrtime(1);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
      message: expect.any(String),
    }),
  );

  expect(() => {
    process.hrtime([]);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );

  expect(() => {
    process.hrtime([1]);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );

  expect(() => {
    process.hrtime([1, 2, 3]);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_OUT_OF_RANGE",
      name: "RangeError",
      message: expect.any(String),
    }),
  );
});

function validateTuple(tuple) {
  expect(Array.isArray(tuple)).toBe(true);
  expect(tuple).toHaveLength(2);
  expect(Number.isInteger(tuple[0])).toBe(true);
  expect(Number.isInteger(tuple[1])).toBe(true);
}

test("process.hrtime() diff", () => {
  const diff = process.hrtime([0, 1e9 - 1]);
  expect(diff[1]).toBeGreaterThanOrEqual(0); // https://github.com/nodejs/node/issues/4751
});

//<#END_FILE: test-process-hrtime.js
