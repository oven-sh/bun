//#FILE: test-http-agent-null.js
//#SHA1: 65fb22d32bae2a7eecc4242b5b2d2d693849641c
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

test("http.get with null agent", async () => {
  const server = http.createServer((req, res) => {
    res.end();
  });

  await new Promise(resolve => {
    server.listen(0, resolve);
  });

  const options = {
    agent: null,
    port: server.address().port,
  };

  const responsePromise = new Promise(resolve => {
    http.get(options, res => {
      res.resume();
      resolve(res);
    });
  });

  await expect(responsePromise).resolves.toBeDefined();

  await new Promise(resolve => {
    server.close(resolve);
  });
});

//<#END_FILE: test-http-agent-null.js
