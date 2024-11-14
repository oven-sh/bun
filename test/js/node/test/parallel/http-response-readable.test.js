//#FILE: test-http-response-readable.js
//#SHA1: bfdd12475c68879668c3019c685001244559fb20
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

test("HTTP response readable state", async () => {
  const testServer = new http.Server((req, res) => {
    res.writeHead(200);
    res.end("Hello world");
  });

  await new Promise(resolve => {
    testServer.listen(0, () => {
      const port = testServer.address().port;
      http.get({ port }, res => {
        expect(res.readable).toBe(true);
        res.on("end", () => {
          expect(res.readable).toBe(false);
          testServer.close(resolve);
        });
        res.resume();
      });
    });
  });
});

//<#END_FILE: test-http-response-readable.js
