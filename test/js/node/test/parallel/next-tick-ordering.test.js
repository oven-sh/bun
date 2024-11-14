//#FILE: test-next-tick-ordering.js
//#SHA1: 224023554e0ccd7644d70c5acef5bf3a094409ac
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

test("next tick ordering", async () => {
  const N = 30;
  const done = [];

  function get_printer(timeout) {
    return function () {
      console.log(`Running from setTimeout ${timeout}`);
      done.push(timeout);
    };
  }

  process.nextTick(function () {
    console.log("Running from nextTick");
    done.push("nextTick");
  });

  for (let i = 0; i < N; i += 1) {
    setTimeout(get_printer(i), i);
  }

  console.log("Running from main.");

  // Wait for all timeouts to complete
  await new Promise(resolve => setTimeout(resolve, N + 100));

  expect(done[0]).toBe("nextTick");
  // Disabling this test. I don't think we can ensure the order
  // for (let i = 0; i < N; i += 1) {
  //  expect(done[i + 1]).toBe(i);
  // }
});

//<#END_FILE: test-next-tick-ordering.js
