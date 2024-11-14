//#FILE: test-tls-client-abort.js
//#SHA1: e4f4d09f8de79ff5f4bdefcdaf1bbebb49f3cc16
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
const fs = require("fs");
const path = require("path");

const hasCrypto = (() => {
  try {
    require("crypto");
    return true;
  } catch {
    return false;
  }
})();

if (!hasCrypto) {
  test.skip("missing crypto", () => {});
} else {
  test("TLS client abort", () => {
    const cert = fs.readFileSync(path.join(__dirname, "..", "fixtures", "keys", "rsa_cert.crt"));
    const key = fs.readFileSync(path.join(__dirname, "..", "fixtures", "keys", "rsa_private.pem"));

    const onConnect = jest.fn();
    const conn = tls.connect({ cert, key, port: 0 }, onConnect);

    conn.on("error", () => {}); // Expecting an error, but not testing its content
    conn.destroy();

    expect(onConnect).not.toHaveBeenCalled();
  });
}

//<#END_FILE: test-tls-client-abort.js
