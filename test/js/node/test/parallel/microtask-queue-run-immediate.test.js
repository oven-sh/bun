//#FILE: test-microtask-queue-run-immediate.js
//#SHA1: 49e5d82cc3467e4e12d0e93629607cd48b3548e4
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

test("microtask queue runs in setImmediate", done => {
  let microtaskExecuted = false;

  setImmediate(() => {
    enqueueMicrotask(() => {
      microtaskExecuted = true;
      expect(microtaskExecuted).toBe(true);
      done();
    });
  });
});

test("microtask with nextTick runs before next setImmediate", done => {
  let nextTickCalled = false;

  setImmediate(() => {
    enqueueMicrotask(() => {
      process.nextTick(() => {
        nextTickCalled = true;
      });
    });

    setImmediate(() => {
      expect(nextTickCalled).toBe(true);
      done();
    });
  });
});

//<#END_FILE: test-microtask-queue-run-immediate.js
