//#FILE: test-cluster-worker-destroy.js
//#SHA1: 277a85b7c8fdda347d1f753601ac4b843a9a1c8d
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

// The goal of this test is to cover the Workers' implementation of
// Worker.prototype.destroy. Worker.prototype.destroy is called within
// the worker's context: once when the worker is still connected to the
// primary, and another time when it's not connected to it, so that we cover
// both code paths.

const assert = require("assert");
const cluster = require("cluster");

let worker1, worker2;

if (cluster.isPrimary) {
  test("primary process", () => {
    worker1 = cluster.fork();
    worker2 = cluster.fork();

    [worker1, worker2].forEach(worker => {
      const disconnectSpy = jest.fn();
      const exitSpy = jest.fn();

      worker.on("disconnect", disconnectSpy);
      worker.on("exit", exitSpy);

      worker.on("exit", () => {
        expect(disconnectSpy).toHaveBeenCalledTimes(1);
        expect(exitSpy).toHaveBeenCalledTimes(1);
      });
    });
  });
} else if (cluster.worker.id === 1) {
  test("worker 1: call destroy when worker is disconnected", () => {
    // Call destroy when worker is disconnected
    cluster.worker.process.on("disconnect", () => {
      cluster.worker.destroy();
    });

    const w = cluster.worker.disconnect();
    expect(w).toBe(cluster.worker);
  });
} else {
  test("worker 2: call destroy when worker is not disconnected yet", () => {
    // Call destroy when worker is not disconnected yet
    cluster.worker.destroy();
  });
}

//<#END_FILE: test-cluster-worker-destroy.js
