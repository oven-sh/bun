//#FILE: test-http-client-response-domain.js
//#SHA1: 992c4b87d5fb63427f6386db96f9d946b20b5f69
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
const domain = require("domain");
const { PIPE } = require("../common");
const os = require("os");
const path = require("path");

let d;

const tmpdir = path.join(os.tmpdir(), "node-test-http-client-response-domain");

test("HTTP client response domain", async () => {
  // First fire up a simple HTTP server
  const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end();
    server.close();
  });

  await new Promise(resolve => {
    server.listen(PIPE, resolve);
  });

  // create a domain
  d = domain.create();

  const testFn = jest.fn(async () => {
    const errorHandler = jest.fn(err => {
      expect(err).toEqual(
        expect.objectContaining({
          message: "should be caught by domain",
        }),
      );
    });

    d.on("error", errorHandler);

    const req = http.get({
      socketPath: PIPE,
      headers: { "Content-Length": "1" },
      method: "POST",
      path: "/",
    });

    await new Promise(resolve => {
      req.on("response", res => {
        res.on("end", () => {
          res.emit("error", new Error("should be caught by domain"));
          resolve();
        });
        res.resume();
      });
    });

    req.end();

    expect(errorHandler).toHaveBeenCalledTimes(1);
  });

  await d.run(testFn);
  expect(testFn).toHaveBeenCalledTimes(1);
});

//<#END_FILE: test-http-client-response-domain.js
