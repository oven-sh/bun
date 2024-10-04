//#FILE: test-http-head-response-has-no-body-end.js
//#SHA1: 64091937f68588f23597f106fa906d27380be005
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
// responds to a HEAD request with data to res.end,
// it does not send any body.

test("HTTP server responds to HEAD request without sending body", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("FAIL"); // broken: sends FAIL from hot path.
  });

  await new Promise(resolve => {
    server.listen(0, () => {
      const req = http.request(
        {
          port: server.address().port,
          method: "HEAD",
          path: "/",
        },
        res => {
          const onEnd = jest.fn();
          res.on("end", onEnd);
          res.resume();

          res.on("end", () => {
            expect(onEnd).toHaveBeenCalledTimes(1);
            server.close(resolve);
          });
        },
      );
      req.end();
    });
  });
});

//<#END_FILE: test-http-head-response-has-no-body-end.js
