//#FILE: test-http-pause-resume-one-end.js
//#SHA1: 69f25ca624d470d640d6366b6df27eba31668e96
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

test("HTTP server pause and resume", async () => {
  const server = http.Server(function (req, res) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Hello World\n");
    server.close();
  });

  await new Promise(resolve => {
    server.listen(0, resolve);
  });

  const opts = {
    port: server.address().port,
    headers: { connection: "close" },
  };

  await new Promise(resolve => {
    http.get(opts, res => {
      res.on(
        "data",
        jest.fn().mockImplementation(() => {
          res.pause();
          setImmediate(() => {
            res.resume();
          });
        }),
      );

      res.on("end", () => {
        expect(res.destroyed).toBe(false);
      });

      expect(res.destroyed).toBe(false);

      res.on("close", () => {
        expect(res.destroyed).toBe(true);
        resolve();
      });
    });
  });
});

//<#END_FILE: test-http-pause-resume-one-end.js
