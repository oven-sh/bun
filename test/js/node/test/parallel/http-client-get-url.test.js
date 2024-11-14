//#FILE: test-http-client-get-url.js
//#SHA1: 0329da4beb5be5da0ab6652b246dd912935e56af
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
const url = require("url");
const testPath = "/foo?bar";

let server;
let serverAddress;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    expect(req.method).toBe("GET");
    expect(req.url).toBe(testPath);
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.write("hello\n");
    res.end();
  });

  await new Promise(resolve => {
    server.listen(0, "127.0.0.1", () => {
      serverAddress = `http://127.0.0.1:${server.address().port}${testPath}`;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
});

test("http.get with string URL", async () => {
  await new Promise(resolve => {
    http.get(serverAddress, () => {
      resolve();
    });
  });
});

test("http.get with parsed URL", async () => {
  await new Promise(resolve => {
    http.get(url.parse(serverAddress), () => {
      resolve();
    });
  });
});

test("http.get with URL object", async () => {
  await new Promise(resolve => {
    http.get(new URL(serverAddress), () => {
      resolve();
    });
  });
});

//<#END_FILE: test-http-client-get-url.js
