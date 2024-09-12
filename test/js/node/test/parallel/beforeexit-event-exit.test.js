//#FILE: test-beforeexit-event-exit.js
//#SHA1: 27b6351612c5ec4f51d3317ca1c89511b833eaab
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

test("beforeExit event should not be called when process.exit() is called", () => {
  const mockBeforeExit = jest.fn();
  process.on("beforeExit", mockBeforeExit);

  // Spy on process.exit to prevent actual exit
  const exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});

  process.exit();

  expect(mockBeforeExit).not.toHaveBeenCalled();
  expect(exitSpy).toHaveBeenCalled();

  // Clean up
  process.removeListener("beforeExit", mockBeforeExit);
  exitSpy.mockRestore();
});

//<#END_FILE: test-beforeexit-event-exit.js
