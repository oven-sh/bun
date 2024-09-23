//#FILE: test-http-head-response-has-no-body.js
//#SHA1: f7df6559885b0465d43994e773c961b525b195a9
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

// This test is to make sure that when the HTTP server
// responds to a HEAD request, it does not send any body.
// In this case it was sending '0\r\n\r\n'

test("HTTP server responds to HEAD request without body", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200); // broken: defaults to TE chunked
    res.end();
  });

  await new Promise(resolve => {
    server.listen(0, resolve);
  });

  const { port } = server.address();

  await new Promise((resolve, reject) => {
    const req = http.request(
      {
        port,
        method: "HEAD",
        path: "/",
      },
      res => {
        res.on("end", () => {
          server.close(() => {
            resolve();
          });
        });
        res.resume();
      },
    );
    req.on("error", reject);
    req.end();
  });
});

//<#END_FILE: test-http-head-response-has-no-body.js
