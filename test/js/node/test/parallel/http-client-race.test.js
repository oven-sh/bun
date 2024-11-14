//#FILE: test-http-client-race.js
//#SHA1: 0ad515567d91a194670069b476e166d398543cc0
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
const url = require("url");

const body1_s = "1111111111111111";
const body2_s = "22222";

test("http client race condition", async () => {
  const server = http.createServer((req, res) => {
    const body = url.parse(req.url).pathname === "/1" ? body1_s : body2_s;
    res.writeHead(200, {
      "Content-Type": "text/plain",
      "Content-Length": body.length,
    });
    res.end(body);
  });

  await new Promise(resolve => server.listen(0, resolve));

  let body1 = "";
  let body2 = "";

  const makeRequest = path => {
    return new Promise((resolve, reject) => {
      const req = http.request({ port: server.address().port, path });
      req.end();
      req.on("response", res => {
        res.setEncoding("utf8");
        let body = "";
        res.on("data", chunk => {
          body += chunk;
        });
        res.on("end", () => resolve(body));
      });
      req.on("error", reject);
    });
  };

  body1 = await makeRequest("/1");
  body2 = await makeRequest("/2");

  await new Promise(resolve => server.close(resolve));

  expect(body1).toBe(body1_s);
  expect(body2).toBe(body2_s);
});

//<#END_FILE: test-http-client-race.js
