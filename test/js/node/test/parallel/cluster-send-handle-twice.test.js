//#FILE: test-cluster-send-handle-twice.js
//#SHA1: d667e299035da70aa7831cb6964ba4e974c6bdc8
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
// Testing to send an handle twice to the primary process.

const cluster = require("cluster");
const net = require("net");

const workers = {
  toStart: 1,
};

if (cluster.isPrimary) {
  test("primary process", () => {
    for (let i = 0; i < workers.toStart; ++i) {
      const worker = cluster.fork();
      worker.on("exit", (code, signal) => {
        expect(code).toBe(0);
        expect(signal).toBeNull();
      });
    }
  });
} else {
  test("worker process", async () => {
    const server = net.createServer(socket => {
      process.send("send-handle-1", socket);
      process.send("send-handle-2", socket);
    });

    await new Promise((resolve, reject) => {
      server.listen(0, () => {
        const client = net.connect({
          host: "localhost",
          port: server.address().port,
        });
        client.on("close", () => {
          cluster.worker.disconnect();
          resolve();
        });
        client.on("connect", () => {
          client.end();
        });
      });

      server.on("error", e => {
        console.error(e);
        reject(new Error("server.listen failed"));
      });
    });
  });
}

//<#END_FILE: test-cluster-send-handle-twice.js
