//#FILE: test-tls-client-default-ciphers.js
//#SHA1: 8a9af503503ffc8b8a7c27089fd7cf417e22ec16
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

const tls = require("tls");

if (typeof Bun !== "undefined") {
  test = it;
}

if (!("crypto" in process.versions)) {
  test.skip("missing crypto", () => {});
} else {
  test("tls.connect uses default ciphers", () => {
    let ciphers = "";

    class Done extends Error {}

    tls.createSecureContext = function (options) {
      ciphers = options.ciphers;
      throw new Done();
    };

    expect(() => tls.connect()).toThrow(Done);

    expect(ciphers).toBe(tls.DEFAULT_CIPHERS);
  });
}

//<#END_FILE: test-tls-client-default-ciphers.js
