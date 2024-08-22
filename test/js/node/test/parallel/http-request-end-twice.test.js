//#FILE: test-http-request-end-twice.js
//#SHA1: c8c502b3bf8a681a7acb9afa603a13cebaf1d00e
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

test("http request end twice", async () => {
  const server = http.Server((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("hello world\n");
  });

  await new Promise(resolve => {
    server.listen(0, () => {
      const req = http.get({ port: server.address().port }, res => {
        res.on("end", () => {
          expect(req.end()).toBe(req);
          server.close(resolve);
        });
        res.resume();
      });
    });
  });
});

//<#END_FILE: test-http-request-end-twice.js
