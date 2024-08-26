//#FILE: test-cluster-worker-constructor.js
//#SHA1: ef3237d09cf6339e487f14c40d4c047c6871ead2
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
// test-cluster-worker-constructor.js
// validates correct behavior of the cluster.Worker constructor

const cluster = require("cluster");

describe("cluster.Worker constructor", () => {
  test("creates a worker with default values", () => {
    const worker = new cluster.Worker();
    expect(worker.exitedAfterDisconnect).toBeUndefined();
    expect(worker.state).toBe("none");
    expect(worker.id).toBe(0);
    expect(worker.process).toBeUndefined();
  });

  test("creates a worker with custom values", () => {
    const worker = new cluster.Worker({
      id: 3,
      state: "online",
      process: process,
    });
    expect(worker.exitedAfterDisconnect).toBeUndefined();
    expect(worker.state).toBe("online");
    expect(worker.id).toBe(3);
    expect(worker.process).toBe(process);
  });

  test("creates a worker using call method", () => {
    const worker = cluster.Worker.call({}, { id: 5 });
    expect(worker).toBeInstanceOf(cluster.Worker);
    expect(worker.id).toBe(5);
  });
});

//<#END_FILE: test-cluster-worker-constructor.js
