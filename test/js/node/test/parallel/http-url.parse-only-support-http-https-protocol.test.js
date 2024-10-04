//#FILE: test-http-url.parse-only-support-http-https-protocol.js
//#SHA1: 924c029f73164388b765c128401affa763af7b56
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

const invalidUrls = [
  "file:///whatever",
  "mailto:asdf@asdf.com",
  "ftp://www.example.com",
  "javascript:alert('hello');",
  "xmpp:foo@bar.com",
  "f://some.host/path",
];

describe("http.request with invalid protocols", () => {
  test.each(invalidUrls)("throws for invalid URL: %s", invalid => {
    expect(() => {
      http.request(url.parse(invalid));
    }).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_PROTOCOL",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });
});

//<#END_FILE: test-http-url.parse-only-support-http-https-protocol.js
