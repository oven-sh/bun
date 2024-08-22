//#FILE: test-http-request-end.js
//#SHA1: e86769441d8d182d32d60d4631e32fbcc2675ed9
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

const expected = "Post Body For Test";

test("http request end", async () => {
  const server = http.Server((req, res) => {
    let result = "";

    req.setEncoding("utf8");
    req.on("data", chunk => {
      result += chunk;
    });

    req.on("end", () => {
      expect(result).toBe(expected);
      res.writeHead(200);
      res.end("hello world\n");
      server.close();
    });
  });

  await new Promise(resolve => {
    server.listen(0, () => {
      const req = http
        .request(
          {
            port: server.address().port,
            path: "/",
            method: "POST",
          },
          res => {
            expect(res.statusCode).toBe(200);
            res.resume();
            resolve();
          },
        )
        .on("error", e => {
          console.error(e.message);
          process.exit(1);
        });

      const result = req.end(expected);

      expect(req).toBe(result);
    });
  });
});

//<#END_FILE: test-http-request-end.js
