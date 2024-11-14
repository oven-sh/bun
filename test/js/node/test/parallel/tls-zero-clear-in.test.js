//#FILE: test-tls-zero-clear-in.js
//#SHA1: 6014fd3aa5a294b4e8594a32f0eb8e7b3c206213
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
const { readKey } = require("../common/fixtures");

if (!process.versions.openssl) {
  test.skip("missing crypto");
}

const cert = readKey("rsa_cert.crt");
const key = readKey("rsa_private.pem");

test("SSL_write() call with 0 bytes should not be treated as error", done => {
  const server = tls.createServer(
    {
      cert,
      key,
    },
    c => {
      // Nop
      setTimeout(() => {
        c.end();
        server.close();
      }, 20);
    },
  );

  server.listen(0, () => {
    const conn = tls.connect(
      {
        cert: cert,
        key: key,
        rejectUnauthorized: false,
        port: server.address().port,
      },
      () => {
        setTimeout(() => {
          conn.destroy();
        }, 20);
      },
    );

    // SSL_write() call's return value, when called 0 bytes, should not be
    // treated as error.
    conn.end("");

    conn.on("error", () => {
      done(new Error("Unexpected error event"));
    });

    setTimeout(() => {
      done();
    }, 100);
  });
});

//<#END_FILE: test-tls-zero-clear-in.js
