//#FILE: test-timers-ordering.js
//#SHA1: b2be662b4e86125b4dcd87ced4316d84acf57912
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

const N = 30;

test("Timer ordering and timing", async () => {
  let last_i = 0;
  let last_ts = 0;

  function f(i) {
    return new Promise(resolve => {
      if (i <= N) {
        // check order
        expect(i).toBe(last_i + 1);
        last_i = i;

        // Check that this iteration is fired at least 1ms later than the previous
        const now = Date.now();
        expect(now).toBeGreaterThanOrEqual(last_ts + 1);
        last_ts = now;

        // Schedule next iteration
        setTimeout(() => resolve(f(i + 1)), 1);
      } else {
        resolve();
      }
    });
  }

  await f(1);
}, 10000); // Increased timeout to ensure all iterations complete

//<#END_FILE: test-timers-ordering.js
