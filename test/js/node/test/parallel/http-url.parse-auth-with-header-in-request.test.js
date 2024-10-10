//#FILE: test-http-url.parse-auth-with-header-in-request.js
//#SHA1: 396adc5e441a57d24b11a42513c834b6b11ea7ff
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

test("HTTP request with authorization header in request", async () => {
  function check(request) {
    // The correct authorization header is be passed
    expect(request.headers.authorization).toBe("NoAuthForYOU");
  }

  const server = http.createServer((request, response) => {
    // Run the check function
    check(request);
    response.writeHead(200, {});
    response.end("ok");
    server.close();
  });

  await new Promise(resolve => {
    server.listen(0, () => {
      const testURL = url.parse(`http://asdf:qwer@localhost:${server.address().port}`);
      // The test here is if you set a specific authorization header in the
      // request we should not override that with basic auth
      testURL.headers = {
        Authorization: "NoAuthForYOU",
      };

      // make the request
      http.request(testURL).end();
      resolve();
    });
  });
});

//<#END_FILE: test-http-url.parse-auth-with-header-in-request.js
