//#FILE: test-process-uptime.js
//#SHA1: 98140b3c8b495ef62c519ca900eeb15f1ef5b5aa
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

test("process.uptime() returns a reasonable value", () => {
  console.error(process.uptime());
  // Add some wiggle room for different platforms.
  // Verify that the returned value is in seconds -
  // 15 seconds should be a good estimate.
  expect(process.uptime()).toBeLessThanOrEqual(15);
});

test("process.uptime() increases over time", async () => {
  const original = process.uptime();

  await new Promise(resolve => setTimeout(resolve, 10));

  const uptime = process.uptime();
  expect(uptime).toBeGreaterThan(original);
});

//<#END_FILE: test-process-uptime.js
