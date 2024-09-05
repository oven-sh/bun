//#FILE: test-memory-usage.js
//#SHA1: fffba1b4ff9ad7092d9a8f51b2799a0606d769eb
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

// Flags: --predictable-gc-schedule
"use strict";

const isIBMi = process.platform === "aix" && process.execPath.includes("powerpc");

test("memory usage", () => {
  const r = process.memoryUsage();
  // On IBMi, the rss memory always returns zero
  if (!isIBMi) {
    expect(r.rss).toBeGreaterThan(0);
    expect(process.memoryUsage.rss()).toBeGreaterThan(0);
  }

  expect(r.heapTotal).toBeGreaterThan(0);
  expect(r.heapUsed).toBeGreaterThan(0);
  expect(r.external).toBeGreaterThan(0);

  expect(typeof r.arrayBuffers).toBe("number");
  if (r.arrayBuffers > 0) {
    const size = 10 * 1024 * 1024;
    // eslint-disable-next-line no-unused-vars
    const ab = new ArrayBuffer(size);

    const after = process.memoryUsage();
    expect(after.external - r.external).toBeGreaterThanOrEqual(size);
    expect(after.arrayBuffers - r.arrayBuffers).toBe(size);
  }
});

//<#END_FILE: test-memory-usage.js
