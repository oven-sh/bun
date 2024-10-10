//#FILE: test-stdin-resume-pause.js
//#SHA1: ef96cec1b4e29ec6b96da37fd44e3bbdb50e1393
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

test("process.stdin can be resumed and paused", () => {
  const originalResume = process.stdin.resume;
  const originalPause = process.stdin.pause;

  const mockResume = jest.fn();
  const mockPause = jest.fn();

  process.stdin.resume = mockResume;
  process.stdin.pause = mockPause;

  process.stdin.resume();
  process.stdin.pause();

  expect(mockResume).toHaveBeenCalledTimes(1);
  expect(mockPause).toHaveBeenCalledTimes(1);

  // Restore original methods
  process.stdin.resume = originalResume;
  process.stdin.pause = originalPause;
});

//<#END_FILE: test-stdin-resume-pause.js
