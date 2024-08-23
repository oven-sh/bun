//#FILE: test-http-host-headers.js
//#SHA1: 256e8b55e2c545a9f9df89607600f18a93c1c67a
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

function reqHandler(req, res) {
  if (req.url === "/setHostFalse5") {
    expect(req.headers.host).toBeUndefined();
  } else {
    expect(req.headers.host).toBe(`localhost:${this.address().port}`);
  }
  res.writeHead(200, {});
  res.end("ok");
}

const httpServer = http.createServer(reqHandler);

test("HTTP host headers", async () => {
  await new Promise(resolve => {
    httpServer.listen(0, async () => {
      const port = httpServer.address().port;
      const makeRequest = (method, path) => {
        return new Promise(resolve => {
          const req = http.request(
            {
              method,
              path,
              host: "localhost",
              port,
              rejectUnauthorized: false,
            },
            res => {
              res.resume();
              resolve();
            },
          );
          req.on("error", () => {
            throw new Error("Request should not fail");
          });
          req.end();
        });
      };

      await makeRequest("GET", "/0");
      await makeRequest("GET", "/1");
      await makeRequest("POST", "/2");
      await makeRequest("PUT", "/3");
      await makeRequest("DELETE", "/4");

      httpServer.close(resolve);
    });
  });
});

//<#END_FILE: test-http-host-headers.js
