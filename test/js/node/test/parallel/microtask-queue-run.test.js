//#FILE: test-microtask-queue-run.js
//#SHA1: caf14b2c15bbc84816eb2ce6b9bdb073c009b447
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

function enqueueMicrotask(fn) {
  Promise.resolve().then(fn);
}

test("microtask queue runs correctly", async () => {
  let done = 0;

  // No nextTick, microtask
  await new Promise(resolve => {
    setTimeout(() => {
      enqueueMicrotask(() => {
        done++;
        resolve();
      });
    }, 0);
  });

  // No nextTick, microtask with nextTick
  await new Promise(resolve => {
    setTimeout(() => {
      let called = false;

      enqueueMicrotask(() => {
        process.nextTick(() => {
          called = true;
        });
      });

      setTimeout(() => {
        if (called) {
          done++;
        }
        resolve();
      }, 0);
    }, 0);
  });

  expect(done).toBe(2);
});

//<#END_FILE: test-microtask-queue-run.js
