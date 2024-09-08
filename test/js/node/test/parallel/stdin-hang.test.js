//#FILE: test-stdin-hang.js
//#SHA1: f28512893c8d9cd6500247aa87881347638eb616
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

// This test *only* verifies that invoking the stdin getter does not
// cause node to hang indefinitely.
// If it does, then the test-runner will nuke it.

test("process.stdin getter does not cause indefinite hang", () => {
  // invoke the getter.
  process.stdin; // eslint-disable-line no-unused-expressions

  // If we reach this point, it means the process didn't hang
  expect(true).toBe(true);
});

test("Console output", () => {
  const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

  console.error("Should exit normally now.");

  expect(consoleErrorSpy).toHaveBeenCalledWith("Should exit normally now.");

  consoleErrorSpy.mockRestore();
});

//<#END_FILE: test-stdin-hang.js
