//#FILE: test-http-url.parse-basic.js
//#SHA1: f2f2841de1c82e38067e73196926090f350d89c6
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

let testURL;

// Make sure the basics work
function check(request) {
  // Default method should still be 'GET'
  expect(request.method).toBe("GET");
  // There are no URL params, so you should not see any
  expect(request.url).toBe("/");
  // The host header should use the url.parse.hostname
  expect(request.headers.host).toBe(`${testURL.hostname}:${testURL.port}`);
}

test("HTTP URL parsing basics", async () => {
  const server = http.createServer((request, response) => {
    // Run the check function
    check(request);
    response.writeHead(200, {});
    response.end("ok");
    server.close();
  });

  await new Promise(resolve => {
    server.listen(0, () => {
      testURL = url.parse(`http://localhost:${server.address().port}`);

      // make the request
      const clientRequest = http.request(testURL);
      // Since there is a little magic with the agent
      // make sure that an http request uses the http.Agent
      expect(clientRequest.agent).toBeInstanceOf(http.Agent);
      clientRequest.end();
      resolve();
    });
  });
});

//<#END_FILE: test-http-url.parse-basic.js
