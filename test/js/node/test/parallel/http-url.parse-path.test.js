//#FILE: test-http-url.parse-path.js
//#SHA1: 9eb246a6c09b70b76260a83bec4bb25452d38b7d
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

test("http request url parsing", async () => {
  function check(request) {
    // A path should come over
    expect(request.url).toBe("/asdf");
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
      const testURL = url.parse(`http://localhost:${server.address().port}/asdf`);

      // make the request
      http.request(testURL).end();
      resolve();
    });
  });
});

//<#END_FILE: test-http-url.parse-path.js
