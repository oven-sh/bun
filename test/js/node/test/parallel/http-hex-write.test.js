//#FILE: test-http-hex-write.js
//#SHA1: 77a5322a8fe08e8505f39d42614167d223c9fbb0
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

const expectedResponse = "hex\nutf8\n";

test("HTTP server writes hex and utf8", async () => {
  const server = http.createServer((req, res) => {
    res.setHeader("content-length", expectedResponse.length);
    res.write("6865780a", "hex");
    res.write("utf8\n");
    res.end();
    server.close();
  });

  await new Promise(resolve => {
    server.listen(0, () => {
      const port = server.address().port;
      http
        .request({ port })
        .on("response", res => {
          let data = "";
          res.setEncoding("ascii");
          res.on("data", chunk => {
            data += chunk;
          });
          res.on("end", () => {
            expect(data).toBe(expectedResponse);
            resolve();
          });
        })
        .end();
    });
  });
});

//<#END_FILE: test-http-hex-write.js
