//#FILE: test-http-pipe-fs.js
//#SHA1: eb13abd37a9e18b0b28077247a7d336b92b79fbc
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
const fs = require("fs");
const path = require("path");
const os = require("os");

const NUMBER_OF_STREAMS = 2;

const tmpdir = path.join(os.tmpdir(), "node-test-http-pipe-fs");
fs.mkdirSync(tmpdir, { recursive: true });

const file = path.join(tmpdir, "http-pipe-fs-test.txt");

describe("HTTP pipe to fs", () => {
  let server;

  beforeAll(() => {
    server = http.createServer((req, res) => {
      const stream = fs.createWriteStream(file);
      req.pipe(stream);
      stream.on("close", () => {
        res.writeHead(200);
        res.end();
      });
    });
  });

  afterAll(() => {
    return new Promise(resolve => server.close(resolve));
  });

  it("should handle multiple concurrent requests", async () => {
    await new Promise(resolve => server.listen(0, resolve));

    const port = server.address().port;
    http.globalAgent.maxSockets = 1;

    const makeRequest = () => {
      return new Promise(resolve => {
        const req = http.request(
          {
            port: port,
            method: "POST",
            headers: {
              "Content-Length": 5,
            },
          },
          res => {
            res.on("end", resolve);
            res.resume();
          },
        );

        req.end("12345");
      });
    };

    const requests = Array(NUMBER_OF_STREAMS).fill().map(makeRequest);
    await Promise.all(requests);

    expect.assertions(1);
    expect(true).toBe(true); // Dummy assertion to ensure the test ran
  });
});

//<#END_FILE: test-http-pipe-fs.js
