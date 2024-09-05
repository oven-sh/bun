//#FILE: test-http-contentLength0.js
//#SHA1: d85b0cc3dcfcff522ffbeddacf89111897b80c02
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

// Simple test of Node's HTTP Client choking on a response
// with a 'Content-Length: 0 ' response header.
// I.E. a space character after the 'Content-Length' throws an `error` event.

test("HTTP Client handles Content-Length: 0 with space", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Length": "0 " });
    res.end();
  });

  await new Promise(resolve => {
    server.listen(0, resolve);
  });

  const { port } = server.address();

  await new Promise(resolve => {
    const request = http.request({ port }, response => {
      expect(response.statusCode).toBe(200);
      server.close();
      response.resume();
      resolve();
    });

    request.end();
  });
});

//<#END_FILE: test-http-contentLength0.js
