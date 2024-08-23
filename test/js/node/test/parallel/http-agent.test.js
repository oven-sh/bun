//#FILE: test-http-agent.js
//#SHA1: c5bb5b1b47100659ac17ae6c4ba084c6974ddaa7
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
const http = require("http");

const N = 4;
const M = 4;

let server;

beforeEach(() => {
  server = http.Server((req, res) => {
    res.writeHead(200);
    res.end("hello world\n");
  });
});

afterEach(() => {
  server.close();
});

function makeRequests(outCount, inCount, shouldFail) {
  return new Promise(resolve => {
    const totalRequests = outCount * inCount;
    let completedRequests = 0;

    const onRequest = jest.fn(res => {
      completedRequests++;
      if (completedRequests === totalRequests) {
        resolve();
      }

      if (!shouldFail) {
        res.resume();
      }
    });

    server.listen(0, () => {
      const port = server.address().port;
      for (let i = 0; i < outCount; i++) {
        setTimeout(() => {
          for (let j = 0; j < inCount; j++) {
            const req = http.get({ port: port, path: "/" }, onRequest);
            if (shouldFail) {
              req.on("error", onRequest);
            } else {
              req.on("error", e => {
                throw e;
              });
            }
          }
        }, i);
      }
    });
  });
}

test("makeRequests successful", async () => {
  await makeRequests(N, M);
  expect(server.listenerCount("request")).toBe(1);
});

test("makeRequests with failing requests", async () => {
  const originalCreateConnection = http.Agent.prototype.createConnection;

  http.Agent.prototype.createConnection = function createConnection(_, cb) {
    process.nextTick(cb, new Error("nothing"));
  };

  await makeRequests(N, M, true);

  http.Agent.prototype.createConnection = originalCreateConnection;
});

//<#END_FILE: test-http-agent.js
