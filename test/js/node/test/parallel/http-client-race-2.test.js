//#FILE: test-http-client-race-2.js
//#SHA1: f1e2a4ecdd401cb9fcf615496d1376ce0a94ad73
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

//
// Slight variation on test-http-client-race to test for another race
// condition involving the parsers FreeList used internally by http.Client.
//

const body1_s = "1111111111111111";
const body2_s = "22222";
const body3_s = "3333333333333333333";

let server;
let port;

beforeAll(() => {
  return new Promise(resolve => {
    server = http.createServer(function (req, res) {
      const pathname = url.parse(req.url).pathname;

      let body;
      switch (pathname) {
        case "/1":
          body = body1_s;
          break;
        case "/2":
          body = body2_s;
          break;
        default:
          body = body3_s;
      }

      res.writeHead(200, {
        "Content-Type": "text/plain",
        "Content-Length": body.length,
      });
      res.end(body);
    });

    server.listen(0, () => {
      port = server.address().port;
      resolve();
    });
  });
});

afterAll(() => {
  return new Promise(resolve => {
    server.close(resolve);
  });
});

test("HTTP client race condition", async () => {
  let body1 = "";
  let body2 = "";
  let body3 = "";

  // Client #1 is assigned Parser #1
  const req1 = http.get({ port, path: "/1" });
  await new Promise(resolve => {
    req1.on("response", function (res1) {
      res1.setEncoding("utf8");

      res1.on("data", function (chunk) {
        body1 += chunk;
      });

      res1.on("end", function () {
        // Delay execution a little to allow the 'close' event to be processed
        // (required to trigger this bug!)
        setTimeout(resolve, 500);
      });
    });
  });

  // The bug would introduce itself here: Client #2 would be allocated the
  // parser that previously belonged to Client #1. But we're not finished
  // with Client #1 yet!
  //
  // At this point, the bug would manifest itself and crash because the
  // internal state of the parser was no longer valid for use by Client #1
  const req2 = http.get({ port, path: "/2" });
  await new Promise(resolve => {
    req2.on("response", function (res2) {
      res2.setEncoding("utf8");
      res2.on("data", function (chunk) {
        body2 += chunk;
      });
      res2.on("end", resolve);
    });
  });

  // Just to be really sure we've covered all our bases, execute a
  // request using client2.
  const req3 = http.get({ port, path: "/3" });
  await new Promise(resolve => {
    req3.on("response", function (res3) {
      res3.setEncoding("utf8");
      res3.on("data", function (chunk) {
        body3 += chunk;
      });
      res3.on("end", resolve);
    });
  });

  expect(body1).toBe(body1_s);
  expect(body2).toBe(body2_s);
  expect(body3).toBe(body3_s);
});

//<#END_FILE: test-http-client-race-2.js
