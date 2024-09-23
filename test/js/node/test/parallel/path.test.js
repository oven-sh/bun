//#FILE: test-path.js
//#SHA1: da9d0113e57d9da3983b555973f7835c17657326
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
const path = require("path");

// Test thrown TypeErrors
const typeErrorTests = [true, false, 7, null, {}, undefined, [], NaN];

function fail(fn) {
  const args = Array.from(arguments).slice(1);

  expect(() => {
    fn.apply(null, args);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
    }),
  );
}

test("Invalid argument types", () => {
  for (const test of typeErrorTests) {
    for (const namespace of [path.posix, path.win32]) {
      fail(namespace.join, test);
      fail(namespace.resolve, test);
      fail(namespace.normalize, test);
      fail(namespace.isAbsolute, test);
      fail(namespace.relative, test, "foo");
      fail(namespace.relative, "foo", test);
      fail(namespace.parse, test);
      fail(namespace.dirname, test);
      fail(namespace.basename, test);
      fail(namespace.extname, test);

      // Undefined is a valid value as the second argument to basename
      if (test !== undefined) {
        fail(namespace.basename, "foo", test);
      }
    }
  }
});

test("path.sep tests", () => {
  // windows
  expect(path.win32.sep).toBe("\\");
  // posix
  expect(path.posix.sep).toBe("/");
});

test("path.delimiter tests", () => {
  // windows
  expect(path.win32.delimiter).toBe(";");
  // posix
  expect(path.posix.delimiter).toBe(":");
});

test("path module", () => {
  if (process.platform === "win32") {
    expect(path).toBe(path.win32);
  } else {
    expect(path).toBe(path.posix);
  }
});

//<#END_FILE: test-path.js
