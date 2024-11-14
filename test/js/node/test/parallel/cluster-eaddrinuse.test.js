//#FILE: test-cluster-eaddrinuse.js
//#SHA1: a17cbbd83e23565c1cb547999357c14f03be6efa
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
// Check that having a worker bind to a port that's already taken doesn't
// leave the primary process in a confused state. Releasing the port and
// trying again should Just Work[TM].

const { fork } = require("child_process");
const net = require("net");

const id = String(process.argv[2]);
const port = String(process.argv[3]);

if (id === "undefined") {
  test("primary process", async () => {
    const server = net.createServer(() => {
      throw new Error("Server should not receive connections");
    });

    await new Promise(resolve => {
      server.listen(0, () => {
        const worker = fork(__filename, ["worker", server.address().port]);
        worker.on("message", msg => {
          if (msg !== "stop-listening") return;
          server.close(() => {
            worker.send("stopped-listening");
          });
        });
        resolve();
      });
    });
  });
} else if (id === "worker") {
  test("worker process", async () => {
    let server = net.createServer(() => {
      throw new Error("Server should not receive connections");
    });

    await expect(
      new Promise((resolve, reject) => {
        server.listen(port, () => reject(new Error("Server should not listen")));
        server.on("error", resolve);
      }),
    ).resolves.toMatchObject({
      code: "EADDRINUSE",
      message: expect.any(String),
    });

    process.send("stop-listening");

    await new Promise(resolve => {
      process.once("message", msg => {
        if (msg !== "stopped-listening") return;
        server = net.createServer(() => {
          throw new Error("Server should not receive connections");
        });
        server.listen(port, () => {
          server.close();
          resolve();
        });
      });
    });
  });
} else {
  test("invalid argument", () => {
    expect(() => {
      throw new Error("Bad argument");
    }).toThrow("Bad argument");
  });
}

//<#END_FILE: test-cluster-eaddrinuse.js
