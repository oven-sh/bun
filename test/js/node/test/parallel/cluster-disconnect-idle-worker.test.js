//#FILE: test-cluster-disconnect-idle-worker.js
//#SHA1: f559db612db77271be32bab2d7cb9a4e38f28670
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
const fork = cluster.fork;

if (cluster.isPrimary) {
  test("cluster disconnect idle worker", async () => {
    fork(); // It is intentionally called `fork` instead of
    fork(); // `cluster.fork` to test that `this` is not used

    const disconnectCallback = jest.fn(() => {
      expect(Object.keys(cluster.workers)).toEqual([]);
    });

    await new Promise(resolve => {
      cluster.disconnect(() => {
        disconnectCallback();
        resolve();
      });
    });

    expect(disconnectCallback).toHaveBeenCalledTimes(1);
  });
}

//<#END_FILE: test-cluster-disconnect-idle-worker.js
