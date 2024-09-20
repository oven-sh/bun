//#FILE: test-http-abort-before-end.js
//#SHA1: ccb82c66677f07f3ee815846261393edb8bfe5d4
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

test("HTTP request abort before end", async () => {
  const server = http.createServer(jest.fn());

  await new Promise(resolve => {
    server.listen(0, resolve);
  });

  const req = http.request({
    method: "GET",
    host: "127.0.0.1",
    port: server.address().port,
  });

  const abortPromise = new Promise(resolve => {
    req.on("abort", resolve);
  });

  req.on("error", jest.fn());

  req.abort();
  req.end();

  await abortPromise;

  expect(server.listeners("request")[0]).not.toHaveBeenCalled();
  expect(req.listeners("error")[0]).not.toHaveBeenCalled();

  await new Promise(resolve => {
    server.close(resolve);
  });
});

//<#END_FILE: test-http-abort-before-end.js
