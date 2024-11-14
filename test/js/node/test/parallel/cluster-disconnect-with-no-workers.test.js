//#FILE: test-cluster-disconnect-with-no-workers.js
//#SHA1: 06b4a0a662491bd9593c303307535a635d69d53e
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
const cluster = require("cluster");

let disconnected = false;

test("cluster.disconnect with no workers", async () => {
  const disconnectPromise = new Promise(resolve => {
    cluster.disconnect(() => {
      disconnected = true;
      resolve();
    });
  });

  // Assert that callback is not sometimes synchronous
  expect(disconnected).toBe(false);

  await disconnectPromise;

  // Assert that the callback was called
  expect(disconnected).toBe(true);
});

//<#END_FILE: test-cluster-disconnect-with-no-workers.js
