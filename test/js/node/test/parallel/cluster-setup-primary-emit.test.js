//#FILE: test-cluster-setup-primary-emit.js
//#SHA1: 965f86ef2ea557510e956759d3f540edfa7b03de
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

expect(cluster.isPrimary).toBe(true);

function emitAndCatch(next) {
  return new Promise(resolve => {
    cluster.once("setup", settings => {
      expect(settings.exec).toBe("new-exec");
      setImmediate(() => {
        next();
        resolve();
      });
    });
    cluster.setupPrimary({ exec: "new-exec" });
  });
}

function emitAndCatch2(next) {
  return new Promise(resolve => {
    cluster.once("setup", settings => {
      expect(settings).toHaveProperty("exec");
      setImmediate(() => {
        next();
        resolve();
      });
    });
    cluster.setupPrimary();
  });
}

test("cluster setup primary emit", async () => {
  const nextSpy1 = jest.fn();
  const nextSpy2 = jest.fn();

  await emitAndCatch(nextSpy1);
  expect(nextSpy1).toHaveBeenCalledTimes(1);

  await emitAndCatch2(nextSpy2);
  expect(nextSpy2).toHaveBeenCalledTimes(1);
});

//<#END_FILE: test-cluster-setup-primary-emit.js
