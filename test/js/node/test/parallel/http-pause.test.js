//#FILE: test-http-pause.js
//#SHA1: d7712077ebe0493c27ffd7180e73fdd409041bf7
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

for (let expectedServer of [
  Buffer.alloc(1024 * 258, "Request Body from Client\n").toString(),
  "Request Body from Client\n",
]) {
  let resultServer = "";
  const expectedClient = "Response Body from Server";
  let resultClient = "";

  test(`HTTP pause and resume (${expectedServer.length})`, async () => {
    const server = http.createServer((req, res) => {
      req.pause();
      setTimeout(() => {
        req.resume();
        req.setEncoding("utf8");
        req.on("data", chunk => {
          resultServer += chunk;
        });
        req.on("end", () => {
          res.writeHead(200);
          res.end(expectedClient);
        });
      }, 100);
    });

    await new Promise(resolve => {
      server.listen(0, "127.0.0.1", function () {
        // Anonymous function rather than arrow function to test `this` value.
        expect(this).toBe(server);

        http
          .request(
            {
              method: "POST",
              port: server.address().port,
            },
            res => {
              res.pause();
              setTimeout(() => {
                res.resume();
                res.on("data", chunk => {
                  resultClient += chunk;
                });
                res.on("end", () => {
                  server.close();
                  resolve();
                });
              });
            },
          )
          .end(expectedServer);
      });
    });

    expect(resultServer).toBe(expectedServer);
    expect(resultClient).toBe(expectedClient);
  });
}
//<#END_FILE: test-http-pause.js
