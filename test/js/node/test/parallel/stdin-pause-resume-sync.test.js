//#FILE: test-stdin-pause-resume-sync.js
//#SHA1: 2256a91336e221a1770b59ebebb4afb406a770dd
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

test("stdin pause and resume", () => {
  const consoleSpy = jest.spyOn(console, "error");
  const stdinResumeSpy = jest.spyOn(process.stdin, "resume");
  const stdinPauseSpy = jest.spyOn(process.stdin, "pause");

  console.error("before opening stdin");
  process.stdin.resume();
  console.error("stdin opened");
  console.error("pausing stdin");
  process.stdin.pause();
  console.error("opening again");
  process.stdin.resume();
  console.error("pausing again");
  process.stdin.pause();
  console.error("should exit now");

  expect(consoleSpy).toHaveBeenCalledTimes(6);
  expect(consoleSpy).toHaveBeenNthCalledWith(1, "before opening stdin");
  expect(consoleSpy).toHaveBeenNthCalledWith(2, "stdin opened");
  expect(consoleSpy).toHaveBeenNthCalledWith(3, "pausing stdin");
  expect(consoleSpy).toHaveBeenNthCalledWith(4, "opening again");
  expect(consoleSpy).toHaveBeenNthCalledWith(5, "pausing again");
  expect(consoleSpy).toHaveBeenNthCalledWith(6, "should exit now");

  expect(stdinResumeSpy).toHaveBeenCalledTimes(2);
  expect(stdinPauseSpy).toHaveBeenCalledTimes(2);

  consoleSpy.mockRestore();
  stdinResumeSpy.mockRestore();
  stdinPauseSpy.mockRestore();
});

//<#END_FILE: test-stdin-pause-resume-sync.js
