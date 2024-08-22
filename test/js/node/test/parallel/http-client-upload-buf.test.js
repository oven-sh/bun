//#FILE: test-http-client-upload-buf.js
//#SHA1: bbfd7c52e710f53683f5f9a4578f34e451db4eb0
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
const assert = require("assert");
const http = require("http");

const N = 1024;

test("HTTP client upload buffer", async () => {
  const server = http.createServer((req, res) => {
    expect(req.method).toBe("POST");
    let bytesReceived = 0;

    req.on("data", chunk => {
      bytesReceived += chunk.length;
    });

    req.on("end", () => {
      expect(bytesReceived).toBe(N);
      console.log("request complete from server");
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write("hello\n");
      res.end();
    });
  });

  await new Promise(resolve => server.listen(0, resolve));

  const { port } = server.address();

  const responsePromise = new Promise(resolve => {
    const req = http.request(
      {
        port,
        method: "POST",
        path: "/",
      },
      res => {
        res.setEncoding("utf8");
        res.on("data", chunk => {
          console.log(chunk);
        });
        res.on("end", resolve);
      },
    );

    req.write(Buffer.allocUnsafe(N));
    req.end();
  });

  await responsePromise;
  await new Promise(resolve => server.close(resolve));
});

//<#END_FILE: test-http-client-upload-buf.js
