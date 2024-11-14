//#FILE: test-microtask-queue-integration.js
//#SHA1: bc144f7d64d2ed682489718745be5883122cf323
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

const implementations = [
  function (fn) {
    Promise.resolve().then(fn);
  },
];

let expected = 0;
let done = 0;

afterAll(() => {
  expect(done).toBe(expected);
});

function testMicrotask(scheduleMicrotask) {
  return new Promise(resolve => {
    let nextTickCalled = false;
    expected++;

    scheduleMicrotask(() => {
      process.nextTick(() => {
        nextTickCalled = true;
      });

      setTimeout(() => {
        expect(nextTickCalled).toBe(true);
        done++;
        resolve();
      }, 0);
    });
  });
}

test("first tick case", async () => {
  await Promise.all(implementations.map(testMicrotask));
});

test("tick callback case", async () => {
  await new Promise(resolve => {
    setTimeout(async () => {
      await Promise.all(
        implementations.map(
          impl =>
            new Promise(resolve => {
              process.nextTick(() => {
                testMicrotask(impl).then(resolve);
              });
            }),
        ),
      );
      resolve();
    }, 0);
  });
});

//<#END_FILE: test-microtask-queue-integration.js
