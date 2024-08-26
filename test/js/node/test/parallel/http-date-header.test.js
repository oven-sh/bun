//#FILE: test-http-date-header.js
//#SHA1: e4d2a00dad7c6483d9ed328731bb04f5f431afb4
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

const testResBody = "other stuff!\n";

test("HTTP Date header", async () => {
  const server = http.createServer((req, res) => {
    expect(req.headers).not.toHaveProperty("date");
    res.writeHead(200, {
      "Content-Type": "text/plain",
    });
    res.end(testResBody);
  });

  await new Promise(resolve => {
    server.listen(0, resolve);
  });

  const { port } = server.address();

  const options = {
    port,
    path: "/",
    method: "GET",
  };

  const responsePromise = new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      expect(res.headers).toHaveProperty("date");
      res.resume();
      res.on("end", resolve);
    });
    req.on("error", reject);
    req.end();
  });

  await responsePromise;
  await new Promise(resolve => server.close(resolve));
});

//<#END_FILE: test-http-date-header.js
